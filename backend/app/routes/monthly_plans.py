"""
Monthly Planner API — TurnosRRHH
=================================
Endpoints para gestionar planes mensuales de horario.

Prefix: /api/monthly-plans

Endpoints:
    POST   /                         → Crear plan mensual
    GET    /?branch_id=&year=&month= → Listar planes (filtros opcionales)
    GET    /{id}                     → Obtener plan completo (con excepciones + asignaciones)
    PUT    /{id}                     → Actualizar cabecera del plan
    DELETE /{id}                     → Eliminar plan
    POST   /{id}/exceptions          → Agregar excepción mensual
    DELETE /{id}/exceptions/{exc_id} → Eliminar excepción
    PUT    /{id}/assignments          → Guardar asignaciones (bulk upsert)
    POST   /{id}/generate            → Generar propuesta automática usando shift_templates reales
    GET    /{id}/export/excel        → Descargar Excel formato carga (RUT + DIA1..DIA31)
"""

from calendar import monthrange
from datetime import date, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
import io

from app.database import get_db
from app.models import (
    MonthlyPlan, MonthlyPlanException, MonthlyPlanAssignment,
    Branch, Worker, ShiftTemplate, User,
)
from app.schemas import (
    MonthlyPlanCreate, MonthlyPlanUpdate, MonthlyPlanResponse,
    MonthlyPlanFull,
    MonthlyExceptionCreate, MonthlyExceptionResponse,
    MonthlyAssignmentBulk, MonthlyAssignmentResponse,
)
from app.auth import require_role

router = APIRouter(prefix="/api/monthly-plans", tags=["Monthly Planner"])


# ──────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────

