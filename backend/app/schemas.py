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
def validate_rut(rut: str) -> str:
    """Validate and normalize Chilean RUT."""
    cleaned = rut.replace(".", "").replace("-", "").upper()
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


# ── Auth ───────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserResponse(BaseModel):
    id: int
    email: str
    first_name: str
    last_name: str
    rut: str
    role: str
    branch_id: Optional[int] = None
    branch_name: Optional[str] = None
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
    contracted_weekly_hours: int = 44
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
    status: str
    notes: Optional[str]

    class Config:
        from_attributes = True


# ── User Management ────────────────────────────────────────────
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    rut: str
    role: str = "manager"
    branch_id: Optional[int] = None

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
    email: Optional[EmailStr] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[str] = None
    branch_id: Optional[int] = None
    is_active: Optional[bool] = None
