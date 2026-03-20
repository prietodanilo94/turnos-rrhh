from datetime import date, timedelta, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload
from typing import Optional

from app.database import get_db
from app.models import Schedule, Worker, ShiftTemplate, User, AuditLog, WeeklyStatus, LaborRule
from app.schemas import (
    ScheduleBulkRequest, ScheduleEntry, CopyWeekRequest,
    PublishRequest, SwapRequest, ScheduleResponse
)
from app.auth import require_role

router = APIRouter(prefix="/api/schedules", tags=["Schedules"])


# ── Helper: Get active labor rules ─────────────────────────────
def get_max_weekly_hours(db: Session, ref_date: date) -> float:
    rule = (
        db.query(LaborRule)
        .filter(
            LaborRule.rule_code == "MAX_WEEKLY_HOURS",
            LaborRule.effective_from <= ref_date,
            (LaborRule.effective_until >= ref_date) | (LaborRule.effective_until.is_(None)),
        )
        .first()
    )
    return float(rule.rule_value) if rule else 44.0


def get_week_dates(week_start: date) -> list[date]:
    """Return 7 dates Mon-Sun starting from week_start."""
    return [week_start + timedelta(days=i) for i in range(7)]


def calculate_hours(start_time, end_time) -> float:
    """Calculate hours between two time objects."""
    from datetime import datetime, timedelta
    dt_start = datetime.combine(date.today(), start_time)
    dt_end = datetime.combine(date.today(), end_time)
    diff = (dt_end - dt_start).total_seconds() / 3600
    return round(diff, 2)