def _get_plan_or_404(plan_id: int, db: Session) -> MonthlyPlan:
    plan = db.query(MonthlyPlan).filter(MonthlyPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan mensual no encontrado")
    return plan


def _format_time(t: time) -> str:
    """Convert time object to 'HH:MM' string."""
    return t.strftime("%H:%M")


def _time_text(start: time, end: time) -> str:
    """Format as 'HH:MM a HH:MM' — formato exacto para export de carga."""
    return f"{_format_time(start)} a {_format_time(end)}"


def _load_shift_templates(branch_id: int, db: Session) -> list[ShiftTemplate]:
    """Load active shift templates for a branch: branch-specific first, then global."""
    templates = (
        db.query(ShiftTemplate)
        .filter(
            ShiftTemplate.is_active == True,
            (ShiftTemplate.branch_id == branch_id) | (ShiftTemplate.is_global == True),
        )
        .order_by(ShiftTemplate.branch_id.desc().nulls_last(), ShiftTemplate.start_time)
        .all()
    )
    return templates


def _build_exception_set(exceptions: list[MonthlyPlanException], year: int, month: int) -> dict:
    """
    Returns {worker_id: set_of_blocked_days} for the given month.
    Only considers exceptions that overlap with the given year/month.
    """
    blocked: dict[int, set] = {}
    month_start = date(year, month, 1)
    days_in_month = monthrange(year, month)[1]
    month_end = date(year, month, days_in_month)

    for exc in exceptions:
        # Clip exception range to current month
        eff_from = max(exc.date_from, month_start)
        eff_to   = min(exc.date_to,   month_end)
        if eff_from > eff_to:
            continue
        blocked.setdefault(exc.worker_id, set())
        for d in range(eff_from.day, eff_to.day + 1):
            blocked[exc.worker_id].add(d)

    return blocked


def _generate_assignments(
    plan: MonthlyPlan,
    workers: list[Worker],
    templates: list[ShiftTemplate],
    db: Session,
) -> list[dict]:
    """
    Genera propuesta automática de asignaciones mensuales.

    Algoritmo:
    - Para cada día del mes, para cada worker:
        1. Si es domingo → libre (cumple regla mínimo 2 domingos libres)
        2. Si el día está bloqueado por excepción → libre
        3. Si el worker llevaría 6 días consecutivos → libre (regla máx consecutivos)
        4. En caso contrario → asignar turno rotando entre templates disponibles

    La rotación de turnos es por (worker_index + day - 1) % len(templates)
    para distribuir los turnos equitativamente.
    """
    year  = plan.year
    month = plan.month
    days_in_month = monthrange(year, month)[1]

    # Limitar templates según shift_count del plan
    active_templates = templates[:max(1, min(plan.shift_count, len(templates)))]
    if not active_templates:
        return []

    # Cargar excepciones del plan
    blocked = _build_exception_set(plan.exceptions, year, month)

    # Calcular días de la semana para cada día del mes (1-indexed)
    def weekday_of(day: int) -> int:
        """0=Monday .. 6=Sunday"""
        return date(year, month, day).weekday()

    def is_sunday(day: int) -> bool:
        return weekday_of(day) == 6

    assignments = []

    for worker_index, worker in enumerate(workers):
        worker_blocked = blocked.get(worker.id, set())
        consecutive_work_days = 0
        sunday_count = 0  # Sundays already assigned as libre this month

        for day in range(1, days_in_month + 1):
            day_date = date(year, month, day)
            is_day_off = False
            shift_code = None
            time_text  = None

            # Regla 1: domingo → libre (hasta que hayamos dado ≥ 2 libres)
            if is_sunday(day):
                is_day_off = True
                sunday_count += 1
                consecutive_work_days = 0

            # Regla 2: excepción (vacaciones, licencia, etc.) → libre
            elif day in worker_blocked:
                is_day_off = True
                consecutive_work_days = 0

            # Regla 3: 6 días consecutivos → día de descanso obligatorio
            elif consecutive_work_days >= 6:
                is_day_off = True
                consecutive_work_days = 0

            # Asignar turno
            else:
                template = active_templates[(worker_index + day - 1) % len(active_templates)]
                shift_code = template.code
                time_text  = _time_text(template.start_time, template.end_time)
                consecutive_work_days += 1

            assignments.append({
                "worker_id":      worker.id,
                "day":            day,
                "shift_code":     shift_code,
                "time_text":      time_text,
                "is_day_off":     is_day_off,
                "is_placeholder": False,
            })

    # Placeholders si dotacion > len(workers)
    for placeholder_index in range(len(workers), plan.dotation):
        for day in range(1, days_in_month + 1):
            is_sunday_day = is_sunday(day)
            if is_sunday_day:
                assignments.append({
                    "worker_id": None, "day": day,
                    "shift_code": None, "time_text": None,
                    "is_day_off": True, "is_placeholder": True,
                })
            else:
                template = active_templates[(placeholder_index + day - 1) % len(active_templates)]
                assignments.append({
                    "worker_id": None, "day": day,
                    "shift_code": template.code,
                    "time_text": _time_text(template.start_time, template.end_time),
                    "is_day_off": False, "is_placeholder": True,
                })

    return assignments


# ──────────────────────────────────────────────────────────
# Endpoints — CRUD
# ──────────────────────────────────────────────────────────

@router.post("", response_model=MonthlyPlanResponse, status_code=201)
def create_plan(
    data: MonthlyPlanCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """Crear un nuevo plan mensual. Se permiten múltiples planes por sucursal/mes."""
    branch = db.query(Branch).filter(Branch.id == data.branch_id, Branch.is_active == True).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")

    plan = MonthlyPlan(
        branch_id   = data.branch_id,
        year        = data.year,
        month       = data.month,
        mode        = data.mode,
        dotation    = data.dotation,
        shift_count = data.shift_count,
        name        = data.name,
        created_by  = user.id,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


@router.get("", response_model=list[MonthlyPlanResponse])
def list_plans(
    branch_id: Optional[int] = Query(None),
    year:      Optional[int] = Query(None),
    month:     Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """Listar planes mensuales con filtros opcionales."""
    query = db.query(MonthlyPlan)
    if branch_id:
        query = query.filter(MonthlyPlan.branch_id == branch_id)
    if year:
        query = query.filter(MonthlyPlan.year == year)
    if month:
        query = query.filter(MonthlyPlan.month == month)
    return query.order_by(MonthlyPlan.created_at.desc()).all()


@router.get("/{plan_id}", response_model=MonthlyPlanFull)
def get_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """Obtener plan completo con excepciones y asignaciones."""
    plan = (
        db.query(MonthlyPlan)
        .options(
            joinedload(MonthlyPlan.exceptions),
            joinedload(MonthlyPlan.assignments),
        )
        .filter(MonthlyPlan.id == plan_id)
        .first()
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Plan mensual no encontrado")
    return plan


@router.put("/{plan_id}", response_model=MonthlyPlanResponse)
def update_plan(
    plan_id: int,
    data: MonthlyPlanUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """Actualizar cabecera del plan (modo, dotación, shift_count, nombre, status)."""
    plan = _get_plan_or_404(plan_id, db)
    if data.mode        is not None: plan.mode        = data.mode
    if data.status      is not None: plan.status      = data.status
    if data.dotation    is not None: plan.dotation    = data.dotation
    if data.shift_count is not None: plan.shift_count = data.shift_count
    if data.name        is not None: plan.name        = data.name
    plan.updated_by = user.id
    db.commit()
    db.refresh(plan)
    return plan


@router.delete("/{plan_id}")
def delete_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """Eliminar un plan mensual (cascada a excepciones y asignaciones)."""
    plan = _get_plan_or_404(plan_id, db)
    db.delete(plan)
    db.commit()
    return {"success": True, "message": f"Plan {plan_id} eliminado"}


# ──────────────────────────────────────────────────────────
# Endpoints — Excepciones
# ──────────────────────────────────────────────────────────

@router.post("/{plan_id}/exceptions", response_model=MonthlyExceptionResponse, status_code=201)
def add_exception(
    plan_id: int,
    data: MonthlyExceptionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """Agregar una excepción mensual (vacaciones, licencia, etc.) al plan."""
    plan = _get_plan_or_404(plan_id, db)
    worker = db.query(Worker).filter(Worker.id == data.worker_id, Worker.is_active == True).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")

    exc = MonthlyPlanException(
        plan_id   = plan_id,
        worker_id = data.worker_id,
        type      = data.type,
        date_from = data.date_from,
        date_to   = data.date_to,
        note      = data.note,
    )
    db.add(exc)
    db.commit()
    db.refresh(exc)
    return exc


@router.delete("/{plan_id}/exceptions/{exc_id}")
def delete_exception(
    plan_id: int,
    exc_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """Eliminar una excepción del plan."""
    exc = db.query(MonthlyPlanException).filter(
        MonthlyPlanException.id == exc_id,
        MonthlyPlanException.plan_id == plan_id,
    ).first()
    if not exc:
        raise HTTPException(status_code=404, detail="Excepción no encontrada")
    db.delete(exc)
    db.commit()
    return {"success": True, "message": f"Excepción {exc_id} eliminada"}


# ──────────────────────────────────────────────────────────
# Endpoints — Asignaciones (bulk upsert)
# ──────────────────────────────────────────────────────────

@router.put("/{plan_id}/assignments", response_model=list[MonthlyAssignmentResponse])
def save_assignments(
    plan_id: int,
    data: MonthlyAssignmentBulk,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """
    Guardar asignaciones del plan (bulk upsert).
    Si ya existe una asignación para (plan_id, worker_id, day), se actualiza.
    Si no existe, se crea.
    """
    _get_plan_or_404(plan_id, db)

    created = updated = 0
    result = []

    for entry in data.assignments:
        # Buscar registro existente
        existing = db.query(MonthlyPlanAssignment).filter(
            MonthlyPlanAssignment.plan_id   == plan_id,
            MonthlyPlanAssignment.worker_id == entry.worker_id,
            MonthlyPlanAssignment.day       == entry.day,
        ).first()

        if existing:
            existing.shift_code     = entry.shift_code
            existing.time_text      = entry.time_text
            existing.is_day_off     = entry.is_day_off
            existing.is_placeholder = entry.is_placeholder
            result.append(existing)
            updated += 1
        else:
            new_asgn = MonthlyPlanAssignment(
                plan_id        = plan_id,
                worker_id      = entry.worker_id,
                day            = entry.day,
                shift_code     = entry.shift_code,
                time_text      = entry.time_text,
                is_day_off     = entry.is_day_off,
                is_placeholder = entry.is_placeholder,
            )
            db.add(new_asgn)
            result.append(new_asgn)
            created += 1

    db.commit()
    for r in result:
        db.refresh(r)

    return result


# ──────────────────────────────────────────────────────────
# Endpoint — Generate (propuesta automática)
# ──────────────────────────────────────────────────────────

@router.post("/{plan_id}/generate")
def generate_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """
    Generar propuesta automática de asignaciones mensuales.

    - Usa los shift_templates reales activos de la sucursal.
    - Respeta: domingos libres, máx 6 días consecutivos, excepciones del plan.
    - Borra asignaciones previas del plan antes de generar las nuevas.
    - Actualiza status a 'generated'.
    """
    plan = (
        db.query(MonthlyPlan)
        .options(joinedload(MonthlyPlan.exceptions))
        .filter(MonthlyPlan.id == plan_id)
        .first()
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Plan mensual no encontrado")

    # Cargar workers activos de la sucursal
    workers = (
        db.query(Worker)
        .filter(Worker.branch_id == plan.branch_id, Worker.is_active == True)
        .order_by(Worker.last_name, Worker.first_name)
        .all()
    )
    if not workers:
        raise HTTPException(status_code=400, detail="No hay trabajadores activos en la sucursal")

    # Cargar templates activos de la sucursal
    templates = _load_shift_templates(plan.branch_id, db)
    if not templates:
        raise HTTPException(status_code=400, detail="No hay plantillas de turno activas para la sucursal")

    # Borrar asignaciones previas
    db.query(MonthlyPlanAssignment).filter(
        MonthlyPlanAssignment.plan_id == plan_id
    ).delete()

    # Generar nuevas asignaciones
    assignments_data = _generate_assignments(plan, workers, templates, db)

    for asgn in assignments_data:
        db.add(MonthlyPlanAssignment(plan_id=plan_id, **asgn))

    # Actualizar status
    plan.status = "generated"
    plan.updated_by = user.id
    db.commit()

    # Contar stats
    total = len(assignments_data)
    with_shift = sum(1 for a in assignments_data if a["shift_code"])
    days_off   = sum(1 for a in assignments_data if a["is_day_off"])

    return {
        "success": True,
        "plan_id": plan_id,
        "message": f"Propuesta generada: {total} asignaciones ({with_shift} con turno, {days_off} libres)",
        "stats": {
            "total_assignments": total,
            "with_shift": with_shift,
            "days_off": days_off,
            "templates_used": [t.code for t in templates[:plan.shift_count]],
            "workers_count": len(workers),
        },
    }


# ──────────────────────────────────────────────────────────
# Endpoint — Export Excel (formato de carga)
# ──────────────────────────────────────────────────────────

@router.get("/{plan_id}/export/excel")
def export_excel(
    plan_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    """
    Exportar plan mensual en formato Excel de carga.

    Formato exacto:
    - Columna A: RUT del trabajador
    - Columnas B-AF: DIA1 a DIA31 (siempre 31 columnas, sin importar el mes)
    - Valor celda: "HH:MM a HH:MM"
    - Día libre: celda vacía
    - Día inexistente en el mes (ej: día 31 de abril): celda vacía
    - No incluye placeholders (solo workers con RUT real)
    """
    import openpyxl
    from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    plan = (
        db.query(MonthlyPlan)
        .options(
            joinedload(MonthlyPlan.assignments).joinedload(MonthlyPlanAssignment.worker),
            joinedload(MonthlyPlan.branch),
        )
        .filter(MonthlyPlan.id == plan_id)
        .first()
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Plan mensual no encontrado")

    days_in_month = monthrange(plan.year, plan.month)[1]

    # Construir mapa: {worker_id: {day: time_text}}
    asgn_map: dict[int, dict[int, str]] = {}
    worker_ruts: dict[int, str] = {}

    for asgn in plan.assignments:
        if asgn.is_placeholder or asgn.worker_id is None:
            continue  # Excluir placeholders del export
        if asgn.worker_id not in asgn_map:
            asgn_map[asgn.worker_id] = {}
            if asgn.worker:
                worker_ruts[asgn.worker_id] = asgn.worker.rut
        # Solo almacenar si hay turno (time_text no vacío)
        if asgn.time_text and not asgn.is_day_off:
            asgn_map[asgn.worker_id][asgn.day] = asgn.time_text

    # Ordenar workers por RUT
    sorted_worker_ids = sorted(asgn_map.keys(), key=lambda wid: worker_ruts.get(wid, ""))

    wb = openpyxl.Workbook()
    ws = wb.active

    # Nombre de mes en español
    month_names = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                   "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]
    month_name = month_names[plan.month - 1]
    ws.title = f"{month_name} {plan.year}"

    # ── Estilos ──
    header_fill  = PatternFill("solid", fgColor="1E3A5F")
    header_font  = Font(color="FFFFFF", bold=True, size=10)
    subhdr_fill  = PatternFill("solid", fgColor="2D5A8E")
    subhdr_font  = Font(color="FFFFFF", bold=True, size=9)
    center_align = Alignment(horizontal="center", vertical="center")
    left_align   = Alignment(horizontal="left",   vertical="center")
    rut_font     = Font(size=9)
    thin_border  = Border(
        left=Side(style="thin", color="C5D3E0"),
        right=Side(style="thin", color="C5D3E0"),
        top=Side(style="thin", color="C5D3E0"),
        bottom=Side(style="thin", color="C5D3E0"),
    )

    # ── Fila 1: Info del plan ──
    last_col_letter = get_column_letter(32)  # A + 31 columnas DIA = AF
    ws.merge_cells(f"A1:{last_col_letter}1")
    branch_name = plan.branch.name if plan.branch else f"Sucursal {plan.branch_id}"
    plan_label  = plan.name or f"Plan {plan.id}"
    ws["A1"] = (
        f"PLANIFICACIÓN MENSUAL — {branch_name}  |  "
        f"{month_name} {plan.year}  |  {plan_label}  |  "
        f"Modo: {plan.mode.upper()}"
    )
    ws["A1"].font      = Font(bold=True, size=11, color="1E3A5F")
    ws["A1"].alignment = left_align

    # ── Fila 2: Headers (RUT + DIA1..DIA31) ──
    # Columna A = RUT
    cell_rut = ws.cell(row=2, column=1, value="RUT")
    cell_rut.fill      = header_fill
    cell_rut.font      = header_font
    cell_rut.alignment = center_align
    cell_rut.border    = thin_border
    ws.column_dimensions["A"].width = 15

    # Columnas B-AF = DIA1..DIA31
    for d in range(1, 32):
        col = d + 1  # B=2, C=3, ..., AF=32
        col_letter = get_column_letter(col)

        header_val = f"DIA{d}"
        cell_h = ws.cell(row=2, column=col, value=header_val)
        cell_h.fill      = subhdr_fill
        cell_h.font      = subhdr_font
        cell_h.alignment = center_align
        cell_h.border    = thin_border
        ws.column_dimensions[col_letter].width = 13

    # ── Filas de datos ──
    for row_i, worker_id in enumerate(sorted_worker_ids, start=3):
        rut = worker_ruts.get(worker_id, "—")
        days_map = asgn_map.get(worker_id, {})

        # Columna A — RUT
        cell_rut_data = ws.cell(row=row_i, column=1, value=rut)
        cell_rut_data.font      = rut_font
        cell_rut_data.alignment = center_align
        cell_rut_data.border    = thin_border

        # Columnas DIA1..DIA31
        for d in range(1, 32):
            col = d + 1
            cell = ws.cell(row=row_i, column=col)
            cell.border = thin_border
            cell.alignment = center_align

            if d > days_in_month:
                # Día que no existe en el mes → celda vacía (sin valor)
                cell.fill = PatternFill("solid", fgColor="F5F5F5")
            else:
                time_val = days_map.get(d)  # None si es día libre
                if time_val:
                    cell.value = time_val
                    cell.font  = Font(size=8)
                # else → día libre → celda vacía (sin valor)

    # ── Ajuste de filas ──
    ws.row_dimensions[1].height = 22
    ws.row_dimensions[2].height = 18
    for r in range(3, 3 + len(sorted_worker_ids)):
        ws.row_dimensions[r].height = 16

    # ── Freeze panes: congelar fila de headers y columna RUT ──
    ws.freeze_panes = "B3"

    # ── Stream ──
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    branch_code = plan.branch.code if plan.branch else str(plan.branch_id)
    filename = f"plan_mensual_{branch_code}_{plan.year}_{plan.month:02d}.xlsx"

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
