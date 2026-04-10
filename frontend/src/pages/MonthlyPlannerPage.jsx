import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MODES = [
  { value: 'simulation', label: 'Simulacion' },
  { value: 'planning', label: 'Planificacion' },
];
const EXCEPTION_TYPES = ['vacaciones', 'licencia', 'permiso', 'traslado', 'bloqueo'];
const SHIFTS = [
  { code: 'T1', label: 'Turno 1', time: '09:00 a 18:00', color: '#1155a5' },
  { code: 'T2', label: 'Turno 2', time: '10:00 a 19:00', color: '#1d4ed8' },
  { code: 'T3', label: 'Turno 3', time: '11:00 a 20:00', color: '#2563eb' },
  { code: 'T4', label: 'Turno 4', time: '12:00 a 21:00', color: '#0f766e' },
  { code: 'T5', label: 'Turno 5', time: '13:00 a 22:00', color: '#0ea5e9' },
];
const DAY_NAMES = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];

const page = { minHeight: '100vh', background: '#eef2f7', color: '#243447' };
const card = { background: '#fff', border: '1px solid #d9e2ec', borderRadius: 16, boxShadow: '0 16px 36px rgba(19,47,76,0.08)' };
const label = { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, fontWeight: 700, color: '#52657a', textTransform: 'uppercase', letterSpacing: '.05em' };
const input = { background: '#f8fafc', border: '1px solid #cdd9e5', borderRadius: 12, color: '#243447', padding: '12px 14px', fontSize: 14, fontFamily: 'inherit' };
const primary = { background: 'linear-gradient(135deg,#1155a5,#0b67b2)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 18px', fontWeight: 700, cursor: 'pointer' };
const secondary = { background: '#f8fafc', color: '#243447', border: '1px solid #cdd9e5', borderRadius: 10, padding: '12px 18px', fontWeight: 700, cursor: 'pointer' };

function toKey(date) {
  return date.toISOString().split('T')[0];
}

function getMonthDays(year, monthNumber) {
  const total = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: total }, (_, index) => {
    const date = new Date(year, monthNumber - 1, index + 1);
    return { key: toKey(date), day: index + 1, weekDay: date.getDay(), short: DAY_NAMES[date.getDay()], weekend: date.getDay() === 0 || date.getDay() === 6 };
  });
}

function buildRoster(workers, count) {
  const base = workers.map((worker) => ({
    id: `worker-${worker.id}`,
    workerId: worker.id,
    name: `${worker.first_name} ${worker.last_name}`,
    rut: worker.rut,
    placeholder: false,
  }));
  if (count <= base.length) return base.slice(0, count);
  const extra = Array.from({ length: count - base.length }, (_, index) => ({
    id: `placeholder-${index + 1}`,
    workerId: null,
    name: `Cupo pendiente ${index + 1}`,
    rut: 'Sin RUT',
    placeholder: true,
  }));
  return [...base, ...extra];
}

function buildCalendar(roster, days, shiftCount, exceptions) {
  const activeShifts = SHIFTS.slice(0, Math.max(2, Math.min(shiftCount, SHIFTS.length)));
  return roster.reduce((acc, row, rowIndex) => {
    acc[row.id] = {};
    days.forEach((day, dayIndex) => {
      const blocked = exceptions.find((item) => String(item.workerId) === String(row.workerId) && day.key >= item.from && day.key <= item.to);
      if (blocked || day.weekDay === 0) {
        acc[row.id][day.key] = '';
        return;
      }
      const weekIndex = Math.floor((day.day - 1) / 7);
      const freeDay = ((rowIndex + weekIndex) % 5) + 1;
      if (day.weekDay === freeDay || (day.weekDay === 6 && (rowIndex + weekIndex) % 2 === 1)) {
        acc[row.id][day.key] = '';
        return;
      }
      acc[row.id][day.key] = activeShifts[(rowIndex + dayIndex) % activeShifts.length].code;
    });
    return acc;
  }, {});
}