# ── GET schedules ──────────────────────────────────────────────
@router.get("")
def get_schedules(
    branch_id: Optional[int] = None,
    week_start: Optional[date] = None,
    worker_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    query = db.query(Schedule).options(
        joinedload(Schedule.worker),
        joinedload(Schedule.shift_template),
    )

    if user.role == "manager" and user.branch_id:
        query = query.join(Worker).filter(Worker.branch_id == user.branch_id)
    elif branch_id:
        query = query.join(Worker).filter(Worker.branch_id == branch_id)

    if week_start:
        week_end = week_start + timedelta(days=6)
        query = query.filter(Schedule.date >= week_start, Schedule.date <= week_end)

    if worker_id:
        query = query.filter(Schedule.worker_id == worker_id)

    schedules = query.order_by(Schedule.worker_id, Schedule.date).all()

    # Group by worker
    workers_data = {}
    for s in schedules:
        wid = s.worker_id
        if wid not in workers_data:
            workers_data[wid] = {
                "worker_id": wid,
                "name": s.worker.full_name if s.worker else "—",
                "rut": s.worker.rut if s.worker else "—",
                "days": {},
                "total_hours": 0,
            }
        day_key = s.date.isoformat()
        hours = float(s.total_hours) if s.total_hours else 0
        workers_data[wid]["days"][day_key] = {
            "schedule_id": s.id,
            "is_day_off": s.is_day_off,
            "shift_template": {
                "id": s.shift_template.id,
                "code": s.shift_template.code,
                "name": s.shift_template.name,
            } if s.shift_template else None,
            "start_time": str(s.custom_start_time or (s.shift_template.start_time if s.shift_template else None)),
            "end_time": str(s.custom_end_time or (s.shift_template.end_time if s.shift_template else None)),
            "total_hours": hours,
            "notes": s.notes,
            "status": s.status,
        }
        if not s.is_day_off:
            workers_data[wid]["total_hours"] += hours

    max_hours = get_max_weekly_hours(db, week_start or date.today())

    return {
        "success": True,
        "data": {
            "week_start": str(week_start) if week_start else None,
            "workers": list(workers_data.values()),
        },
        "meta": {
            "max_weekly_hours": max_hours,
        },
    }


# ── POST bulk save ─────────────────────────────────────────────
@router.post("/bulk")
def save_bulk(
    data: ScheduleBulkRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    max_hours = get_max_weekly_hours(db, data.week_start)
    created = 0
    updated = 0

    for entry in data.schedules:
        # Calculate total_hours
        if entry.is_day_off:
            total_hours = 0
        elif entry.shift_template_id:
            template = db.query(ShiftTemplate).filter(ShiftTemplate.id == entry.shift_template_id).first()
            if not template:
                raise HTTPException(status_code=400, detail=f"Plantilla {entry.shift_template_id} no encontrada")
            total_hours = float(template.total_hours) if template.total_hours else 0
        elif entry.custom_start_time and entry.custom_end_time:
            total_hours = calculate_hours(entry.custom_start_time, entry.custom_end_time)
        else:
            raise HTTPException(status_code=400, detail="Cada registro necesita plantilla, horario manual o día libre")

        # Upsert
        existing = db.query(Schedule).filter(
            Schedule.worker_id == entry.worker_id,
            Schedule.date == entry.date,
        ).first()

        if existing:
            existing.shift_template_id = entry.shift_template_id
            existing.custom_start_time = entry.custom_start_time
            existing.custom_end_time = entry.custom_end_time
            existing.total_hours = total_hours
            existing.is_day_off = entry.is_day_off
            existing.notes = entry.notes
            existing.updated_by = user.id
            updated += 1
        else:
            schedule = Schedule(
                worker_id=entry.worker_id,
                date=entry.date,
                shift_template_id=entry.shift_template_id,
                custom_start_time=entry.custom_start_time,
                custom_end_time=entry.custom_end_time,
                total_hours=total_hours,
                is_day_off=entry.is_day_off,
                notes=entry.notes,
                created_by=user.id,
            )
            db.add(schedule)
            created += 1

    # Update weekly status
    ws = db.query(WeeklyStatus).filter(
        WeeklyStatus.branch_id == data.branch_id,
        WeeklyStatus.week_start == data.week_start,
    ).first()
    if not ws:
        ws = WeeklyStatus(branch_id=data.branch_id, week_start=data.week_start, status="draft")
        db.add(ws)
    else:
        ws.status = "draft"

    db.commit()

    return {
        "success": True,
        "message": f"{created} creados, {updated} actualizados",
        "created": created,
        "updated": updated,
    }


# ── POST copy week ─────────────────────────────────────────────
@router.post("/copy-week")
def copy_week(
    data: CopyWeekRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    source_dates = get_week_dates(data.source_week)
    target_dates = get_week_dates(data.target_week)

    source_schedules = (
        db.query(Schedule)
        .join(Worker)
        .filter(
            Worker.branch_id == data.branch_id,
            Schedule.date.in_(source_dates),
        )
        .all()
    )

    if not source_schedules:
        raise HTTPException(status_code=404, detail="No hay horarios en la semana origen")

    copied = 0
    for s in source_schedules:
        day_offset = (s.date - data.source_week).days
        target_date = data.target_week + timedelta(days=day_offset)

        # Skip if already exists
        existing = db.query(Schedule).filter(
            Schedule.worker_id == s.worker_id,
            Schedule.date == target_date,
        ).first()
        if existing:
            continue

        new_schedule = Schedule(
            worker_id=s.worker_id,
            date=target_date,
            shift_template_id=s.shift_template_id,
            custom_start_time=s.custom_start_time,
            custom_end_time=s.custom_end_time,
            total_hours=s.total_hours,
            is_day_off=s.is_day_off,
            notes=s.notes,
            created_by=user.id,
        )
        db.add(new_schedule)
        copied += 1

    # Audit
    audit = AuditLog(
        user_id=user.id,
        action="copy_week",
        entity_type="schedule",
        metadata_={"source_week": str(data.source_week), "target_week": str(data.target_week), "copied": copied},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(audit)
    db.commit()

    return {"success": True, "message": f"{copied} horarios copiados", "copied": copied}


# ── POST publish ───────────────────────────────────────────────
@router.post("/publish")
def publish_week(
    data: PublishRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    week_dates = get_week_dates(data.week_start)

    schedules = (
        db.query(Schedule)
        .join(Worker)
        .filter(
            Worker.branch_id == data.branch_id,
            Schedule.date.in_(week_dates),
        )
        .all()
    )

    if not schedules:
        raise HTTPException(status_code=400, detail="No hay horarios para publicar")

    now = datetime.utcnow()
    for s in schedules:
        s.status = "published"
        s.published_at = now

    # Update weekly status
    ws = db.query(WeeklyStatus).filter(
        WeeklyStatus.branch_id == data.branch_id,
        WeeklyStatus.week_start == data.week_start,
    ).first()
    if ws:
        ws.status = "published"
        ws.published_by = user.id
        ws.published_at = now
    else:
        ws = WeeklyStatus(
            branch_id=data.branch_id,
            week_start=data.week_start,
            status="published",
            published_by=user.id,
            published_at=now,
        )
        db.add(ws)

    # Audit
    audit = AuditLog(
        user_id=user.id,
        action="publish",
        entity_type="weekly_status",
        new_values={"branch_id": data.branch_id, "week_start": str(data.week_start), "count": len(schedules)},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(audit)
    db.commit()

    return {"success": True, "message": f"Semana publicada ({len(schedules)} horarios)"}


# ── POST swap ──────────────────────────────────────────────────
@router.post("/swap")
def swap_shifts(
    data: SwapRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    worker_a_id = data.swap_a["worker_id"]
    date_a = date.fromisoformat(data.swap_a["date"])
    worker_b_id = data.swap_b["worker_id"]
    date_b = date.fromisoformat(data.swap_b["date"])

    schedule_a = db.query(Schedule).filter(
        Schedule.worker_id == worker_a_id,
        Schedule.date == date_a,
    ).first()
    schedule_b = db.query(Schedule).filter(
        Schedule.worker_id == worker_b_id,
        Schedule.date == date_b,
    ).first()

    if not schedule_a or not schedule_b:
        raise HTTPException(status_code=404, detail="No se encontraron ambos horarios para intercambiar")

    # Save old values for audit
    old_a = {"worker_id": worker_a_id, "date": str(date_a), "hours": float(schedule_a.total_hours)}
    old_b = {"worker_id": worker_b_id, "date": str(date_b), "hours": float(schedule_b.total_hours)}

    # Swap the shift data
    (
        schedule_a.shift_template_id, schedule_b.shift_template_id
    ) = (
        schedule_b.shift_template_id, schedule_a.shift_template_id
    )
    (
        schedule_a.custom_start_time, schedule_b.custom_start_time
    ) = (
        schedule_b.custom_start_time, schedule_a.custom_start_time
    )
    (
        schedule_a.custom_end_time, schedule_b.custom_end_time
    ) = (
        schedule_b.custom_end_time, schedule_a.custom_end_time
    )
    (
        schedule_a.total_hours, schedule_b.total_hours
    ) = (
        schedule_b.total_hours, schedule_a.total_hours
    )
    (
        schedule_a.is_day_off, schedule_b.is_day_off
    ) = (
        schedule_b.is_day_off, schedule_a.is_day_off
    )
    (
        schedule_a.notes, schedule_b.notes
    ) = (
        schedule_b.notes, schedule_a.notes
    )

    schedule_a.updated_by = user.id
    schedule_b.updated_by = user.id

    # Audit
    audit = AuditLog(
        user_id=user.id,
        action="swap",
        entity_type="schedule",
        old_values={"a": old_a, "b": old_b},
        new_values={
            "a": {"worker_id": worker_a_id, "date": str(date_a), "hours": float(schedule_a.total_hours)},
            "b": {"worker_id": worker_b_id, "date": str(date_b), "hours": float(schedule_b.total_hours)},
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(audit)
    db.commit()

    return {
        "success": True,
        "message": "Turnos intercambiados exitosamente",
    }
