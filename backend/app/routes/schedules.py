from datetime import date, timedelta, datetime
from decimal import Decimal
from collections import defaultdict

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


# ── Helpers ────────────────────────────────────────────────────
def get_rule(db: Session, code: str, ref_date: date) -> float:
    rule = (
        db.query(LaborRule)
        .filter(
            LaborRule.rule_code == code,
            LaborRule.effective_from <= ref_date,
            (LaborRule.effective_until >= ref_date) | (LaborRule.effective_until.is_(None)),
        )
        .first()
    )
    defaults = {
        "MAX_WEEKLY_HOURS": 44.0, "MIN_WEEKLY_HOURS": 36.0,
        "MAX_CONSECUTIVE_DAYS": 6.0, "MIN_FREE_SUNDAYS": 2.0,
        "MAX_OVERTIME_DAILY_HOURS": 2.0, "OVERTIME_THRESHOLD": 44.0,
    }
    return float(rule.rule_value) if rule else defaults.get(code, 0.0)


def calculate_hours(start_time, end_time) -> float:
    dt_start = datetime.combine(date.today(), start_time)
    dt_end = datetime.combine(date.today(), end_time)
    return round((dt_end - dt_start).total_seconds() / 3600, 2)


def get_week_dates(week_start: date) -> list[date]:
    return [week_start + timedelta(days=i) for i in range(7)]


def validate_labor_rules(db: Session, worker_id: int, new_entries: list[ScheduleEntry], ref_date: date) -> list[str]:
    """
    Validate labor rules for a worker's schedule entries.
    Returns list of warning/error messages.
    """
    max_weekly = get_rule(db, "MAX_WEEKLY_HOURS", ref_date)
    min_weekly = get_rule(db, "MIN_WEEKLY_HOURS", ref_date)
    max_consecutive = int(get_rule(db, "MAX_CONSECUTIVE_DAYS", ref_date))
    min_free_sundays = int(get_rule(db, "MIN_FREE_SUNDAYS", ref_date))
    max_overtime_daily = get_rule(db, "MAX_OVERTIME_DAILY_HOURS", ref_date)
    overtime_threshold = get_rule(db, "OVERTIME_THRESHOLD", ref_date)

    errors = []
    total_hours = 0.0

    for entry in new_entries:
        if entry.is_day_off:
            continue

        daily_hours = 0.0
        if entry.shift_template_id:
            tpl = db.query(ShiftTemplate).filter(ShiftTemplate.id == entry.shift_template_id).first()
            if tpl:
                daily_hours = float(tpl.total_hours or 0)
        elif entry.custom_start_time and entry.custom_end_time:
            daily_hours = calculate_hours(entry.custom_start_time, entry.custom_end_time)

        # Max daily overtime check
        if daily_hours > (overtime_threshold / 5) + max_overtime_daily:
            errors.append(f"Día {entry.date}: excede máximo de horas extra diarias ({max_overtime_daily}h extra)")

        total_hours += daily_hours

    if total_hours > max_weekly:
        errors.append(f"Total semanal {total_hours}h excede el máximo de {max_weekly}h")
    if 0 < total_hours < min_weekly:
        errors.append(f"Total semanal {total_hours}h está bajo el mínimo de {min_weekly}h")

    return errors


def compute_locked_days(db: Session, worker_id: int, week_start: date, week_end: date, ref_date: date) -> set[date]:
    """
    Returns dates that must be locked (forced day-off) based on:
    1. 7th consecutive day rule
    2. Sunday rule: after 2 worked Sundays in the month, remaining are locked
    """
    locked = set()
    max_consecutive = int(get_rule(db, "MAX_CONSECUTIVE_DAYS", ref_date))
    min_free_sundays = int(get_rule(db, "MIN_FREE_SUNDAYS", ref_date))

    # Look at a wider window (3 weeks before + week range) for consecutive detection
    window_start = week_start - timedelta(days=max_consecutive * 2)
    all_schedules = (
        db.query(Schedule)
        .filter(Schedule.worker_id == worker_id, Schedule.date >= window_start, Schedule.date <= week_end)
        .order_by(Schedule.date)
        .all()
    )
    sched_map = {s.date: s for s in all_schedules}

    # Consecutive days check
    consecutive = 0
    for i in range((week_end - window_start).days + 2):
        d = window_start + timedelta(days=i)
        s = sched_map.get(d)
        if s and not s.is_day_off:
            consecutive += 1
            if consecutive >= max_consecutive and (d + timedelta(days=1)) <= week_end:
                locked.add(d + timedelta(days=1))
        else:
            consecutive = 0

    # Sunday rule: find all Sundays in the month of week_start
    month = week_start.month
    year = week_start.year
    all_sundays_in_month = [
        date(year, month, day)
        for day in range(1, 32)
        if date(year, month, day).weekday() == 6
        if date(year, month, day).month == month
    ]
    worked_sundays = sum(
        1 for sun in all_sundays_in_month
        if sun in sched_map and not sched_map[sun].is_day_off
    )
    if worked_sundays >= min_free_sundays:
        for sun in all_sundays_in_month:
            if sun >= week_start and sun not in sched_map:
                locked.add(sun)

    return locked


