# TurnosRRHH — Guía de Agentes

> **Leer SIEMPRE antes de hacer cualquier cambio.**

## Instrucciones para Agentes

1. **Ahorro de tokens**: Cuando modifiques código, devuelve solo el snippet o función que cambió, NO el archivo completo.
2. **Leer `WORKLOG.md`** antes de empezar para conocer el estado actual del proyecto.
3. **Actualizar `WORKLOG.md`** al terminar cada sesión de trabajo.
4. **Nunca** exponer contraseñas reales ni subir `.env` a Git.
5. Verificar `.gitignore` antes de cada commit.

## Arquitectura

```
┌─────────────────────────────────────────────────┐
│ Frontend (React + Vite) → puerto 3010           │
│   Login RUT → Grilla turnos → Dashboard Admin   │
├─────────────────────────────────────────────────┤
│ Backend (FastAPI + Python 3.11) → puerto 8010   │
│   JWT Auth │ CRUD │ Reglas laborales │ Export    │
├─────────────────────────────────────────────────┤
│ PostgreSQL 15 → interno Docker                  │
└─────────────────────────────────────────────────┘
Deploy: Docker Compose + Nginx → VPS 173.212.220.77
URL: https://turnos.dpmake.cl
CI/CD: GitHub Actions (push a main → auto-deploy)
```

## Modelo de Datos

```
users (jefes/admin)
  ├── rut (login principal)
  ├── password_hash (default: 1234)
  ├── role: admin | manager | viewer
  └── N:M → user_branches → branches

branches (sucursales/talleres)
  └── 1:N → workers (trabajadores)
                └── 1:N → schedules (turnos diarios)
                              └── FK → shift_templates

audit_log → registra toda acción por user_id
labor_rules → reglas laborales vigentes por fecha
weekly_status → estado publicación por branch+semana
```

## Reglas Laborales (Chile)

| Regla | Valor | Comportamiento |
|-------|-------|----------------|
| Horas semanales OK | 36-42 | ✅ Verde |
| Bajo mínimo | <36 | 🔴 Rojo |
| Sobre máximo legal | >44 | 🔴 Rojo, bloqueado |
| Horas extra | 42-44 | 🟡 Color especial |
| Extra diaria max | 2 hrs | Bloquear exceso |
| Días consecutivos max | 6 | Auto-lock 🔒 día 7 |
| Domingos libres/mes | Mín 2 | Si trabajó 2 → lock restantes |

## Estructura de Archivos

```
turnos-rrhh/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app + startup
│   │   ├── config.py         # Settings (pydantic-settings)
│   │   ├── database.py       # SQLAlchemy engine
│   │   ├── models.py         # Modelos ORM
│   │   ├── schemas.py        # Pydantic schemas
│   │   ├── auth.py           # JWT + password utils
│   │   ├── routes/
│   │   │   ├── auth.py       # Login, refresh, /me
│   │   │   ├── branches.py   # CRUD sucursales
│   │   │   ├── workers.py    # CRUD trabajadores
│   │   │   ├── templates.py  # CRUD plantillas de turno
│   │   │   ├── schedules.py  # Bulk save, copy, publish, swap
│   │   │   ├── users.py      # CRUD usuarios (admin)
│   │   │   ├── status.py     # Query completitud
│   │   │   └── export.py     # Excel + JSON
│   │   └── scripts/
│   │       └── create_admin.py
│   ├── init.sql
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── index.css
│   │   ├── api/client.js
│   │   ├── context/AuthContext.jsx
│   │   ├── pages/
│   │   ├── components/
│   │   └── utils/laborRules.js
│   ├── package.json
│   ├── vite.config.js
│   └── Dockerfile
├── docker-compose.yml
├── turnos-rrhh.conf          # Nginx config
├── AGENTS.md                 # ← Este archivo
├── WORKLOG.md                # Log de trabajo continuo
└── .github/workflows/deploy.yml
```

## Comandos Rápidos

```bash
# Levantar todo
docker-compose up -d --build

# Ver logs
docker-compose logs -f backend

# SSH al VPS
ssh root@173.212.220.77

# Frontend local
cd frontend && npm install && npm run dev

# Backend local
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload
```

## URLs

| Servicio | Local | Producción |
|----------|-------|------------|
| Frontend | http://localhost:3010 | https://turnos.dpmake.cl |
| Backend | http://localhost:8010 | https://turnos.dpmake.cl/api |
| API Docs | http://localhost:8010/docs | https://turnos.dpmake.cl/docs |
