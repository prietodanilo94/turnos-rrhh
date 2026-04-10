from datetime import datetime, date, time, timedelta
from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator
import re


# ── Common ─────────────────────────────────────────────────────
class PaginatedResponse(BaseModel):
    total: int
    page: int
    per_page: int
    pages: int


class MessageResponse(BaseModel):
    success: bool
    message: str


# ── RUT Validator ──────────────────────────────────────────────
def normalize_rut(rut: str) -> str:
    """Normalize RUT: remove dots and dashes, uppercase."""
    return rut.replace(".", "").replace("-", "").replace(" ", "").upper()


def validate_rut(rut: str) -> str:
    """Validate and format Chilean RUT."""
    cleaned = normalize_rut(rut)
    if len(cleaned) < 2:
        raise ValueError("RUT inválido")

    body = cleaned[:-1]
    dv = cleaned[-1]

    if not body.isdigit():
        raise ValueError("RUT inválido: cuerpo debe ser numérico")

    # Validate check digit
    total = 0
    factor = 2
    for digit in reversed(body):
        total += int(digit) * factor
        factor = factor + 1 if factor < 7 else 2

    remainder = 11 - (total % 11)
    expected_dv = "K" if remainder == 10 else "0" if remainder == 11 else str(remainder)

    if dv != expected_dv:
        raise ValueError(f"RUT inválido: dígito verificador incorrecto")

    # Format: XX.XXX.XXX-X
    formatted_body = f"{int(body):,}".replace(",", ".")
    return f"{formatted_body}-{dv}"


def rut_for_lookup(rut: str) -> str:
    """Normalize RUT for DB lookup. Accepts: 12345678-9, 12.345.678-9, 123456789"""
    cleaned = normalize_rut(rut)
    # If no DV separator and all digits, add dash before last char
    if len(cleaned) >= 2:
        body = cleaned[:-1]
        dv = cleaned[-1]
        formatted_body = f"{int(body):,}".replace(",", ".")
        return f"{formatted_body}-{dv}"
    return rut


# ── Auth ───────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    rut: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class BranchSimple(BaseModel):
    id: int
    name: str
    code: str

    class Config:
        from_attributes = True


class UserResponse(BaseModel):
    id: int
    rut: str
    first_name: str
    last_name: str
    email: Optional[str] = None
    role: str
    branches: list[BranchSimple] = []
    default_branch_id: Optional[int] = None
    is_active: bool

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse


# ── Branch ─────────────────────────────────────────────────────
class BranchCreate(BaseModel):
    name: str
    code: str
    address: Optional[str] = None
    region: Optional[str] = None


class BranchUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    address: Optional[str] = None
    region: Optional[str] = None
    is_active: Optional[bool] = None


class BranchResponse(BaseModel):
    id: int
    name: str
    code: str
    address: Optional[str]
    region: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


# ── Worker ─────────────────────────────────────────────────────
class WorkerCreate(BaseModel):
    rut: str
    first_name: str
    last_name: str
    branch_id: int
    position: Optional[str] = None
    contract_type: str = "indefinido"
    contracted_weekly_hours: int = 42
    hire_date: date

    @field_validator("rut")
    @classmethod
    def validate_worker_rut(cls, v):
        return validate_rut(v)

    @field_validator("contract_type")
    @classmethod
    def validate_contract(cls, v):
        valid = ["indefinido", "plazo_fijo", "part_time", "honorarios"]
        if v not in valid:
            raise ValueError(f"Tipo de contrato debe ser uno de: {valid}")
        return v


class WorkerUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    branch_id: Optional[int] = None
    position: Optional[str] = None
    contract_type: Optional[str] = None
    contracted_weekly_hours: Optional[int] = None
    termination_date: Optional[date] = None
    is_active: Optional[bool] = None


class WorkerResponse(BaseModel):
    id: int
    rut: str
    first_name: str
    last_name: str
    branch_id: int
    branch: Optional[BranchResponse] = None
    position: Optional[str]
    contract_type: str
    contracted_weekly_hours: int
    hire_date: date
    termination_date: Optional[date]
    is_active: bool

    class Config:
        from_attributes = True


