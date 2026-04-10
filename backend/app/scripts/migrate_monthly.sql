-- ============================================================
-- SCRIPT DE MIGRACIÓN: PLANIFICADOR MENSUAL
-- ============================================================
-- Ejecutar este script en la base de datos de producción para
-- agregar las tablas del nuevo módulo mensual sin afectar los datos actuales.

-- 1. PLANES MENSUALES (cabecera)
CREATE TABLE IF NOT EXISTS monthly_plans (
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
    name        VARCHAR(120),
    created_by  INTEGER NOT NULL REFERENCES users(id),
    updated_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- 2. EXCEPCIONES MENSUALES
CREATE TABLE IF NOT EXISTS monthly_plan_exceptions (
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

-- 3. ASIGNACIONES DIARIAS DEL PLAN MENSUAL
CREATE TABLE IF NOT EXISTS monthly_plan_assignments (
    id              SERIAL PRIMARY KEY,
    plan_id         INTEGER NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
    worker_id       INTEGER REFERENCES workers(id),
    day             INTEGER NOT NULL CHECK (day >= 1 AND day <= 31),
    shift_code      VARCHAR(10),
    time_text       VARCHAR(30),
    is_day_off      BOOLEAN DEFAULT false,
    is_placeholder  BOOLEAN DEFAULT false,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_monthly_plan_worker_day UNIQUE (plan_id, worker_id, day)
);

-- 4. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_monthly_plans_branch ON monthly_plans(branch_id);
CREATE INDEX IF NOT EXISTS idx_monthly_plans_year_month ON monthly_plans(year, month);
CREATE INDEX IF NOT EXISTS idx_monthly_exceptions_plan ON monthly_plan_exceptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_monthly_exceptions_worker ON monthly_plan_exceptions(worker_id);
CREATE INDEX IF NOT EXISTS idx_monthly_assignments_plan ON monthly_plan_assignments(plan_id);
CREATE INDEX IF NOT EXISTS idx_monthly_assignments_worker ON monthly_plan_assignments(worker_id);

-- Confirmación
SELECT 'Migración completada exitosamente. Se crearon 3 tablas y 6 índices.' AS status;
