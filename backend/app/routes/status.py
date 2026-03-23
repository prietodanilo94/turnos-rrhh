"""
Status / Completeness API
Designed for n8n queries and the Admin Dashboard.

GET /api/status/completeness?week_start=YYYY-MM-DD
    → { complete: [...], incomplete: [...] }

GET /api/status/branch/{branch_id}?week_start=YYYY-MM-DD&week_end=YYYY-MM-DD
    → detail of a single branch
"""
from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models import Branch, Worker, Schedule, WeeklyStatus, User
from app.schemas import BranchCompleteness, CompletenessResponse
from app.auth import require_role

router = APIRouter(prefix="/api/status", tags=["Status"])


def _branch_completeness(db: Session, branch: Branch, week_start: date, week_end: date) -> BranchCompleteness:
    """Calculate completeness for one branch over a date range."""
    active_workers = db.query(Worker).filter(
        Worker.branch_id == branch.id,
        Worker.is_active == True,
    ).all()
    total = len(active_workers)

    if total == 0:
        return BranchCompleteness(
            branch_id=branch.id, branch_name=branch.name, branch_code=branch.code,
            total_workers=0, workers_with_schedules=0, is_complete=True, status="empty"
        )

    # Count workers that have at least one schedule entry in the range
    worker_ids = [w.id for w in active_workers]
    scheduled_ids = (
        db.query(Schedule.worker_id)
        .filter(
            Schedule.worker_id.in_(worker_ids),
            Schedule.date >= week_start,
            Schedule.date <= week_end,
        )
        .distinct()
        .all()
    )
    scheduled_count = len(scheduled_ids)
    is_complete = scheduled_count >= total

    return BranchCompleteness(
        branch_id=branch.id,
        branch_name=branch.name,
        branch_code=branch.code,
        total_workers=total,
        workers_with_schedules=scheduled_count,
        is_complete=is_complete,
        status="complete" if is_complete else ("empty" if scheduled_count == 0 else "incomplete"),
    )


@router.get("/completeness", response_model=CompletenessResponse)
def get_completeness(
    week_start: date = Query(..., description="Lunes de la semana (YYYY-MM-DD)"),
    week_end: Optional[date] = Query(None, description="Fin del rango (default: week_start + 6)"),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """
    Returns which branches have complete vs incomplete schedules for a date range.
    Designed for n8n queries and the Admin Dashboard.
    """
    if week_end is None:
        week_end = week_start + timedelta(days=6)

    branches = db.query(Branch).filter(Branch.is_active == True).order_by(Branch.name).all()

    # Managers only see their assigned branches
    if user.role == "manager":
        allowed_ids = {ub.branch_id for ub in user.user_branches}
        branches = [b for b in branches if b.id in allowed_ids]

    complete = []
    incomplete = []
    for branch in branches:
        result = _branch_completeness(db, branch, week_start, week_end)
        if result.is_complete:
            complete.append(result)
        else:
            incomplete.append(result)

    return CompletenessResponse(week_start=week_start, complete=complete, incomplete=incomplete)


@router.get("/branch/{branch_id}")
def get_branch_status(
    branch_id: int,
    week_start: date = Query(...),
    week_end: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """
    Returns detailed schedule status for a single branch.
    Per-worker breakdown.
    """
    if week_end is None:
        week_end = week_start + timedelta(days=6)

    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        return {"error": "Sucursal no encontrada"}

    # Permission check for managers
    if user.role == "manager":
        allowed_ids = {ub.branch_id for ub in user.user_branches}
        if branch_id not in allowed_ids:
            return {"error": "Sin acceso a esta sucursal"}

    workers = db.query(Worker).filter(
        Worker.branch_id == branch_id,
        Worker.is_active == True,
    ).order_by(Worker.last_name).all()

    worker_data = []
    for w in workers:
        schedules = db.query(Schedule).filter(
            Schedule.worker_id == w.id,
            Schedule.date >= week_start,
            Schedule.date <= week_end,
        ).all()

        scheduled_days = len(schedules)
        expected_days = (week_end - week_start).days + 1
        total_hours = sum(float(s.total_hours) for s in schedules if not s.is_day_off)

        worker_data.append({
            "worker_id": w.id,
            "rut": w.rut,
            "name": w.full_name,
            "position": w.position,
            "scheduled_days": scheduled_days,
            "expected_days": expected_days,
            "total_hours": round(total_hours, 2),
            "is_complete": scheduled_days >= expected_days,
        })

    summary = _branch_completeness(db, branch, week_start, week_end)
    weekly_status = db.query(WeeklyStatus).filter(
        WeeklyStatus.branch_id == branch_id,
        WeeklyStatus.week_start == week_start,
    ).first()

    return {
        "branch": {"id": branch.id, "name": branch.name, "code": branch.code},
        "week_start": str(week_start),
        "week_end": str(week_end),
        "publish_status": weekly_status.status if weekly_status else "pending",
        "summary": summary,
        "workers": worker_data,
    }


@router.get("/audit-log")
def get_audit_log(
    rut: Optional[str] = Query(None),
    branch_id: Optional[int] = Query(None),
    entity_type: Optional[str] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """
    Audit log endpoint. Filter by RUT, branch, entity type, or date range.
    """
    from app.models import AuditLog
    from sqlalchemy import and_

    query = db.query(AuditLog).join(User, AuditLog.user_id == User.id)

    if rut:
        from app.schemas import rut_for_lookup
        normalized = rut_for_lookup(rut)
        query = query.filter(User.rut == normalized)

    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)

    if from_date:
        query = query.filter(AuditLog.created_at >= from_date)

    if to_date:
        query = query.filter(AuditLog.created_at <= to_date)

    logs = query.order_by(AuditLog.created_at.desc()).limit(limit).all()

    return [
        {
            "id": log.id,
            "user_rut": log.user.rut,
            "user_name": log.user.full_name,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "old_values": log.old_values,
            "new_values": log.new_values,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]