# ── GET schedules ──────────────────────────────────────────────
@router.get("")
def get_schedules(
    branch_id: Optional[int] = None,
    week_start: Optional[date] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    worker_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    query = db.query(Schedule).options(
        joinedload(Schedule.worker),
        joinedload(Schedule.shift_template),
    )

    if user.role == "manager":
        allowed_ids = {ub.branch_id for ub in user.user_branches}
        query = query.join(Worker).filter(Worker.branch_id.in_(allowed_ids))
    elif branch_id:
        query = query.join(Worker).filter(Worker.branch_id == branch_id)

    if week_start:
        week_end = week_start + timedelta(days=6)
        query = query.filter(Schedule.date >= week_start, Schedule.date <= week_end)
    elif date_from and date_to:
        query = query.filter(Schedule.date >= date_from, Schedule.date <= date_to)
    elif date_from:
        query = query.filter(Schedule.date >= date_from)
    elif date_to:
        query = query.filter(Schedule.date <= date_to)

    if worker_id:
        query = query.filter(Schedule.worker_id == worker_id)

    schedules = query.order_by(Schedule.worker_id, Schedule.date).all()

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
        hours = float(s.total_hours) if s.total_hours else 0
        workers_data[wid]["days"][s.date.isoformat()] = {
            "schedule_id": s.id,
            "is_day_off": s.is_day_off,
            "is_locked": s.is_locked,
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

    ref = week_start or date.today()
    max_hours = get_rule(db, "MAX_WEEKLY_HOURS", ref)
    min_hours = get_rule(db, "MIN_WEEKLY_HOURS", ref)

    return {
        "success": True,
        "data": {"week_start": str(week_start) if week_start else None, "workers": list(workers_data.values())},
        "meta": {"max_weekly_hours": max_hours, "min_weekly_hours": min_hours},
    }


# ── GET labor rules ────────────────────────────────────────────
@router.get("/labor-rules")
def get_labor_rules(
    ref_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """Returns all active labor rules for a given date (defaults to today)."""
    ref = ref_date or date.today()
    rules = db.query(LaborRule).filter(
        LaborRule.effective_from <= ref,
        (LaborRule.effective_until >= ref) | (LaborRule.effective_until.is_(None)),
    ).all()
    return [
        {"rule_code": r.rule_code, "rule_value": float(r.rule_value), "description": r.description}
        for r in rules
    ]


# ── POST bulk save ─────────────────────────────────────────────
@router.post("/bulk")
def save_bulk(
    data: ScheduleBulkRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    week_end = data.week_start + timedelta(days=6)
    created = updated = 0
    warnings = []

    # Group entries by worker for per-worker validation
    by_worker: dict[int, list[ScheduleEntry]] = defaultdict(list)
    for entry in data.schedules:
        by_worker[entry.worker_id].append(entry)

    for worker_id, entries in by_worker.items():
        w_warnings = validate_labor_rules(db, worker_id, entries, data.week_start)
        if w_warnings:
            worker = db.query(Worker).filter(Worker.id == worker_id).first()
            for msg in w_warnings:
                warnings.append(f"{worker.full_name if worker else worker_id}: {msg}")

        # Compute locked days
        locked_dates = compute_locked_days(db, worker_id, data.week_start, week_end, data.week_start)

    for entry in data.schedules:
        locked_dates = compute_locked_days(db, entry.worker_id, data.week_start, week_end, data.week_start)
        is_locked = entry.date in locked_dates

        # Calculate total_hours
        if entry.is_day_off or is_locked:
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

        existing = db.query(Schedule).filter(
            Schedule.worker_id == entry.worker_id,
            Schedule.date == entry.date,
        ).first()

        if existing:
            # Don't allow editing locked days
            if existing.is_locked:
                continue
            existing.shift_template_id = entry.shift_template_id
            existing.custom_start_time = entry.custom_start_time
            existing.custom_end_time = entry.custom_end_time
            existing.total_hours = total_hours
            existing.is_day_off = entry.is_day_off or is_locked
            existing.is_locked = is_locked
            existing.notes = entry.notes
            existing.updated_by = user.id
            updated += 1
        else:
            schedule = Schedule(
                worker_id=entry.worker_id,
                date=entry.date,
                shift_template_id=None if (entry.is_day_off or is_locked) else entry.shift_template_id,
                custom_start_time=entry.custom_start_time,
                custom_end_time=entry.custom_end_time,
                total_hours=total_hours,
                is_day_off=entry.is_day_off or is_locked,
                is_locked=is_locked,
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
        "warnings": warnings,
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
        .filter(Worker.branch_id == data.branch_id, Schedule.date.in_(source_dates))
        .all()
    )

    if not source_schedules:
        raise HTTPException(status_code=404, detail="No hay horarios en la semana origen")

    copied = 0
    for s in source_schedules:
        day_offset = (s.date - data.source_week).days
        target_date = data.target_week + timedelta(days=day_offset)
        existing = db.query(Schedule).filter(
            Schedule.worker_id == s.worker_id, Schedule.date == target_date
        ).first()
        if existing:
            continue
        db.add(Schedule(
            worker_id=s.worker_id, date=target_date,
            shift_template_id=s.shift_template_id,
            custom_start_time=s.custom_start_time, custom_end_time=s.custom_end_time,
            total_hours=s.total_hours, is_day_off=s.is_day_off,
            notes=s.notes, created_by=user.id,
        ))
        copied += 1

    db.add(AuditLog(
        user_id=user.id, action="copy_week", entity_type="schedule",
        metadata_={"source_week": str(data.source_week), "target_week": str(data.target_week), "copied": copied},
        ip_address=request.client.host if request.client else None,
    ))
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
        db.query(Schedule).join(Worker)
        .filter(Worker.branch_id == data.branch_id, Schedule.date.in_(week_dates))
        .all()
    )
    if not schedules:
        raise HTTPException(status_code=400, detail="No hay horarios para publicar")

    now = datetime.utcnow()
    for s in schedules:
        s.status = "published"
        s.published_at = now

    ws = db.query(WeeklyStatus).filter(
        WeeklyStatus.branch_id == data.branch_id, WeeklyStatus.week_start == data.week_start
    ).first()
    if ws:
        ws.status = "published"; ws.published_by = user.id; ws.published_at = now
    else:
        db.add(WeeklyStatus(
            branch_id=data.branch_id, week_start=data.week_start,
            status="published", published_by=user.id, published_at=now,
        ))

    db.add(AuditLog(
        user_id=user.id, action="publish", entity_type="weekly_status",
        new_values={"branch_id": data.branch_id, "week_start": str(data.week_start), "count": len(schedules)},
        ip_address=request.client.host if request.client else None,
    ))
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

    schedule_a = db.query(Schedule).filter(Schedule.worker_id == worker_a_id, Schedule.date == date_a).first()
    schedule_b = db.query(Schedule).filter(Schedule.worker_id == worker_b_id, Schedule.date == date_b).first()

    if not schedule_a or not schedule_b:
        raise HTTPException(status_code=404, detail="No se encontraron ambos horarios para intercambiar")
    if schedule_a.is_locked or schedule_b.is_locked:
        raise HTTPException(status_code=400, detail="No se pueden intercambiar días bloqueados")

    old_a = {"worker_id": worker_a_id, "date": str(date_a)}
    old_b = {"worker_id": worker_b_id, "date": str(date_b)}

    (schedule_a.shift_template_id, schedule_b.shift_template_id) = (schedule_b.shift_template_id, schedule_a.shift_template_id)
    (schedule_a.custom_start_time, schedule_b.custom_start_time) = (schedule_b.custom_start_time, schedule_a.custom_start_time)
    (schedule_a.custom_end_time, schedule_b.custom_end_time) = (schedule_b.custom_end_time, schedule_a.custom_end_time)
    (schedule_a.total_hours, schedule_b.total_hours) = (schedule_b.total_hours, schedule_a.total_hours)
    (schedule_a.is_day_off, schedule_b.is_day_off) = (schedule_b.is_day_off, schedule_a.is_day_off)
    (schedule_a.notes, schedule_b.notes) = (schedule_b.notes, schedule_a.notes)
    schedule_a.updated_by = schedule_b.updated_by = user.id

    db.add(AuditLog(
        user_id=user.id, action="swap", entity_type="schedule",
        old_values={"a": old_a, "b": old_b},
        new_values={"a": {"worker_id": worker_b_id}, "b": {"worker_id": worker_a_id}},
        ip_address=request.client.host if request.client else None,
    ))
    db.commit()
    return {"success": True, "message": "Turnos intercambiados exitosamente"}