# ── Shift Template ─────────────────────────────────────────────
class ShiftTemplateCreate(BaseModel):
    name: str
    code: str
    start_time: time
    end_time: time
    color: str = "#3B82F6"
    branch_id: Optional[int] = None
    is_global: bool = False

    @field_validator("end_time")
    @classmethod
    def validate_times(cls, v, info):
        if "start_time" in info.data and v <= info.data["start_time"]:
            raise ValueError("La hora de fin debe ser posterior a la de inicio")
        return v


class ShiftTemplateUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None


class ShiftTemplateResponse(BaseModel):
    id: int
    name: str
    code: str
    start_time: time
    end_time: time
    total_hours: Optional[float] = None
    color: str
    branch_id: Optional[int]
    is_global: bool
    is_active: bool

    class Config:
        from_attributes = True


# ── Schedule ───────────────────────────────────────────────────
class ScheduleEntry(BaseModel):
    worker_id: int
    date: date
    shift_template_id: Optional[int] = None
    custom_start_time: Optional[time] = None
    custom_end_time: Optional[time] = None
    is_day_off: bool = False
    notes: Optional[str] = None


class ScheduleBulkRequest(BaseModel):
    branch_id: int
    week_start: date
    schedules: list[ScheduleEntry]


class CopyWeekRequest(BaseModel):
    branch_id: int
    source_week: date
    target_week: date


class PublishRequest(BaseModel):
    branch_id: int
    week_start: date


class SwapRequest(BaseModel):
    swap_a: dict  # { worker_id, date }
    swap_b: dict  # { worker_id, date }


class ScheduleResponse(BaseModel):
    id: int
    worker_id: int
    date: date
    shift_template_id: Optional[int]
    custom_start_time: Optional[time]
    custom_end_time: Optional[time]
    total_hours: float
    is_day_off: bool
    is_locked: bool = False
    status: str
    notes: Optional[str]

    class Config:
        from_attributes = True


# ── User Management ────────────────────────────────────────────
class UserCreate(BaseModel):
    rut: str
    password: str = "1234"
    first_name: str
    last_name: str
    email: Optional[str] = None
    role: str = "manager"
    branch_ids: list[int] = []
    default_branch_id: Optional[int] = None

    @field_validator("rut")
    @classmethod
    def validate_user_rut(cls, v):
        return validate_rut(v)

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        valid = ["admin", "manager", "viewer"]
        if v not in valid:
            raise ValueError(f"Rol debe ser uno de: {valid}")
        return v


class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    branch_ids: Optional[list[int]] = None
    default_branch_id: Optional[int] = None
    is_active: Optional[bool] = None


# ── Labor Rules ────────────────────────────────────────────────
class LaborRuleResponse(BaseModel):
    id: int
    rule_code: str
    rule_value: float
    effective_from: date
    effective_until: Optional[date]
    description: Optional[str]

    class Config:
        from_attributes = True


# ── Status / Completeness ─────────────────────────────────────
class BranchCompleteness(BaseModel):
    branch_id: int
    branch_name: str
    branch_code: str
    total_workers: int
    workers_with_schedules: int
    is_complete: bool
    status: str  # 'complete', 'incomplete', 'empty'


class CompletenessResponse(BaseModel):
    week_start: date
    complete: list[BranchCompleteness]
    incomplete: list[BranchCompleteness]


# ── Audit Log ─────────────────────────────────────────────────
class AuditLogResponse(BaseModel):
    id: int
    user_rut: Optional[str] = None
    user_name: Optional[str] = None
    action: str
    entity_type: str
    entity_id: Optional[int]
    old_values: Optional[dict] = None
    new_values: Optional[dict] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Monthly Planner ────────────────────────────────────────

VALID_EXCEPTION_TYPES = ["vacaciones", "licencia", "permiso", "traslado", "bloqueo"]
VALID_MONTHLY_MODES   = ["simulation", "planning"]
VALID_MONTHLY_STATUSES = ["draft", "generated", "validated", "exported"]


