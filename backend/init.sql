-- ============================================================
-- SISTEMA DE GESTIÓN DE TURNOS - ESQUEMA COMPLETO (v2)
-- Base de datos: PostgreSQL 15+
-- Login: RUT + password (default: 1234)
-- ============================================================

-- 1. SUCURSALES
CREATE TABLE branches (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE,
    address VARCHAR(255),
    region VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. USUARIOS DEL SISTEMA (login por RUT)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    rut VARCHAR(12) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'viewer')),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. RELACIÓN USUARIOS ↔ SUCURSALES (N:M)
CREATE TABLE user_branches (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_user_branch UNIQUE (user_id, branch_id)
);

-- 4. TRABAJADORES
CREATE TABLE workers (
    id SERIAL PRIMARY KEY,
    rut VARCHAR(12) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    position VARCHAR(100),
    contract_type VARCHAR(30) NOT NULL CHECK (
        contract_type IN ('indefinido', 'plazo_fijo', 'part_time', 'honorarios')
    ),
    contracted_weekly_hours INTEGER NOT NULL DEFAULT 42,
    hire_date DATE NOT NULL,
    termination_date DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. PLANTILLAS DE TURNO
CREATE TABLE shift_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    code VARCHAR(10) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    total_hours NUMERIC(4,2) GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0
    ) STORED,
    color VARCHAR(7) DEFAULT '#3B82F6',
    branch_id INTEGER REFERENCES branches(id),
    is_global BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT valid_times CHECK (end_time > start_time),
    CONSTRAINT max_daily_hours CHECK (
        EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0 <= 10
    ),
    CONSTRAINT unique_code_per_branch UNIQUE (code, branch_id)
);

-- 6. HORARIOS SEMANALES
CREATE TABLE schedules (
    id SERIAL PRIMARY KEY,
    worker_id INTEGER NOT NULL REFERENCES workers(id),
    date DATE NOT NULL,
    shift_template_id INTEGER REFERENCES shift_templates(id),
    custom_start_time TIME,
    custom_end_time TIME,
    total_hours NUMERIC(4,2) NOT NULL,
    is_day_off BOOLEAN DEFAULT false,
    is_locked BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'draft' CHECK (
        status IN ('draft', 'published', 'modified')
    ),
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_worker_date UNIQUE (worker_id, date),
    CONSTRAINT has_shift_or_dayoff CHECK (
        is_day_off = true OR
        shift_template_id IS NOT NULL OR
        (custom_start_time IS NOT NULL AND custom_end_time IS NOT NULL)
    )
);

-- 7. AUDIT LOG
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    action VARCHAR(20) NOT NULL CHECK (
        action IN ('create', 'update', 'delete', 'publish', 'login', 'copy_week', 'swap')
    ),
    entity_type VARCHAR(30) NOT NULL,
    entity_id INTEGER,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 8. REGLAS LABORALES