export default function MonthlyPlannerPage() {
  const today = new Date();
  const year = today.getFullYear();
  const { user, logout, currentBranchId, switchBranch } = useAuth();
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [branchId, setBranchId] = useState(currentBranchId ? String(currentBranchId) : '');
  const [mode, setMode] = useState('planning');
  const [panel, setPanel] = useState('');
  const [workers, setWorkers] = useState([]);
  const [loadedBranchId, setLoadedBranchId] = useState('');
  const [dotation, setDotation] = useState(0);
  const [shiftCount, setShiftCount] = useState(4);
  const [selectedShift, setSelectedShift] = useState('T1');
  const [calendar, setCalendar] = useState({});
  const [exceptions, setExceptions] = useState([]);
  const [draft, setDraft] = useState({ workerId: '', type: 'vacaciones', from: toKey(today), to: toKey(today), note: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!branchId && currentBranchId) setBranchId(String(currentBranchId));
  }, [branchId, currentBranchId]);

  const days = useMemo(() => getMonthDays(year, Number(month)), [month, year]);
  const roster = useMemo(() => buildRoster(workers, dotation || workers.length || 0), [workers, dotation]);
  const activeShifts = useMemo(() => SHIFTS.slice(0, Math.max(2, Math.min(shiftCount, SHIFTS.length))), [shiftCount]);
  const shiftMap = useMemo(() => activeShifts.reduce((acc, item) => ({ ...acc, [item.code]: item }), {}), [activeShifts]);
  const selectedBranch = user?.branches?.find((branch) => String(branch.id) === String(branchId)) || null;

  const resetPlanner = () => {
    setPanel('');
    setWorkers([]);
    setLoadedBranchId('');
    setDotation(0);
    setCalendar({});
    setExceptions([]);
    setSelectedShift('T1');
    setError('');
    setMessage('');
  };

  const ensureWorkers = async () => {
    if (loadedBranchId === branchId && workers.length > 0) return workers;
    const list = await api.workers.list({ branch_id: branchId, is_active: true });
    setWorkers(list);
    setLoadedBranchId(branchId);
    setDotation(list.length);
    return list;
  };

  const regenerate = (nextWorkers, nextDotation, nextShiftCount, nextExceptions) => {
    setCalendar(buildCalendar(buildRoster(nextWorkers, nextDotation), days, nextShiftCount, nextExceptions));
    setSelectedShift((current) => (SHIFTS.slice(0, nextShiftCount).some((item) => item.code === current) ? current : 'T1'));
    setMessage(`Propuesta base generada para ${selectedBranch?.name || 'la sucursal'} con ${nextDotation} cupos y ${Math.max(2, Math.min(nextShiftCount, SHIFTS.length))} turnos.`);
  };

  const openContinue = async () => {
    if (!branchId) return;
    setPanel('continue');
    setLoading(true);
    setError('');
    try {
      const list = await ensureWorkers();
      regenerate(list, dotation || list.length, shiftCount, exceptions);
    } catch (err) {
      setError(err.message || 'No se pudo cargar la dotacion.');
    } finally {
      setLoading(false);
    }
  };

  const openExceptions = async () => {
    if (!branchId) return;
    setPanel('exceptions');
    setLoading(true);
    setError('');
    try {
      await ensureWorkers();
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los trabajadores.');
    } finally {
      setLoading(false);
    }
  };

  const addException = () => {
    if (!draft.workerId || !draft.from || !draft.to) return;
    const next = [...exceptions, { ...draft, id: `${draft.workerId}-${draft.from}-${draft.to}-${Date.now()}` }];
    setExceptions(next);
    setDraft({ workerId: '', type: 'vacaciones', from: toKey(today), to: toKey(today), note: '' });
    setMessage('Cambio del mes agregado a la base local.');
    if (panel === 'continue' && workers.length > 0) regenerate(workers, dotation, shiftCount, next);
  };

  const assignCell = (rowId, dayKey) => {
    setCalendar((current) => ({ ...current, [rowId]: { ...(current[rowId] || {}), [dayKey]: selectedShift === 'OFF' ? '' : selectedShift } }));
  };

  return (
    <div style={page}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(90deg,#0f4f97,#1155a5 55%,#0b67b2)', color: '#fff', padding: '18px 24px' }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Planificacion mensual</div>
          <div style={{ fontSize: 13, opacity: 0.78 }}>Modulo beta sobre TurnosRRHH</div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link to="/weekly" style={{ ...secondary, textDecoration: 'none', color: '#0f4f97', background: '#fff' }}>Vista semanal</Link>
          <button type="button" style={{ ...secondary, background: 'rgba(255,255,255,.12)', color: '#fff', borderColor: 'rgba(255,255,255,.2)' }} onClick={logout}>Salir</button>
        </div>
      </header>

      <main style={{ display: 'grid', gridTemplateColumns: '320px minmax(0,1fr)', gap: 24, maxWidth: 1600, margin: '0 auto', padding: 24 }}>
        <aside style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, height: 'fit-content' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#1155a5', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>Paso 1</div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Base de calculo</h1>
            <p style={{ color: '#52657a', lineHeight: 1.65 }}>Selecciona mes, sucursal y modo. Desde aqui se abren los paneles `Continuar`, `Cargar calendario` e `Importar cambios del mes`.</p>
          </div>

          <label style={label}>Mes<select value={month} onChange={(event) => { setMonth(event.target.value); resetPlanner(); }} style={input}>{MONTHS.map((item, index) => <option key={item} value={index + 1}>{item}</option>)}</select></label>
          <label style={label}>Sucursal<select value={branchId} onChange={(event) => { const value = event.target.value; setBranchId(value); if (value) switchBranch(Number(value)); resetPlanner(); }} style={input}><option value="">Selecciona una sucursal</option>{user?.branches?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label style={label}>Modo<select value={mode} onChange={(event) => { setMode(event.target.value); setPanel(''); setError(''); setMessage(''); }} style={input}>{MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>

          <div style={{ ...card, boxShadow: 'none', background: '#f2f7fd', borderColor: '#d6e5f7', padding: 16 }}>
            <strong style={{ color: '#0f4f97' }}>{MONTHS[Number(month) - 1]}</strong>
            <span style={{ float: 'right', background: '#fff', color: '#1155a5', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>{year}</span>
          </div>

          <button type="button" style={primary} disabled={!branchId || loading} onClick={openContinue}>{loading && panel === 'continue' ? 'Cargando...' : 'Continuar'}</button>
          <button type="button" style={secondary} disabled={!branchId} onClick={() => { setPanel('upload'); setMessage('Aqui luego se puede conectar OCR o IA via n8n.'); }}>Cargar calendario</button>
          <button type="button" style={secondary} disabled={!branchId} onClick={openExceptions}>Importar cambios del mes</button>

          <div style={{ background: '#f8fafc', border: '1px dashed #cdd9e5', borderRadius: 16, color: '#52657a', padding: 16, lineHeight: 1.6 }}>
            <strong style={{ display: 'block', color: '#243447', marginBottom: 8 }}>Base actual</strong>
            Esta fase usa las sucursales y trabajadores ya cargados en la app. La optimizacion real por franja y el export `DIA1..DIA31` seria el siguiente paso.
          </div>
        </aside>

        <section style={{ ...card, padding: 24, minHeight: 760 }}>
          {!panel && (
            <div style={{ display: 'grid', gap: 20 }}>
              <div style={{ ...card, boxShadow: 'none', background: 'linear-gradient(135deg,#f8fbff,#f1f6fc)', borderColor: '#dae6f2', padding: 22 }}>
                <span style={{ background: '#0f4f97', borderRadius: 999, color: '#fff', display: 'inline-block', fontSize: 12, fontWeight: 700, padding: '6px 12px' }}>Fase 1</span>
                <h2 style={{ margin: '12px 0 10px', fontSize: 28 }}>Panel inicial listo para crecer</h2>
                <p style={{ color: '#52657a', maxWidth: 760, lineHeight: 1.65 }}>La idea es entrar por este punto, decidir si quieres generar, cargar un calendario existente o preparar cambios del mes antes de planificar.</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 18 }}>
                {[
                  ['1.1 Continuar', 'Carga la dotacion de la sucursal y abre la grilla mensual editable.'],
                  ['1.2 Cargar calendario', 'Reserva el espacio para subir una imagen o plantilla visual con OCR o IA.'],
                  ['1.3 Cambios del mes', 'Permite registrar vacaciones, licencias o bloqueos antes de regenerar la propuesta.'],
                ].map(([title, copy]) => (
                  <article key={title} style={{ ...card, boxShadow: 'none', padding: 22 }}><h3 style={{ marginTop: 0 }}>{title}</h3><p style={{ color: '#52657a', lineHeight: 1.65 }}>{copy}</p></article>
                ))}
              </div>
            </div>
          )}

          {error && <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 14, color: '#be123c', fontWeight: 700, marginBottom: 18, padding: '14px 16px' }}>{error}</div>}
          {message && <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 14, color: '#1d4ed8', fontWeight: 700, marginBottom: 18, padding: '14px 16px' }}>{message}</div>}

          {panel === 'upload' && (
            <div style={{ display: 'grid', gap: 24, gridTemplateColumns: '220px minmax(0,1fr)', alignItems: 'center', marginTop: 8 }}>
              <div style={{ ...card, minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#1155a5,#0b67b2)', color: '#fff', fontSize: 28, fontWeight: 800 }}>OCR / IA</div>
              <div>
                <h2 style={{ marginTop: 0 }}>Cargar calendario</h2>
                <ul style={{ color: '#52657a', lineHeight: 1.8 }}>
                  <li>Subir imagen o plantilla visual ya confeccionada.</li>
                  <li>Procesar con n8n o un servicio interno.</li>
                  <li>Devolver JSON con RUT, DIA1..DIA31 y horarios en texto.</li>
                  <li>Revisar y corregir dentro de la app antes de exportar.</li>
                </ul>
              </div>
            </div>
          )}

          {panel === 'exceptions' && (
            <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,.8fr)' }}>
              <div style={{ ...card, boxShadow: 'none', padding: 20 }}>
                <h2 style={{ marginTop: 0 }}>Cambios del mes</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 14, marginBottom: 14 }}>
                  <label style={label}>Trabajador<select value={draft.workerId} onChange={(event) => setDraft((current) => ({ ...current, workerId: event.target.value }))} style={input}><option value="">Selecciona un trabajador</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.first_name} {worker.last_name}</option>)}</select></label>
                  <label style={label}>Tipo<select value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))} style={input}>{EXCEPTION_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                  <label style={label}>Desde<input type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} style={input} /></label>
                  <label style={label}>Hasta<input type="date" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} style={input} /></label>
                </div>
                <label style={label}>Nota<textarea rows="3" value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} style={{ ...input, resize: 'vertical' }} placeholder="Ejemplo: permiso personal o bloqueo por traslado." /></label>
                <button type="button" style={{ ...primary, marginTop: 16 }} onClick={addException}>Agregar cambio del mes</button>
              </div>

              <div style={{ ...card, boxShadow: 'none', padding: 20 }}>
                <h3 style={{ marginTop: 0 }}>Base local de cambios</h3>
                {exceptions.length === 0 ? <p style={{ color: '#6b7f94' }}>Todavia no hay cambios del mes registrados para esta sucursal.</p> : exceptions.map((item) => {
                  const worker = workers.find((row) => String(row.id) === String(item.workerId));
                  return <div key={item.id} style={{ background: '#f8fafc', border: '1px solid #d9e2ec', borderRadius: 14, padding: 14, marginBottom: 12 }}><strong>{worker ? `${worker.first_name} ${worker.last_name}` : 'Trabajador'}</strong><div style={{ color: '#52657a', fontSize: 13, marginTop: 4 }}>{item.type} · {item.from} a {item.to}</div>{item.note && <div style={{ color: '#6b7f94', fontSize: 12, marginTop: 6 }}>{item.note}</div>}</div>;
                })}
              </div>
            </div>
          )}

          {panel === 'continue' && (
            <div>
              <h2 style={{ marginTop: 0 }}>Planificacion mensual asistida</h2>
              <p style={{ color: '#52657a', lineHeight: 1.65 }}>La app toma la sucursal, carga la dotacion base y propone una grilla mensual que luego puedes corregir manualmente.</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 16, marginTop: 20 }}>
                {[
                  ['Dotacion base', workers.length],
                  ['Dotacion de calculo', dotation],
                  ['Turnos activos', activeShifts.length],
                  ['Celdas con turno', Object.values(calendar).reduce((total, row) => total + Object.values(row).filter(Boolean).length, 0)],
                ].map(([title, value]) => <div key={title} style={{ ...card, boxShadow: 'none', padding: 18 }}><span style={{ color: '#6b7f94', fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>{title}</span><strong style={{ display: 'block', color: '#1155a5', fontSize: 28, marginTop: 6 }}>{value}</strong></div>)}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end', marginTop: 22 }}>
                <label style={label}>Dotacion<input type="number" min="1" max={Math.max((workers.length || 1) + 10, dotation)} value={dotation} onChange={(event) => setDotation(Number(event.target.value))} style={{ ...input, maxWidth: 120 }} /></label>
                <label style={label}>Turnos<input type="number" min="2" max={SHIFTS.length} value={shiftCount} onChange={(event) => setShiftCount(Number(event.target.value))} style={{ ...input, maxWidth: 120 }} /></label>
                <button type="button" style={primary} onClick={() => regenerate(workers, dotation, shiftCount, exceptions)}>Regenerar propuesta</button>
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 999, color: '#1d4ed8', minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '0 16px', fontWeight: 700 }}>{mode === 'simulation' ? 'Simulacion activa' : 'Planificacion real'}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 14, marginTop: 22 }}>
                {activeShifts.map((shift) => <button key={shift.code} type="button" onClick={() => setSelectedShift(shift.code)} style={{ ...card, boxShadow: selectedShift === shift.code ? '0 10px 24px rgba(17,85,165,0.12)' : 'none', borderColor: selectedShift === shift.code ? shift.color : '#d9e2ec', padding: 16, textAlign: 'left', cursor: 'pointer' }}><strong style={{ color: shift.color, display: 'block', fontSize: 18 }}>{shift.label}</strong><span style={{ color: '#52657a', fontSize: 14 }}>{shift.time}</span><small style={{ color: '#6b7f94', display: 'block', fontWeight: 700, letterSpacing: '.08em', marginTop: 8 }}>{shift.code}</small></button>)}
                <button type="button" onClick={() => setSelectedShift('OFF')} style={{ ...card, boxShadow: selectedShift === 'OFF' ? '0 10px 24px rgba(17,85,165,0.12)' : 'none', borderColor: selectedShift === 'OFF' ? '#94a3b8' : '#d9e2ec', padding: 16, textAlign: 'left', cursor: 'pointer' }}><strong style={{ color: '#64748b', display: 'block', fontSize: 18 }}>Libre</strong><span style={{ color: '#52657a', fontSize: 14 }}>Deja la celda en blanco</span><small style={{ color: '#6b7f94', display: 'block', fontWeight: 700, letterSpacing: '.08em', marginTop: 8 }}>OFF</small></button>
              </div>

              {roster.some((row) => row.placeholder) && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, color: '#b45309', fontWeight: 700, marginTop: 18, padding: '14px 16px' }}>Hay {roster.filter((row) => row.placeholder).length} cupo(s) sin RUT. Sirve para simular cobertura, pero aun no es exportable.</div>}

              <div style={{ border: '1px solid #d9e2ec', borderRadius: 18, marginTop: 22, overflow: 'auto' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 1080, width: 'max-content' }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', left: 0, zIndex: 4, background: '#f8fafc', minWidth: 220, borderBottom: '1px solid #e5edf5', borderRight: '1px solid #e5edf5', padding: '10px 12px' }}>Trabajador</th>
                      {days.map((day) => <th key={day.key} style={{ background: day.weekend ? '#fbfdff' : '#f8fafc', color: '#52657a', minWidth: 64, borderBottom: '1px solid #e5edf5', borderRight: '1px solid #e5edf5', padding: '10px 6px', textAlign: 'center' }}><span style={{ display: 'block', fontSize: 12 }}>{day.short}</span><strong style={{ display: 'block', fontSize: 15, color: '#1f2937' }}>{day.day}</strong></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((row) => <tr key={row.id}><td style={{ position: 'sticky', left: 0, zIndex: 3, background: '#fff', minWidth: 220, borderBottom: '1px solid #e5edf5', borderRight: '1px solid #e5edf5', padding: '12px 14px' }}><strong style={{ display: 'block', fontSize: 14 }}>{row.name}</strong><span style={{ color: '#6b7f94', fontSize: 12 }}>{row.rut}</span></td>{days.map((day) => { const code = calendar[row.id]?.[day.key] || ''; const shift = shiftMap[code]; return <td key={`${row.id}-${day.key}`} style={{ background: day.weekend ? '#fbfdff' : '#fff', borderBottom: '1px solid #e5edf5', borderRight: '1px solid #e5edf5', padding: 0 }}><button type="button" onClick={() => assignCell(row.id, day.key)} style={{ background: shift ? `${shift.color}15` : '#fff', border: `1px solid ${shift ? `${shift.color}55` : 'transparent'}`, borderRadius: 8, color: shift ? shift.color : '#c0ccd8', cursor: 'pointer', fontWeight: 700, fontSize: 12, height: 42, margin: 8, width: 'calc(100% - 16px)' }}>{code}</button></td>; })}</tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