class MonthlyPlanCreate(BaseModel):
    branch_id:   int
    year:        int
    month:       int
    mode:        str = "planning"
    dotation:    int
    shift_count: int = 4
    name:        Optional[str] = None

    @field_validator("month")
    @classmethod
    def validate_month(cls, v):
        if not 1 <= v <= 12:
            raise ValueError("El mes debe estar entre 1 y 12")
        return v

    @field_validator("year")
    @classmethod
    def validate_year(cls, v):
        if not 2020 <= v <= 2100:
            raise ValueError("Año fuera de rango válido")
        return v

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v):
        if v not in VALID_MONTHLY_MODES:
            raise ValueError(f"Modo debe ser uno de: {VALID_MONTHLY_MODES}")
        return v

    @field_validator("dotation")
    @classmethod
    def validate_dotation(cls, v):
        if v < 1:
            raise ValueError("La dotación debe ser al menos 1")
        return v

    @field_validator("shift_count")
    @classmethod
    def validate_shift_count(cls, v):
        if not 1 <= v <= 10:
            raise ValueError("El número de turnos debe estar entre 1 y 10")
        return v


class MonthlyPlanUpdate(BaseModel):
    mode:        Optional[str] = None
    status:      Optional[str] = None
    dotation:    Optional[int] = None
    shift_count: Optional[int] = None
    name:        Optional[str] = None


class MonthlyPlanResponse(BaseModel):
    id:          int
    branch_id:   int
    year:        int
    month:       int
    mode:        str
    status:      str
    dotation:    int
    shift_count: int
    name:        Optional[str]
    created_by:  int
    created_at:  datetime
    updated_at:  datetime

    class Config:
        from_attributes = True


class MonthlyExceptionCreate(BaseModel):
    worker_id: int
    type:      str
    date_from: date
    date_to:   date
    note:      Optional[str] = None

    @field_validator("type")
    @classmethod
    def validate_type(cls, v):
        if v not in VALID_EXCEPTION_TYPES:
            raise ValueError(f"Tipo debe ser uno de: {VALID_EXCEPTION_TYPES}")
        return v

    @field_validator("date_to")
    @classmethod
    def validate_dates(cls, v, info):
        if "date_from" in info.data and v < info.data["date_from"]:
            raise ValueError("date_to debe ser igual o posterior a date_from")
        return v


class MonthlyExceptionResponse(BaseModel):
    id:        int
    plan_id:   int
    worker_id: int
    type:      str
    date_from: date
    date_to:   date
    note:      Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class MonthlyAssignmentEntry(BaseModel):
    worker_id:      Optional[int] = None   # null = placeholder
    day:            int
    shift_code:     Optional[str] = None   # null = día libre
    time_text:      Optional[str] = None   # "09:00 a 18:00"
    is_day_off:     bool = False
    is_placeholder: bool = False

    @field_validator("day")
    @classmethod
    def validate_day(cls, v):
        if not 1 <= v <= 31:
            raise ValueError("El día debe estar entre 1 y 31")
        return v


class MonthlyAssignmentBulk(BaseModel):
    assignments: list[MonthlyAssignmentEntry]


class MonthlyAssignmentResponse(BaseModel):
    id:             int
    plan_id:        int
    worker_id:      Optional[int]
    day:            int
    shift_code:     Optional[str]
    time_text:      Optional[str]
    is_day_off:     bool
    is_placeholder: bool

    class Config:
        from_attributes = True


class MonthlyPlanFull(BaseModel):
    """Full plan with exceptions and assignments (used in GET /{id})."""
    id:          int
    branch_id:   int
    year:        int
    month:       int
    mode:        str
    status:      str
    dotation:    int
    shift_count: int
    name:        Optional[str]
    created_by:  int
    created_at:  datetime
    updated_at:  datetime
    exceptions:  list[MonthlyExceptionResponse] = []
    assignments: list[MonthlyAssignmentResponse] = []

    class Config:
        from_attributes = True
