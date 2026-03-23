# TurnosRRHH — Work Log

> **Instrucciones para agentes**: Lee este archivo al inicio de cada sesión. Actualízalo al final con lo que hiciste. Esto permite continuidad entre terminales y agentes.

---

## 2026-03-23 — Sesión 2: Backend + Frontend Fase 0-3

### Estado: Fases 0, 1, 2, 3 ✅ COMPLETADAS
### Qué se hizo:
**Fase 0:** AGENTS.md mejorado, WORKLOG.md creado  
**Fase 1 (DB):** init.sql + models.py — tabla `user_branches` N:M, login por RUT, `is_locked` en schedules  
**Fase 2 (Backend API):**
- auth.py — login RUT, `get_user_by_rut()`
- routes/auth.py — LoginResponse con branches[]
- routes/users.py — CRUD usuarios, asignar sucursales (admin-only)
- routes/status.py — /api/status/completeness (n8n-ready), /status/branch/{id}, /audit-log
- routes/export.py — /api/export/json y /api/export/excel
- routes/schedules.py — validate_labor_rules(), compute_locked_days(), GET /api/schedules/labor-rules
- main.py — lifespan auto-seed admin, 8 routers registrados
- config.py + .env — ADMIN_RUT, ADMIN_PASSWORD=1234, CORS port 3010

**Fase 3 (Frontend):**
- frontend/src/api/client.js — cliente HTTP con JWT auto-refresh
- frontend/src/context/AuthContext.jsx — login RUT, currentBranch, switchBranch
- frontend/src/pages/LoginPage.jsx — diseño dark glassmorphism
- frontend/src/utils/laborRules.js — parseRules, classifyWeeklyHours, isAutoLocked
- frontend/src/main.jsx — BrowserRouter + AuthProvider
- frontend/src/App.jsx — grilla conectada a API, routing, multi-branch, todos los botones

### Próximos pasos:
- Fase 5: Admin Dashboard + ABM páginas (trabajadores, sucursales, usuarios)
- Prueba con docker-compose up --build

### Archivos clave modificados:
backend: init.sql, models.py, schemas.py, auth.py, config.py, main.py
backend routes: auth, users, schedules, status, export
frontend: main.jsx, App.jsx, api/client.js, context/AuthContext.jsx, pages/LoginPage.jsx, utils/laborRules.js

---

## 2026-03-23 — Sesión 1: Planificación y Setup

### Estado: Fase 0 en progreso
### Qué se hizo:
- Evaluación completa del proyecto existente
- Plan de implementación v3 aprobado (7 fases)
- `AGENTS.md` mejorado con arquitectura, reglas, estructura
- `WORKLOG.md` creado (este archivo)

### Decisiones clave:
- Login por RUT + password (default: `1234`), no por email
- Modelo simplificado: users → user_branches → branches → workers → schedules
- Reglas: 36-42 verde, <36/>44 rojo, auto-lock 7° día y domingos tras 2 trabajados
- Export: Excel + JSON para n8n
- Query API para consultas de completitud por sucursal

### Próximos pasos:
- Fase 1: Modificar init.sql y modelos (agregar user_branches, cambiar login a RUT)
- Fase 2: Actualizar auth, crear routes/users.py, routes/status.py, routes/export.py

### Archivos modificados:
- `AGENTS.md` — reescrito completo
- `WORKLOG.md` — creado

### Plan completo: 
Ver `implementation_plan.md` en directorio de artefactos del agente.
