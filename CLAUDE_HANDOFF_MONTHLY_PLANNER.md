# Claude Handoff - TurnosRRHH Monthly Planner

This document is the handoff package to continue the monthly planner work from another computer/tool (for example Claude).

## 1) Current Status (What is already done)

A first beta monthly planner view is already integrated in frontend:

- New page: `frontend/src/pages/MonthlyPlannerPage.jsx`
- Router/menu integration: `frontend/src/App.jsx`
- Protected route added: `/monthly-planner`
- Shortcut back to weekly view: `/weekly`

The beta includes:

- Entry panel with:
  - `Mes`
  - `Sucursal`
  - `Modo` (`Simulacion` / `Planificacion`)
- 3 actions:
  - `Continuar`
  - `Cargar calendario` (placeholder for phase 2 OCR/AI)
  - `Importar cambios del mes`
- Monthly editable grid by worker
- Dotation and shift-count controls
- Shift selection (`T1..T5`) + `Libre`
- Local "changes of month" list (vacations/licence/permits/etc.) applied in regeneration

Important: this is a functional beta flow, not the final optimization engine.

## 2) Branching and Safety Strategy

To keep `main` safe:

- Work only in a feature branch (created by Codex in this session)
- Do not merge until monthly export and constraints are validated with business users

Recommended branch naming:

- `codex/monthly-planner-handoff`
- Future branches from this one:
  - `codex/monthly-engine-backend`
  - `codex/monthly-export-dia31`
  - `codex/monthly-rules-cross-month`

## 3) Product Vision (Agreed Direction)

The monthly planning workflow should be:

1. Select month + branch + mode
2. Confirm real dotation for that month
3. Register monthly changes/exceptions
4. Generate proposal
5. Manually adjust in dynamic calendar
6. Validate labor rules
7. Export Excel for upload format

Output format must be:

- Column `A`: `RUT`
- Header row: `DIA1 ... DIA31` (always include `DIA31`)
- Values: text like `10:00 a 19:00`
- Day off = empty cell
- Non-existing day in month (example day 31 in 30-day month) = empty cell

## 4) Hard Requirements (Do not break)

- Monthly export is mandatory (system upload depends on it)
- Worker identity is real (`RUT`), no anonymous export
- Keep compatibility with existing app auth/branch model
- Keep visual style close to current internal systems
- Cross-month continuity is required (cannot treat each month as isolated)

## 5) Data Requirements to Collect (Business Inputs)

Before final engine:

1. Branch time windows by weekday (real source of truth)
2. Minimum coverage rule per day/time block
3. Legal constraints priority:
   - max consecutive days
   - Sundays off
   - weekly hours target/max
4. Monthly exceptions template format (if Excel import is needed)
5. Real sample upload file accepted by target platform

## 6) Architecture Recommendation

Keep current stack:

- Frontend: React + Vite
- Backend: FastAPI + SQLAlchemy
- DB: PostgreSQL

Add monthly domain model in backend:

- `monthly_plans` (month, year, branch_id, mode, status)
- `monthly_plan_workers` (snapshot of workers/dotation for that plan)
- `monthly_plan_exceptions`
- `monthly_plan_assignments` (worker_id, date, shift_code/text slot)
- `monthly_plan_versions` (optional versioning for audit)

Reason: keep weekly module stable while adding monthly module incrementally.

## 7) Implementation Roadmap

### Phase A - Persisted Monthly Drafts

- Create backend endpoints for monthly plan CRUD
- Save/load planner state (instead of local-only frontend state)
- Add "Save draft" and "Load last draft"

### Phase B - Real Rule Validation

- Centralize validations in backend service:
  - weekly hours
  - max consecutive days
  - Sundays logic
  - branch window compatibility
- Return warnings/errors per worker/day

### Phase C - Export Engine

- New endpoint for monthly export:
  - output columns: `RUT + DIA1..DIA31`
  - format hour strings exactly as required
- Validate output with real upload platform

### Phase D - Cross-Month Continuity

- Store carry-over state from previous month:
  - consecutive-day streak
  - Sundays counter
  - weekly boundary continuity
- Seed next month generation using that carry-over

### Phase E - OCR/AI Import (Optional)

- Implement `Cargar calendario` integration:
  - input: image/pdf/template
  - transform to JSON
  - review screen before applying

## 8) Suggested API Contract (First Draft)

Monthly planner endpoints:

- `POST /api/monthly-plans`
- `GET /api/monthly-plans?branch_id=&month=&year=`
- `GET /api/monthly-plans/{id}`
- `PUT /api/monthly-plans/{id}`
- `POST /api/monthly-plans/{id}/generate`
- `POST /api/monthly-plans/{id}/validate`
- `GET /api/monthly-plans/{id}/export/excel`

## 9) Local Runbook (New Computer)

From a clean machine:

1. Clone repository
2. Checkout monthly branch
3. Install dependencies
4. Run backend + frontend
5. Open `/monthly-planner`

Commands:

```bash
git clone https://github.com/prietodanilo94/turnos-rrhh.git
cd turnos-rrhh
git checkout codex/monthly-planner-handoff

cd frontend
npm install
npm run dev

# in another terminal
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

## 10) Claude Prompt Starter

Use this prompt to continue effectively in Claude:

```text
Continue the monthly planner implementation in this repository.
Current beta frontend exists at frontend/src/pages/MonthlyPlannerPage.jsx and route wiring in frontend/src/App.jsx.
Do NOT rewrite the weekly planner module.
Next objective: implement backend persistence for monthly plans plus monthly Excel export format RUT + DIA1..DIA31 with "HH:MM a HH:MM" values and empty cells for day-off/non-existing days.
Keep changes incremental and production-safe.
```

## 11) Known Notes

- `WORKLOG.md` currently has encoding/history noise; avoid mass reformat unless explicitly intended.
- There are unrelated untracked files in repo; do not include them in monthly planner commits unless requested.

---

If you follow this document, you can continue development from another tool with minimal context loss.
