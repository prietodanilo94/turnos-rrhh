-- ============================================================
-- SISTEMA DE GESTIÓN DE TURNOS - ESQUEMA COMPLETO
-- Base de datos: PostgreSQL 15+
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

-- 2. USUARIOS DEL SISTEMA
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    rut VARCHAR(12) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'viewer')),
    branch_id INTEGER REFERENCES branches(id),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. TRABAJADORES
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
    contracted_weekly_hours INTEGER NOT NULL DEFAULT 44,
    hire_date DATE NOT NULL,
    termination_date DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. PLANTILLAS DE TURNO
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

-- 5. HORARIOS SEMANALES
CREATE TABLE schedules (
    id SERIAL PRIMARY KEY,
    worker_id INTEGER NOT NULL REFERENCES workers(id),
    date DATE NOT NULL,
    shift_template_id INTEGER REFERENCES shift_templates(id),
    custom_start_time TIME,
    custom_end_time TIME,
    total_hours NUMERIC(4,2) NOT NULL,
    is_day_off BOOLEAN DEFAULT false,
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

-- 6. AUDIT LOG
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

-- 7. REGLAS LABORALES
CREATE TABLE labor_rules (
    id SERIAL PRIMARY KEY,
    rule_code VARCHAR(30) NOT NULL,
    rule_value NUMERIC NOT NULL,
    effective_from DATE NOT NULL,
    effective_until DATE,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 8. ESTADO SEMANAL POR SUCURSAL
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
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
CREATE INDEX idx_labor_rules_code ON labor_rules(rule_code, effective_from);
CREATE INDEX idx_weekly_status_branch_week ON weekly_status(branch_id, week_start);

-- ============================================================
-- DATOS INICIALES
-- ============================================================

-- Reglas laborales
INSERT INTO labor_rules (rule_code, rule_value, effective_from, effective_until, description) VALUES
('MAX_WEEKLY_HOURS', 44, '2024-04-01', '2026-03-31', 'Jornada máxima 44 hrs semanales'),
('MAX_WEEKLY_HOURS', 42, '2026-04-01', '2028-03-31', 'Jornada máxima 42 hrs semanales'),
('MAX_WEEKLY_HOURS', 40, '2028-04-01', NULL, 'Jornada máxima 40 hrs semanales'),
('MAX_DAILY_HOURS', 10, '2024-04-01', NULL, 'Máximo 10 hrs diarias ordinarias'),
('MAX_CONSECUTIVE_DAYS', 6, '2024-04-01', NULL, 'Máximo 6 días consecutivos trabajados'),
('MIN_FREE_SUNDAYS', 2, '2024-04-01', NULL, 'Mínimo 2 domingos libres por mes'),
('MAX_OVERTIME_DAILY_HOURS', 2, '2024-04-01', NULL, 'Máximo 2 hrs extra por día');

-- Plantillas de turno globales
INSERT INTO shift_templates (name, code, start_time, end_time, color, is_global) VALUES
('Turno Mañana',    'TM', '08:00', '16:00', '#3B82F6', true),
('Turno Tarde',     'TT', '14:00', '22:00', '#8B5CF6', true),
('Turno Completo',  'TC', '09:00', '18:30', '#10B981', true),
('Media Jornada AM','MA', '08:00', '13:00', '#F59E0B', true),
('Media Jornada PM','MP', '14:00', '19:00', '#EF4444', true);