CREATE TABLE labor_rules (
    id SERIAL PRIMARY KEY,
    rule_code VARCHAR(30) NOT NULL,
    rule_value NUMERIC NOT NULL,
    effective_from DATE NOT NULL,
    effective_until DATE,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 9. ESTADO SEMANAL POR SUCURSAL
CREATE TABLE weekly_status (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    week_start DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (
        status IN ('pending', 'draft', 'published')
    ),
    published_by INTEGER REFERENCES users(id),
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_branch_week UNIQUE (branch_id, week_start)
);

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX idx_schedules_worker_date ON schedules(worker_id, date);
CREATE INDEX idx_schedules_date ON schedules(date);
CREATE INDEX idx_schedules_status ON schedules(status);
CREATE INDEX idx_workers_branch ON workers(branch_id);
CREATE INDEX idx_workers_rut ON workers(rut);
CREATE INDEX idx_users_rut ON users(rut);
CREATE INDEX idx_user_branches_user ON user_branches(user_id);
CREATE INDEX idx_user_branches_branch ON user_branches(branch_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
CREATE INDEX idx_labor_rules_code ON labor_rules(rule_code, effective_from);
CREATE INDEX idx_weekly_status_branch_week ON weekly_status(branch_id, week_start);

-- ============================================================
-- DATOS INICIALES
-- ============================================================

-- Reglas laborales (Chile - Ley 40 horas)
INSERT INTO labor_rules (rule_code, rule_value, effective_from, effective_until, description) VALUES
('MAX_WEEKLY_HOURS', 42, '2026-04-01', '2028-03-31', 'Jornada máxima 42 hrs semanales'),
('MAX_WEEKLY_HOURS', 40, '2028-04-01', NULL, 'Jornada máxima 40 hrs semanales'),
('MIN_WEEKLY_HOURS', 36, '2026-04-01', NULL, 'Mínimo sugerido 36 hrs semanales'),
('MAX_DAILY_HOURS', 10, '2026-04-01', NULL, 'Máximo 10 hrs diarias ordinarias'),
('MAX_CONSECUTIVE_DAYS', 6, '2026-04-01', NULL, 'Máximo 6 días consecutivos trabajados'),
('MIN_FREE_SUNDAYS', 2, '2026-04-01', NULL, 'Mínimo 2 domingos libres por mes'),
('MAX_OVERTIME_DAILY_HOURS', 2, '2026-04-01', NULL, 'Máximo 2 hrs extra por día'),
('OVERTIME_THRESHOLD', 42, '2026-04-01', NULL, 'Horas semanales a partir de las cuales se consideran extras');

-- Plantillas de turno globales
INSERT INTO shift_templates (name, code, start_time, end_time, color, is_global) VALUES
('Turno Mañana',    'TM', '08:00', '16:00', '#3B82F6', true),
('Turno Tarde',     'TT', '14:00', '22:00', '#8B5CF6', true),
('Turno Completo',  'TC', '09:00', '18:30', '#10B981', true),
('Media Jornada AM','MA', '08:00', '13:00', '#F59E0B', true),
('Media Jornada PM','MP', '14:00', '19:00', '#EF4444', true);

-- ============================================================
-- PLANIFICADOR MENSUAL (módulo nuevo — no afecta módulo semanal)
-- ============================================================

-- 10. PLANES MENSUALES (cabecera)
CREATE TABLE monthly_plans (
    id          SERIAL PRIMARY KEY,
    branch_id   INTEGER NOT NULL REFERENCES branches(id),
    year        INTEGER NOT NULL CHECK (year >= 2020 AND year <= 2100),
    month       INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    mode        VARCHAR(20) NOT NULL DEFAULT 'planning'
                    CHECK (mode IN ('simulation', 'planning')),
    status      VARCHAR(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'generated', 'validated', 'exported')),
    dotation    INTEGER NOT NULL,
    shift_count INTEGER NOT NULL DEFAULT 4,
    name        VARCHAR(120),           -- etiqueta libre opcional
    created_by  INTEGER NOT NULL REFERENCES users(id),
    updated_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
    -- Sin UNIQUE constraint: se permiten múltiples planes por sucursal/mes
);

-- 11. EXCEPCIONES MENSUALES (vacaciones, licencias, etc.)
CREATE TABLE monthly_plan_exceptions (
    id          SERIAL PRIMARY KEY,
    plan_id     INTEGER NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
    worker_id   INTEGER NOT NULL REFERENCES workers(id),
    type        VARCHAR(30) NOT NULL
                    CHECK (type IN ('vacaciones','licencia','permiso','traslado','bloqueo')),
    date_from   DATE NOT NULL,
    date_to     DATE NOT NULL,
    note        TEXT,
    created_at  TIMESTAMP DEFAULT NOW(),
    CONSTRAINT valid_exception_daterange CHECK (date_to >= date_from)
);

-- 12. ASIGNACIONES DIARIAS DEL PLAN MENSUAL
CREATE TABLE monthly_plan_assignments (
    id              SERIAL PRIMARY KEY,
    plan_id         INTEGER NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
    worker_id       INTEGER REFERENCES workers(id),  -- NULL = cupo placeholder sin RUT
    day             INTEGER NOT NULL CHECK (day >= 1 AND day <= 31),
    shift_code      VARCHAR(10),        -- NULL = día libre
    time_text       VARCHAR(30),        -- "09:00 a 18:00" — texto para el export de carga
    is_day_off      BOOLEAN DEFAULT false,
    is_placeholder  BOOLEAN DEFAULT false,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_monthly_plan_worker_day UNIQUE (plan_id, worker_id, day)
);

-- ============================================================
-- ÍNDICES — Módulo mensual
-- ============================================================
CREATE INDEX idx_monthly_plans_branch ON monthly_plans(branch_id);
CREATE INDEX idx_monthly_plans_year_month ON monthly_plans(year, month);
CREATE INDEX idx_monthly_exceptions_plan ON monthly_plan_exceptions(plan_id);
CREATE INDEX idx_monthly_exceptions_worker ON monthly_plan_exceptions(worker_id);
CREATE INDEX idx_monthly_assignments_plan ON monthly_plan_assignments(plan_id);
CREATE INDEX idx_monthly_assignments_worker ON monthly_plan_assignments(worker_id);
