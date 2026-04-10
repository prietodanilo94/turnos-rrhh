import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

// ─── Constantes ─────────────────────────────────────────────────
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const MODES = [
  { value: 'planning',   label: 'Planificacion' },
  { value: 'simulation', label: 'Simulacion' },
];
const EXCEPTION_TYPES = ['vacaciones', 'licencia', 'permiso', 'traslado', 'bloqueo'];
const DAY_NAMES = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];

// ─── Estilos inline (coherentes con el diseño existente) ─────────
const page      = { minHeight: '100vh', background: '#eef2f7', color: '#243447' };
const card      = { background: '#fff', border: '1px solid #d9e2ec', borderRadius: 16, boxShadow: '0 16px 36px rgba(19,47,76,0.08)' };
const lbl       = { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, fontWeight: 700, color: '#52657a', textTransform: 'uppercase', letterSpacing: '.05em' };
const inp       = { background: '#f8fafc', border: '1px solid #cdd9e5', borderRadius: 12, color: '#243447', padding: '12px 14px', fontSize: 14, fontFamily: 'inherit' };
const btnPrimary   = { background: 'linear-gradient(135deg,#1155a5,#0b67b2)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 14 };
const btnSecondary = { background: '#f8fafc', color: '#243447', border: '1px solid #cdd9e5', borderRadius: 10, padding: '12px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 14 };
const btnSuccess   = { background: 'linear-gradient(135deg,#059669,#10b981)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 14 };
const btnDanger    = { background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: 10, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 };

// ─── Helpers ────────────────────────────────────────────────────
function toKey(date) {
  return date.toISOString().split('T')[0];
}
function getMonthDays(year, monthNumber) {
  const total = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(year, monthNumber - 1, i + 1);
    return { key: toKey(d), day: i + 1, weekDay: d.getDay(), short: DAY_NAMES[d.getDay()], weekend: d.getDay() === 0 || d.getDay() === 6 };
  });
}

// ─── Componente principal ────────────────────────────────────────
export default function MonthlyPlannerPage() {
  const today = new Date();
  const currentYear = today.getFullYear();
  const { user, logout, currentBranchId, switchBranch } = useAuth();

  // ── Estado del formulario inicial ─────────────────────────────
  const [month,    setMonth]    = useState(String(today.getMonth() + 1));
  const [branchId, setBranchId] = useState(currentBranchId ? String(currentBranchId) : '');
  const [mode,     setMode]     = useState('planning');
  const [planName, setPlanName] = useState('');

  // ── Estado del plan activo (post-creación/carga) ──────────────
  const [activePlan,      setActivePlan]      = useState(null);   // objeto plan de la DB
  const [planList,        setPlanList]         = useState([]);     // planes existentes para el mes
  const [workers,         setWorkers]          = useState([]);
  const [calendar,        setCalendar]         = useState({});     // { workerId: { day: { shift_code, time_text, is_day_off } } }
  const [exceptions,      setExceptions]       = useState([]);

  // ── Estado de UI ──────────────────────────────────────────────
  const [panel,     setPanel]    = useState('');     // '' | 'grid' | 'exceptions' | 'plans'
  const [loading,   setLoading]  = useState(false);
  const [saving,    setSaving]   = useState(false);
  const [message,   setMessage]  = useState('');
  const [error,     setError]    = useState('');

  // ── Draft de excepción ────────────────────────────────────────
  const [excDraft, setExcDraft] = useState({
    workerId: '', type: 'vacaciones', from: toKey(today), to: toKey(today), note: '',
  });

  // ── Turno seleccionado para pintar celdas ─────────────────────
  const [selectedShiftCode, setSelectedShiftCode] = useState(null);  // null = borrar | string = código
  const [availableShifts,   setAvailableShifts]   = useState([]);    // shift_templates de la sucursal

  useEffect(() => {
    if (!branchId && currentBranchId) setBranchId(String(currentBranchId));
  }, [branchId, currentBranchId]);

  const days = useMemo(() => getMonthDays(currentYear, Number(month)), [month, currentYear]);
  const selectedBranch = user?.branches?.find(b => String(b.id) === String(branchId)) || null;
  const monthName = MONTHS[Number(month) - 1];

  // ── Cargar shifts de la sucursal ──────────────────────────────
  const loadShiftTemplates = useCallback(async (bid) => {
    try {
      const templates = await api.templates.list({ branch_id: bid, is_active: true });
      setAvailableShifts(templates || []);
      if (templates?.length > 0) setSelectedShiftCode(templates[0].code);
    } catch {
      setAvailableShifts([]);
    }
  }, []);

  // ── Cargar planes existentes para mes/sucursal ────────────────
  const loadPlanList = useCallback(async (bid, m) => {
    if (!bid || !m) return;
    try {
      const list = await api.monthlyPlans.list({ branch_id: bid, year: currentYear, month: m });
      setPlanList(list || []);
    } catch {
      setPlanList([]);
    }
  }, [currentYear]);

  // ── Inicializar grilla desde un plan activo ───────────────────
  const loadPlanIntoGrid = useCallback(async (plan) => {
    setLoading(true);
    setError('');
    try {
      const full = await api.monthlyPlans.get(plan.id);
      const wList = await api.workers.list({ branch_id: plan.branch_id, is_active: true });
      setWorkers(wList || []);

      // Construir calendario desde assignments
      const cal = {};
      for (const asgn of (full.assignments || [])) {
        if (asgn.is_placeholder || !asgn.worker_id) continue;
        if (!cal[asgn.worker_id]) cal[asgn.worker_id] = {};
        cal[asgn.worker_id][asgn.day] = {
          shift_code: asgn.shift_code,
          time_text:  asgn.time_text,
          is_day_off: asgn.is_day_off,
        };
      }
      setCalendar(cal);
      setExceptions(full.exceptions || []);
      setActivePlan(full);
      setPanel('grid');
      setMessage(`Plan "${plan.name || `Plan #${plan.id}`}" cargado — ${(full.assignments || []).filter(a => a.shift_code).length} celdas con turno.`);
    } catch (err) {
      setError(err.message || 'No se pudo cargar el plan.');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Crear y abrir nuevo plan ──────────────────────────────────
  const handleContinue = async () => {
    if (!branchId) return;
    setLoading(true); setError('');
    try {
      const wList = await api.workers.list({ branch_id: branchId, is_active: true });
      const plan  = await api.monthlyPlans.create({
        branch_id:   Number(branchId),
        year:        currentYear,
        month:       Number(month),
        mode,
        dotation:    wList.length || 1,
        shift_count: 4,
        name:        planName || `${monthName} ${currentYear} — ${selectedBranch?.name || ''}`.trim(),
      });
      await loadShiftTemplates(branchId);
      await loadPlanList(branchId, Number(month));
      setWorkers(wList);
      setCalendar({});
      setExceptions([]);
      setActivePlan(plan);
      setPanel('grid');
      setMessage(`Plan creado. ${wList.length} trabajadores cargados. Presiona "Generar propuesta" para empezar.`);
    } catch (err) {
      setError(err.message || 'No se pudo crear el plan.');
    } finally {
      setLoading(false);
    }
  };

  // ── Generar propuesta automática ──────────────────────────────
  const handleGenerate = async () => {
    if (!activePlan) return;
    setLoading(true); setError('');
    try {
      const res = await api.monthlyPlans.generate(activePlan.id);
      setMessage(res.message + ` | Plantillas: ${res.stats?.templates_used?.join(', ')}`);
      await loadPlanIntoGrid(activePlan);
    } catch (err) {
      setError(err.message || 'Error al generar propuesta.');
    } finally {
      setLoading(false);
    }
  };

  // ── Guardar borrador ──────────────────────────────────────────
  const handleSave = async () => {
    if (!activePlan) return;
    setSaving(true); setError('');
    try {
      const assignments = [];
      for (const [wid, days] of Object.entries(calendar)) {
        for (const [day, cell] of Object.entries(days)) {
          assignments.push({
            worker_id:  Number(wid),
            day:        Number(day),
            shift_code: cell.shift_code || null,
            time_text:  cell.time_text  || null,
            is_day_off: cell.is_day_off || false,
            is_placeholder: false,
          });
        }
      }
      await api.monthlyPlans.saveAssignments(activePlan.id, assignments);
      setMessage(`Borrador guardado — ${assignments.length} asignaciones.`);
    } catch (err) {
      setError(err.message || 'Error al guardar borrador.');
    } finally {
      setSaving(false);
    }
  };

  // ── Export Excel ──────────────────────────────────────────────
  const handleExport = async () => {
    if (!activePlan) return;
    setLoading(true); setError('');
    try {
      const branchCode = selectedBranch?.code || branchId;
      await api.monthlyPlans.exportExcel(
        activePlan.id,
        `plan_mensual_${branchCode}_${currentYear}_${String(month).padStart(2, '0')}.xlsx`
      );
      setMessage('Excel descargado exitosamente.');
    } catch (err) {
      setError(err.message || 'Error al exportar Excel.');
    } finally {
      setLoading(false);
    }
  };

  // ── Agregar excepción ─────────────────────────────────────────
  const handleAddException = async () => {
    if (!activePlan || !excDraft.workerId || !excDraft.from || !excDraft.to) return;
    setSaving(true); setError('');
    try {
      const exc = await api.monthlyPlans.addException(activePlan.id, {
        worker_id: Number(excDraft.workerId),
        type:      excDraft.type,
        date_from: excDraft.from,
        date_to:   excDraft.to,
        note:      excDraft.note || null,
      });
      setExceptions(prev => [...prev, exc]);
      setExcDraft({ workerId: '', type: 'vacaciones', from: toKey(today), to: toKey(today), note: '' });
      setMessage('Cambio del mes guardado en la base de datos.');
    } catch (err) {
      setError(err.message || 'Error al guardar excepción.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteException = async (excId) => {
    if (!activePlan) return;
    try {
      await api.monthlyPlans.deleteException(activePlan.id, excId);
      setExceptions(prev => prev.filter(e => e.id !== excId));
      setMessage('Excepción eliminada.');
    } catch (err) {
      setError(err.message || 'Error al eliminar excepción.');
    }
  };

  // ── Asignar celda en la grilla ────────────────────────────────
  const assignCell = (workerId, day) => {
    const shift = availableShifts.find(s => s.code === selectedShiftCode);
    setCalendar(prev => {
      const workerCal = { ...(prev[workerId] || {}) };
      if (selectedShiftCode === null) {
        // Borrar
        delete workerCal[day];
      } else if (selectedShiftCode === 'OFF') {
        workerCal[day] = { shift_code: null, time_text: null, is_day_off: true };
      } else if (shift) {
        workerCal[day] = {
          shift_code: shift.code,
          time_text:  `${shift.start_time} a ${shift.end_time}`,
          is_day_off: false,
        };
      }
      return { ...prev, [workerId]: workerCal };
    });
  };

  // ── Resetear al cambiar mes/sucursal ──────────────────────────
  const resetAll = () => {
    setPanel(''); setActivePlan(null); setWorkers([]); setCalendar({});
    setExceptions([]); setPlanList([]); setError(''); setMessage('');
  };

  // ── Stats de la grilla ────────────────────────────────────────
  const totalCellsWithShift = Object.values(calendar).reduce(
    (total, workerDays) => total + Object.values(workerDays).filter(c => c.shift_code).length, 0
  );

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div style={page}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(90deg,#0f4f97,#1155a5 55%,#0b67b2)', color: '#fff', padding: '18px 24px' }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Planificacion mensual</div>
          <div style={{ fontSize: 13, opacity: 0.78 }}>
            {activePlan ? `Plan #${activePlan.id} — ${monthName} ${currentYear}` : 'TurnosRRHH · módulo beta'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link to="/weekly" style={{ ...btnSecondary, textDecoration: 'none', color: '#0f4f97', background: '#fff' }}>Vista semanal</Link>
          <button type="button" style={{ ...btnSecondary, background: 'rgba(255,255,255,.12)', color: '#fff', borderColor: 'rgba(255,255,255,.2)' }} onClick={logout}>Salir</button>
        </div>
      </header>

      <main style={{ display: 'grid', gridTemplateColumns: '320px minmax(0,1fr)', gap: 24, maxWidth: 1600, margin: '0 auto', padding: 24 }}>

        {/* ── Panel izquierdo ── */}
        <aside style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, height: 'fit-content' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#1155a5', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>Configuracion</div>
            <h1 style={{ margin: 0, fontSize: 22 }}>Planificador mensual</h1>
          </div>

          <label style={lbl}>Mes
            <select value={month} onChange={e => { setMonth(e.target.value); resetAll(); }} style={inp}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>

          <label style={lbl}>Sucursal
            <select value={branchId} onChange={e => { const v = e.target.value; setBranchId(v); if (v) { switchBranch(Number(v)); loadPlanList(v, Number(month)); loadShiftTemplates(v); } resetAll(); }} style={inp}>
              <option value="">Selecciona una sucursal</option>
              {user?.branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>

          <label style={lbl}>Modo
            <select value={mode} onChange={e => setMode(e.target.value)} style={inp}>
              {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>

          <label style={lbl}>Nombre del plan (opcional)
            <input type="text" value={planName} onChange={e => setPlanName(e.target.value)} style={inp} placeholder={`${monthName} ${currentYear} · ${selectedBranch?.name || 'Sucursal'}`} />
          </label>

          <div style={{ ...card, boxShadow: 'none', background: '#f2f7fd', borderColor: '#d6e5f7', padding: 16 }}>
            <strong style={{ color: '#0f4f97' }}>{monthName}</strong>
            <span style={{ float: 'right', background: '#fff', color: '#1155a5', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>{currentYear}</span>
            {days.length < 31 && (
              <div style={{ color: '#52657a', fontSize: 12, marginTop: 8 }}>
                {days.length} días reales · DIA{days.length + 1}..DIA31 = vacíos en export
              </div>
            )}
          </div>

          <button type="button" style={btnPrimary} disabled={!branchId || loading} onClick={handleContinue}>
            {loading && !activePlan ? 'Creando plan...' : '+ Nuevo plan'}
          </button>

          {/* Planes existentes */}
          {planList.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#52657a', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                Planes existentes para {monthName}
              </div>
              {planList.map(p => (
                <div key={p.id} style={{ ...card, boxShadow: 'none', padding: '12px 14px', marginBottom: 8, cursor: 'pointer', borderColor: activePlan?.id === p.id ? '#1155a5' : '#d9e2ec' }}
                  onClick={() => loadPlanIntoGrid(p)}>
                  <strong style={{ fontSize: 13, display: 'block', color: activePlan?.id === p.id ? '#1155a5' : '#243447' }}>
                    {p.name || `Plan #${p.id}`}
                  </strong>
                  <span style={{ fontSize: 11, color: '#52657a' }}>
                    {p.mode} · {p.status} · {p.dotation} cupos
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Cambios del mes */}
          {activePlan && (
            <button type="button" style={btnSecondary} onClick={() => setPanel(panel === 'exceptions' ? 'grid' : 'exceptions')}>
              {panel === 'exceptions' ? '← Volver a la grilla' : '📋 Cambios del mes'}
              {exceptions.length > 0 && <span style={{ background: '#1155a5', color: '#fff', borderRadius: 999, padding: '2px 8px', fontSize: 11, marginLeft: 8 }}>{exceptions.length}</span>}
            </button>
          )}
        </aside>

        {/* ── Panel principal ── */}
        <section style={{ ...card, padding: 24, minHeight: 760 }}>

          {/* Mensajes */}
          {error   && <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 14, color: '#be123c', fontWeight: 700, marginBottom: 18, padding: '14px 16px' }}>{error}</div>}
          {message && <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 14, color: '#1d4ed8', fontWeight: 700, marginBottom: 18, padding: '14px 16px' }}>{message}</div>}

          {/* Estado inicial */}
          {!panel && (
            <div style={{ display: 'grid', gap: 20 }}>
              <div style={{ ...card, boxShadow: 'none', background: 'linear-gradient(135deg,#f8fbff,#f1f6fc)', borderColor: '#dae6f2', padding: 22 }}>
                <span style={{ background: '#0f4f97', borderRadius: 999, color: '#fff', display: 'inline-block', fontSize: 12, fontWeight: 700, padding: '6px 12px' }}>Módulo beta</span>
                <h2 style={{ margin: '12px 0 10px', fontSize: 26 }}>Planificador mensual con persistencia</h2>
                <p style={{ color: '#52657a', maxWidth: 760, lineHeight: 1.65 }}>
                  Selecciona mes y sucursal, luego presiona <strong>"+ Nuevo plan"</strong> para crear un plan o haz clic en uno existente para cargarlo.
                  Desde la grilla puedes generar la propuesta automática, editarla, guardar borrador y exportar el Excel de carga.
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 18 }}>
                {[
                  ['1. Nuevo plan', 'Crea un plan mensual y carga la dotación de la sucursal automáticamente.'],
                  ['2. Generar propuesta', 'El sistema asigna turnos reales de la sucursal respetando reglas laborales.'],
                  ['3. Export Excel', 'Descarga el formato de carga exacto: RUT + DIA1..DIA31 con horarios en texto.'],
                ].map(([t, c]) => (
                  <article key={t} style={{ ...card, boxShadow: 'none', padding: 22 }}>
                    <h3 style={{ marginTop: 0, color: '#1155a5' }}>{t}</h3>
                    <p style={{ color: '#52657a', lineHeight: 1.65 }}>{c}</p>
                  </article>
                ))}
              </div>
            </div>
          )}

          {/* Pestaña: Cambios del mes */}
          {panel === 'exceptions' && activePlan && (
            <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,.7fr)' }}>
              {/* Formulario */}
              <div style={{ ...card, boxShadow: 'none', padding: 20 }}>
                <h2 style={{ marginTop: 0 }}>Cambios del mes — Plan #{activePlan.id}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 14, marginBottom: 14 }}>
                  <label style={lbl}>Trabajador
                    <select value={excDraft.workerId} onChange={e => setExcDraft(d => ({ ...d, workerId: e.target.value }))} style={inp}>
                      <option value="">Selecciona...</option>
                      {workers.map(w => <option key={w.id} value={w.id}>{w.first_name} {w.last_name}</option>)}
                    </select>
                  </label>
                  <label style={lbl}>Tipo
                    <select value={excDraft.type} onChange={e => setExcDraft(d => ({ ...d, type: e.target.value }))} style={inp}>
                      {EXCEPTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <label style={lbl}>Desde
                    <input type="date" value={excDraft.from} onChange={e => setExcDraft(d => ({ ...d, from: e.target.value }))} style={inp} />
                  </label>
                  <label style={lbl}>Hasta
                    <input type="date" value={excDraft.to} onChange={e => setExcDraft(d => ({ ...d, to: e.target.value }))} style={inp} />
                  </label>
                </div>
                <label style={lbl}>Nota
                  <textarea rows="3" value={excDraft.note} onChange={e => setExcDraft(d => ({ ...d, note: e.target.value }))} style={{ ...inp, resize: 'vertical' }} placeholder="Ej: licencia médica o permiso sindical." />
                </label>
                <button type="button" style={{ ...btnPrimary, marginTop: 16 }} onClick={handleAddException} disabled={saving || !excDraft.workerId}>
                  {saving ? 'Guardando...' : 'Agregar cambio del mes'}
                </button>
              </div>

              {/* Lista */}
              <div style={{ ...card, boxShadow: 'none', padding: 20 }}>
                <h3 style={{ marginTop: 0 }}>Cambios registrados</h3>
                {exceptions.length === 0
                  ? <p style={{ color: '#6b7f94' }}>Sin excepciones aún.</p>
                  : exceptions.map(exc => {
                      const w = workers.find(x => x.id === exc.worker_id);
                      return (
                        <div key={exc.id} style={{ background: '#f8fafc', border: '1px solid #d9e2ec', borderRadius: 14, padding: 14, marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <strong>{w ? `${w.first_name} ${w.last_name}` : `Worker #${exc.worker_id}`}</strong>
                              <div style={{ color: '#52657a', fontSize: 13, marginTop: 4 }}>{exc.type} · {exc.date_from} a {exc.date_to}</div>
                              {exc.note && <div style={{ color: '#6b7f94', fontSize: 12, marginTop: 6 }}>{exc.note}</div>}
                            </div>
                            <button type="button" style={btnDanger} onClick={() => handleDeleteException(exc.id)}>✕</button>
                          </div>
                        </div>
                      );
                    })}
              </div>
            </div>
          )}

          {/* Grilla mensual */}
          {panel === 'grid' && activePlan && (
            <div>
              {/* Stats bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 16, marginBottom: 20 }}>
                {[
                  ['Trabajadores', workers.length],
                  ['Dotacion plan', activePlan.dotation],
                  ['Turno activo', selectedShiftCode || '—'],
                  ['Celdas con turno', totalCellsWithShift],
                ].map(([title, value]) => (
                  <div key={title} style={{ ...card, boxShadow: 'none', padding: 18 }}>
                    <span style={{ color: '#6b7f94', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>{title}</span>
                    <strong style={{ display: 'block', color: '#1155a5', fontSize: 26, marginTop: 4 }}>{value}</strong>
                  </div>
                ))}
              </div>

              {/* Selector de turno + acciones */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 20 }}>
                <button type="button" style={{ ...btnPrimary, padding: '10px 18px' }} disabled={loading} onClick={handleGenerate}>
                  {loading ? '⏳ Generando...' : '⚡ Generar propuesta'}
                </button>
                <button type="button" style={{ ...btnSuccess, padding: '10px 18px' }} disabled={saving} onClick={handleSave}>
                  {saving ? '⏳ Guardando...' : '💾 Guardar borrador'}
                </button>
                <button type="button" style={{ ...btnSecondary, padding: '10px 18px' }} disabled={loading} onClick={handleExport}>
                  📥 Exportar Excel
                </button>
                <span style={{ background: mode === 'simulation' ? '#fef3c7' : '#eff6ff', border: `1px solid ${mode === 'simulation' ? '#fde68a' : '#bfdbfe'}`, borderRadius: 999, color: mode === 'simulation' ? '#b45309' : '#1d4ed8', padding: '10px 16px', fontWeight: 700, fontSize: 13 }}>
                  {mode === 'simulation' ? '🔬 Simulacion' : '📋 Planificacion'}
                </span>
              </div>

              {/* Paleta de turnos */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
                {availableShifts.map(s => (
                  <button key={s.code} type="button" onClick={() => setSelectedShiftCode(s.code)}
                    style={{ background: selectedShiftCode === s.code ? s.color : '#f8fafc', color: selectedShiftCode === s.code ? '#fff' : s.color, border: `2px solid ${s.color}`, borderRadius: 10, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                    {s.code} · {s.start_time}–{s.end_time}
                  </button>
                ))}
                <button type="button" onClick={() => setSelectedShiftCode('OFF')}
                  style={{ background: selectedShiftCode === 'OFF' ? '#64748b' : '#f8fafc', color: selectedShiftCode === 'OFF' ? '#fff' : '#64748b', border: '2px solid #94a3b8', borderRadius: 10, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                  🛌 Libre
                </button>
                <button type="button" onClick={() => setSelectedShiftCode(null)}
                  style={{ ...btnDanger, borderRadius: 10, padding: '8px 14px' }}>
                  ✕ Borrar
                </button>
              </div>

              {/* Tabla */}
              <div style={{ border: '1px solid #d9e2ec', borderRadius: 18, overflow: 'auto', maxHeight: 'calc(100vh - 460px)' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 900, width: 'max-content' }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', left: 0, zIndex: 4, background: '#f8fafc', minWidth: 200, borderBottom: '1px solid #e5edf5', borderRight: '1px solid #e5edf5', padding: '10px 12px', textAlign: 'left' }}>Trabajador</th>
                      {days.map(day => (
                        <th key={day.key} style={{ background: day.weekend ? '#fef3c7' : '#f8fafc', color: '#52657a', minWidth: 58, borderBottom: '1px solid #e5edf5', borderRight: '1px solid #e5edf5', padding: '8px 4px', textAlign: 'center' }}>
                          <span style={{ display: 'block', fontSize: 10 }}>{day.short}</span>
                          <strong style={{ display: 'block', fontSize: 13, color: day.weekDay === 0 ? '#dc2626' : '#1f2937' }}>{day.day}</strong>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {workers.map(worker => {
                      const workerCal = calendar[worker.id] || {};
                      const totalShifts = Object.values(workerCal).filter(c => c.shift_code).length;
                      return (
                        <tr key={worker.id}>
                          <td style={{ position: 'sticky', left: 0, zIndex: 3, background: '#fff', minWidth: 200, borderBottom: '1px solid #e5edf5', borderRight: '1px solid #e5edf5', padding: '10px 14px' }}>
                            <strong style={{ display: 'block', fontSize: 13 }}>{worker.first_name} {worker.last_name}</strong>
                            <span style={{ color: '#6b7f94', fontSize: 11 }}>{worker.rut}</span>
                            <span style={{ display: 'block', color: '#1155a5', fontSize: 11, fontWeight: 700 }}>{totalShifts} turnos</span>
                          </td>
                          {days.map(day => {
                            const cell = workerCal[day.day];
                            const hasShift = cell?.shift_code;
                            const isDayOff = cell?.is_day_off;
                            const shift = availableShifts.find(s => s.code === cell?.shift_code);
                            return (
                              <td key={day.key} style={{ background: day.weekend ? '#fffbeb' : '#fff', borderBottom: '1px solid #e5edf5', borderRight: '1px solid #e5edf5', padding: 3 }}>
                                <button
                                  type="button"
                                  onClick={() => assignCell(worker.id, day.day)}
                                  style={{
                                    background: hasShift ? `${shift?.color || '#1155a5'}18` : isDayOff ? '#f1f5f9' : '#fff',
                                    border: `1px solid ${hasShift ? (shift?.color || '#1155a5') + '55' : '#e5edf5'}`,
                                    borderRadius: 6, color: hasShift ? (shift?.color || '#1155a5') : '#c0ccd8',
                                    cursor: 'pointer', fontWeight: 700, fontSize: 10, height: 38, width: '100%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
                                  }}>
                                  {hasShift ? (
                                    <>
                                      <span style={{ fontSize: 11, fontWeight: 800 }}>{cell.shift_code}</span>
                                    </>
                                  ) : isDayOff ? (
                                    <span style={{ fontSize: 14 }}>🛌</span>
                                  ) : (
                                    <span style={{ fontSize: 16, color: '#dde3ea' }}>+</span>
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {workers.length === 0 && (
                      <tr><td colSpan={days.length + 1} style={{ textAlign: 'center', color: '#6b7f94', padding: 40 }}>
                        No hay trabajadores activos en la sucursal.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>
                Haz clic en cualquier celda para asignar el turno seleccionado. Guarda el borrador antes de salir.
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
