from sqlalchemy import (
    Column, Integer, String, Boolean, Date, Time, Numeric,
    ForeignKey, Text, DateTime, CheckConstraint, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB, INET
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Branch(Base):
    __tablename__ = "branches"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    code = Column(String(20), nullable=False, unique=True)
    address = Column(String(255))
    region = Column(String(100))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    workers = relationship("Worker", back_populates="branch")
    user_branches = relationship("UserBranch", back_populates="branch")
    shift_templates = relationship("ShiftTemplate", back_populates="branch")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    rut = Column(String(12), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    email = Column(String(255), nullable=True)
    role = Column(String(20), nullable=False)
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    user_branches = relationship("UserBranch", back_populates="user", lazy="joined")

    __table_args__ = (
        CheckConstraint("role IN ('admin', 'manager', 'viewer')", name="valid_role"),
    )

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"

    @property
    def branches(self):
        """List of branches this user has access to."""
        return [ub.branch for ub in self.user_branches]

    @property
    def default_branch(self):
        """The user's default branch, or first one."""
        for ub in self.user_branches:
            if ub.is_default:
                return ub.branch
        return self.user_branches[0].branch if self.user_branches else None


class UserBranch(Base):
    __tablename__ = "user_branches"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", back_populates="user_branches")
    branch = relationship("Branch", back_populates="user_branches")

    __table_args__ = (
        UniqueConstraint("user_id", "branch_id", name="unique_user_branch"),
    )


class Worker(Base):
    __tablename__ = "workers"

    id = Column(Integer, primary_key=True, index=True)
    rut = Column(String(12), nullable=False, unique=True)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    position = Column(String(100))
    contract_type = Column(String(30), nullable=False)
    contracted_weekly_hours = Column(Integer, nullable=False, default=42)
    hire_date = Column(Date, nullable=False)
    termination_date = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    branch = relationship("Branch", back_populates="workers")
    schedules = relationship("Schedule", back_populates="worker")

    __table_args__ = (
        CheckConstraint(
            "contract_type IN ('indefinido', 'plazo_fijo', 'part_time', 'honorarios')",
            name="valid_contract_type"
        ),
    )

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"


class ShiftTemplate(Base):
    __tablename__ = "shift_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(80), nullable=False)
    code = Column(String(10), nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    # total_hours is a generated column in PostgreSQL — read-only in SQLAlchemy
    total_hours = Column(Numeric(4, 2))
    color = Column(String(7), default="#3B82F6")
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    is_global = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    branch = relationship("Branch", back_populates="shift_templates")

    __table_args__ = (
        UniqueConstraint("code", "branch_id", name="unique_code_per_branch"),
    )


class Schedule(Base):
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=False)
    date = Column(Date, nullable=False)
    shift_template_id = Column(Integer, ForeignKey("shift_templates.id"), nullable=True)
    custom_start_time = Column(Time, nullable=True)
    custom_end_time = Column(Time, nullable=True)
    total_hours = Column(Numeric(4, 2), nullable=False)
    is_day_off = Column(Boolean, default=False)
    is_locked = Column(Boolean, default=False)
    status = Column(String(20), default="draft")
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    published_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    worker = relationship("Worker", back_populates="schedules")
    shift_template = relationship("ShiftTemplate")

    __table_args__ = (
        UniqueConstraint("worker_id", "date", name="unique_worker_date"),
        CheckConstraint("status IN ('draft', 'published', 'modified')", name="valid_status"),
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String(20), nullable=False)
    entity_type = Column(String(30), nullable=False)
    entity_id = Column(Integer, nullable=True)
    old_values = Column(JSONB, nullable=True)
    new_values = Column(JSONB, nullable=True)
    ip_address = Column(INET, nullable=True)
    user_agent = Column(Text, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User")


class LaborRule(Base):
    __tablename__ = "labor_rules"

    id = Column(Integer, primary_key=True, index=True)
    rule_code = Column(String(30), nullable=False)
    rule_value = Column(Numeric, nullable=False)
    effective_from = Column(Date, nullable=False)
    effective_until = Column(Date, nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class WeeklyStatus(Base):
    __tablename__ = "weekly_status"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    week_start = Column(Date, nullable=False)
    status = Column(String(20), default="pending")
    published_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    published_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    branch = relationship("Branch")

    __table_args__ = (
        UniqueConstraint("branch_id", "week_start", name="unique_branch_week"),
        CheckConstraint("status IN ('pending', 'draft', 'published')", name="valid_weekly_status"),
    )
