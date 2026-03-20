import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './index.css'

// ─── Helpers ─────────────────────────────────────────────────────────────────
const calcHours = (start, end) => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let d = (eh + em / 60) - (sh + sm / 60);
  if (d < 0) d += 24;
  return Math.round(d * 10) / 10;
};

let nextTplId = 6;
const freshId = () => ++nextTplId;

const TODAY = new Date('2026-03-19T00:00:00'); // fixed reference date

const genDays = (weeks = 16) => {
  const out = [];
  const ref = new Date('2026-03-19T12:00:00');
  const dow = ref.getDay();
  const base = new Date(ref);
  // Start 4 weeks back (historical view)
  base.setDate(ref.getDate() + (dow === 0 ? -6 : 1 - dow) - 28);
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const sun = d.getDay() === 0;
    const dayDate = new Date(d); dayDate.setHours(0,0,0,0);
    const isPast = dayDate < TODAY;
    out.push({
      dateStr: d.toISOString().split('T')[0],
      day: d.getDate(),
      dayName: ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()],
      mon: d.toLocaleString('es-ES', { month: 'short' }),
      sun,
      isPast,
    });
  }
  return out;
};

const weekLabel = (sundayStr) => {
  const s = new Date(sundayStr + 'T12:00:00');
  const m = new Date(s); m.setDate(s.getDate() - 6);
  const sm = m.toLocaleString('es-ES', { month: 'short' }).substring(0, 3);
  const em = s.toLocaleString('es-ES', { month: 'short' }).substring(0, 3);
  return sm === em
    ? `${m.getDate()}-${s.getDate()} ${sm}`
    : `${m.getDate()} ${sm} – ${s.getDate()} ${em}`;
};

// ─── Initial Data ─────────────────────────────────────────────────────────────
const INIT_TEMPLATES = [
  { id: 1, code: 'TM', start: '08:00', end: '16:00', color: '#3B82F6' },
  { id: 2, code: 'TT', start: '15:00', end: '23:00', color: '#8B5CF6' },
  { id: 3, code: 'TC', start: '08:00', end: '18:00', color: '#10B981' },
  { id: 4, code: 'MA', start: '08:00', end: '13:00', color: '#F59E0B' },
  { id: 5, code: 'MP', start: '13:00', end: '18:00', color: '#EF4444' },
];

const INIT_WORKERS = [
  { id: 1, name: 'Juan Pérez',   rut: '12.345.678-9' },
  { id: 2, name: 'María Gómez',  rut: '13.456.789-0' },
  { id: 3, name: 'Pedro Silva',  rut: '14.567.890-1' },
  { id: 4, name: 'Ana Rojas',    rut: '15.678.901-2' },
];

// Pre-generate some historical data for past weeks
const generateHistoricalData = (days) => {
  const patterns = {
    1: { codes: ['TM','TM','TM','TM','TM','L','L','TM','TM','TC','TM','TM','L','L','TM','TM','TM','TM','TC','L','L','TM','TT','TM','TM','TC','L','L'] },
    2: { codes: ['TT','TT','TT','TT','L','TT','L','TT','TC','TT','TT','L','TT','L','TT','TT','TT','TT','L','TT','L','TC','TT','TT','TT','L','TT','L'] },
    3: { codes: ['TC','TM','TC','TC','TC','L','L','TC','TC','TM','TC','TC','L','L','TC','TC','TC','TM','TC','L','L','TC','TC','TC','TC','TM','L','L'] },
    4: { codes: ['MA','MA','MP','MA','MA','L','L','MA','MA','MA','MP','MA','L','L','MA','MP','MA','MA','MA','L','L','MA','MA','MP','MA','MA','L','L'] },
  };
  const result = {};
  INIT_WORKERS.forEach(w => {
    result[w.id] = {};
    const pat = patterns[w.id]?.codes || [];
    const pastDays = days.filter(d => d.isPast);
    pastDays.forEach((d, i) => {
      if (pat[i % pat.length]) {
        result[w.id][d.dateStr] = pat[i % pat.length];
      }
    });
  });
  return result;
};

const DAYS = genDays();
const HISTORICAL = generateHistoricalData(DAYS);

// ─── Portal Dropdown ──────────────────────────────────────────────────────────
const PortalDropdown = ({ open, rect, templates, code, onSelect, onClose }) => {
  if (!open || !rect) return null;

  const spaceBelow = window.innerHeight - rect.bottom;
  const flip = spaceBelow < 300 && rect.top > 300;

  // FIX 6: If rect.left is too close to left edge (behind sticky name column), shift right
  const rawLeft = rect.left + rect.width / 2;
  const safeLeft = Math.max(rawLeft, 220);

  const style = {
    position: 'fixed',
    left: safeLeft,
    transform: flip ? 'translate(-50%, -100%)' : 'translateX(-50%)',
    top: flip ? rect.top - 4 : rect.bottom + 4,
    zIndex: 9999,
    background: '#1E293B',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '6px',
    boxShadow: '0 14px 28px rgba(0,0,0,.55)',
    minWidth: '175px',
    maxHeight: '280px',
    overflowY: 'auto',
  };

  return createPortal(
    <div data-portal-dropdown="true" onClick={e => e.stopPropagation()} style={style}>
      <div className="dropdown-item clear" onClick={() => { onSelect(null); onClose(); }}>
        <span>🗑️ Borrar turno</span>
      </div>
      <div className="dropdown-item" style={{ color:'#94A3B8' }}
        onClick={() => { onSelect('L'); onClose(); }}>
        <span>🛌 Día Libre</span>
      </div>
      <div className="dropdown-divider"/>
      {templates.map(t => {
        const h = calcHours(t.start, t.end);
        const active = code === t.code;
        return (
          <div key={t.id} className="dropdown-item"
            onClick={() => { onSelect(t.code); onClose(); }}
            style={{ background: active ? 'rgba(255,255,255,0.07)' : undefined, borderRadius:'6px' }}>
            <div className="dropdown-color" style={{ background: t.color }}/>
            <div style={{ flex:1 }}>
              <span style={{ color: t.color, fontWeight:'bold', fontSize:'13px' }}>{t.code}</span>
              <div style={{ fontSize:'10px', color:'#64748B' }}>{t.start}–{t.end}</div>
            </div>
            <span className="dropdown-item-hours">{h}h</span>
          </div>
        );
      })}
    </div>,
    document.body
  );
};

// ─── Shift Cell ───────────────────────────────────────────────────────────────
const ShiftCell = ({ code, date, workerId, templates, isPast, swapMode, swapSource, onSelect, onSwapClick, isOpen, onToggle }) => {
  const [rect, setRect] = useState(null);
  const ref = useRef(null);

  const isL = code === 'L';
  const tpl = !isL ? templates.find(t => t.code === code) : null;
  const h   = tpl ? calcHours(tpl.start, tpl.end) : 0;

  const isSource = swapSource?.workerId === workerId && swapSource?.date === date;
  const isTarget = swapMode && swapSource && !isSource;

  useEffect(() => {
    if (!isOpen) return;
    const close = (e) => {
      if (!e.target.closest('.shift-selector') && !e.target.closest('[data-portal-dropdown]')) {
        onToggle(false);
      }
    };
    // FIX 1: Only close on scroll if scroll did NOT originate inside the portal dropdown
    const scroll = (e) => {
      if (!e.target.closest('[data-portal-dropdown]')) {
        onToggle(false);
      }
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [isOpen, onToggle]);

  const handleClick = () => {
    if (isPast) return; // FIX 2: Past days are read-only
    if (swapMode) { onSwapClick(workerId, date, code); return; }
    if (ref.current && !isOpen) {
      setRect(ref.current.getBoundingClientRect());
    }
    onToggle(!isOpen);
  };

  let extraStyle = {};
  if (isSource)  extraStyle = { boxShadow: '0 0 0 2px #F59E0B', borderColor: '#F59E0B', background: 'rgba(245,158,11,0.12)' };
  if (isTarget)  extraStyle = { boxShadow: '0 0 0 2px #3B82F6', borderColor: '#3B82F6', background: 'rgba(59,130,246,0.10)', cursor: 'crosshair' };

  // FIX 2: Style for past/historical cells
  const pastStyle = isPast ? { opacity: 0.55, cursor: 'default', background: 'rgba(15,23,42,0.5)' } : {};

  return (
    <div ref={ref} style={{ display:'block' }}>
      <button type="button" onClick={handleClick}
        className={`shift-btn ${tpl ? 'has-shift' : isL ? 'day-off' : ''}`}
        style={{ '--shift-color': tpl?.color, ...extraStyle, ...pastStyle, minHeight: '64px', width: '100%' }}>
        {/* Past lock icon */}
        {isPast && code && (
          <span style={{ position:'absolute', top:'3px', right:'4px', fontSize:'9px', color:'#475569' }}>🔒</span>
        )}
        {tpl ? (
          <>
            <span className="shift-code">{tpl.code}</span>
            <span style={{ fontSize:'10px', color: tpl.color, opacity: 0.85, marginTop:'2px' }}>{tpl.start}–{tpl.end}</span>
            <span className="shift-hours-label">{h}h</span>
          </>
        ) : isL ? (
          <>
            <span style={{ fontSize:'16px' }}>🛌</span>
            <span className="shift-dayoff-label">Libre</span>
          </>
        ) : (
          <span className="shift-empty" style={{ fontSize:'24px' }}>+</span>
        )}
      </button>
      {!isPast && (
        <PortalDropdown open={isOpen} rect={rect} templates={templates} code={code}
          onSelect={onSelect} onClose={() => onToggle(false)} />
      )}
    </div>
  );
};

// ─── Template Editor Modal ─────────────────────────────────────────────────────
const TplModal = ({ templates, setTemplates, onClose }) => {
  const addRow = () => setTemplates(prev => [
    ...prev, { id: freshId(), code: 'NUE', start: '08:00', end: '16:00', color: '#6366F1' }
  ]);
  const delRow = (id) => setTemplates(prev => prev.filter(t => t.id !== id));
  const upd = (id, field, val) => setTemplates(prev =>
    prev.map(t => t.id === id ? { ...t, [field]: val } : t)
  );

  // FIX 4: 6-column grid: Código | Entrada | Salida | Dur | Color | ×
  const GRID = '88px 120px 120px 52px 44px 38px';

  return (
    <div className="modal-overlay" style={{ zIndex:1000, display:'flex' }}>
      <div className="modal" style={{ width:'560px', maxHeight:'90vh', display:'flex', flexDirection:'column' }}>
        <div className="modal-header">
          <h3>⚙️ Plantillas de Turno</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body" style={{ overflowY: 'auto', maxHeight: '60vh', paddingBottom: '16px' }}>
          {/* Header */}
          <div style={{ display:'grid', gridTemplateColumns: GRID, gap:'8px',
            color:'#64748B', fontSize:'11px', fontWeight:700, textTransform:'uppercase',
            marginBottom:'8px', padding:'0 4px' }}>
            <span>Código</span><span>Entrada</span><span>Salida</span>
            <span>Dur.</span><span>Color</span><span></span>
          </div>
          {templates.map(t => {
            const h = calcHours(t.start, t.end);
            return (
              <div key={t.id} style={{ display:'grid', gridTemplateColumns: GRID,
                gap:'8px', alignItems:'center', marginBottom:'10px' }}>
                {/* Código */}
                <input type="text" value={t.code} maxLength={5}
                  style={{ width:'100%', background:'#0F172A', border:`1px solid ${t.color}`,
                    color: t.color, borderRadius:'6px', padding:'5px 6px', fontWeight:'bold',
                    textAlign:'center', fontSize:'13px' }}
                  onChange={e => upd(t.id,'code',e.target.value.toUpperCase())} />
                {/* Entrada */}
                <input type="time" value={t.start}
                  style={{ background:'#0F172A', border:'1px solid #334155', color:'#F1F5F9',
                    borderRadius:'6px', padding:'5px 6px', width:'100%' }}
                  onChange={e => upd(t.id,'start',e.target.value)} />
                {/* Salida */}
                <input type="time" value={t.end}
                  style={{ background:'#0F172A', border:'1px solid #334155', color:'#F1F5F9',
                    borderRadius:'6px', padding:'5px 6px', width:'100%' }}
                  onChange={e => upd(t.id,'end',e.target.value)} />
                {/* Duración (FIX 4: own column) */}
                <div style={{ textAlign:'center', fontSize:'12px', fontWeight:'bold', color:'#94A3B8' }}>
                  {h}h
                </div>
                {/* Color */}
                <input type="color" value={t.color}
                  style={{ width:'40px', height:'34px', border:'none', background:'none',
                    cursor:'pointer', borderRadius:'4px' }}
                  onChange={e => upd(t.id,'color',e.target.value)} />
                {/* Eliminar */}
                <button onClick={() => delRow(t.id)} title="Eliminar"
                  style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)',
                    color:'#F87171', borderRadius:'6px', cursor:'pointer', fontSize:'16px',
                    width:'36px', height:'34px', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  ×
                </button>
              </div>
            );
          })}

          <button onClick={addRow} className="btn btn-secondary"
            style={{ width:'100%', marginTop:'12px', borderStyle:'dashed' }}>
            + Agregar plantilla
          </button>

          <div className="alert alert-warning" style={{ marginTop:'14px', fontSize:'12px' }}>
            Las horas totales se calculan automáticamente. Los cambios se reflejan de inmediato en la grilla.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Guardar y Cerrar</button>
        </div>
      </div>
    </div>
  );
};

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [templates, setTemplates] = useState(INIT_TEMPLATES);
  const tableWrapperRef = useRef(null);
  const [schedules, setSchedules] = useState(() => {
    // Start with historical data pre-loaded
    const init = {};
    INIT_WORKERS.forEach(w => { init[w.id] = { ...HISTORICAL[w.id] }; });
    return init;
  });
  const [showTplModal, setShowTplModal] = useState(false);
  const [openCellKey, setOpenCellKey] = useState(null);

  // ── Swap state ──
  const [swapMode,   setSwapMode]   = useState(false);
  const [swapSource, setSwapSource] = useState(null);

  // ── Labor rule enforcement ──
  const applyRules = (sched) => {
    const s = { ...sched };
    let cons = 0;
    DAYS.forEach((d, i) => {
      if (d.isPast) return; // Don't modify historical data
      const c = s[d.dateStr];
      if (c && c !== 'L') {
        cons++;
        if (cons >= 6 && i + 1 < DAYS.length) { s[DAYS[i+1].dateStr] = 'L'; cons = 0; }
      } else { cons = 0; }
    });

    const sunByMonth = {};
    DAYS.filter(d => d.sun).forEach(d => {
      if (!sunByMonth[d.mon]) sunByMonth[d.mon] = [];
      sunByMonth[d.mon].push(d.dateStr);
    });
    Object.values(sunByMonth).forEach(suns => {
      const futureSuns = suns.filter(x => !DAYS.find(d => d.dateStr === x)?.isPast);
      const worked = futureSuns.filter(x => s[x] && s[x] !== 'L');
      if (worked.length >= 2) futureSuns.forEach(x => { if (!s[x] || s[x] === 'L') s[x] = 'L'; });
    });

    return s;
  };

  const setShift = (workerId, dateStr, code) => {
    setSchedules(prev => {
      const next = { ...prev[workerId], [dateStr]: code };
      return { ...prev, [workerId]: applyRules(next) };
    });
  };

  // ── Copy previous 4 weeks ──
  const handleCopyMonth = () => {
    setSchedules(prev => {
      const next = { ...prev };
      INIT_WORKERS.forEach(w => {
        const workerSched = { ...next[w.id] };
        DAYS.filter(d => !d.isPast).forEach(d => {
          const currentD = new Date(d.dateStr + 'T12:00:00');
          const prevD = new Date(currentD);
          prevD.setDate(currentD.getDate() - 28);
          const prevDateStr = prevD.toISOString().split('T')[0];
          if (workerSched[prevDateStr] !== undefined) {
            workerSched[d.dateStr] = workerSched[prevDateStr];
          }
        });
        next[w.id] = applyRules(workerSched);
      });
      return next;
    });
  };

  // ── Swap logic ──
  const handleSwapClick = (workerId, date) => {
    if (!swapSource) {
      setSwapSource({ workerId, date });
    } else {
      const { workerId: wA, date: dA } = swapSource;
      const wB = workerId, dB = date;
      setSchedules(prev => {
        const cA = prev[wA]?.[dA] ?? null;
        const cB = prev[wB]?.[dB] ?? null;
        const newA = applyRules({ ...prev[wA], [dA]: cB });
        const newB = applyRules({ ...prev[wB], [dB]: cA });
        return { ...prev, [wA]: newA, [wB]: newB };
      });
      setSwapSource(null);
      setSwapMode(false);
    }
  };

  const cancelSwap = () => { setSwapMode(false); setSwapSource(null); };

  // ── Scroll to Today ──
  const scrollToToday = () => {
    if (!tableWrapperRef.current) return;
    const todayStr = TODAY.toISOString().split('T')[0];
    const th = tableWrapperRef.current.querySelector(`th[data-date="${todayStr}"]`);
    if (th) {
      const wrapperRect = tableWrapperRef.current.getBoundingClientRect();
      const thRect = th.getBoundingClientRect();
      const offset = thRect.left - wrapperRect.left + tableWrapperRef.current.scrollLeft - 180; // 180 = sticky col width
      tableWrapperRef.current.scrollTo({ left: offset, behavior: 'smooth' });
    }
  };

  // ── Header ──
  const header = () => {
    const cols = [
      <th key="w" className="col-worker"
        style={{ position:'sticky', left:0, zIndex:60, background:'#0F172A',
          minWidth:'160px', borderRight:'1px solid var(--border-color)' }}>
        Trabajador
      </th>
    ];
    DAYS.forEach(d => {
      const pastHeader = d.isPast ? { color:'#475569' } : {};
      cols.push(
        <th key={d.dateStr} data-date={d.dateStr} className={`col-day ${d.sun ? 'col-sunday' : ''}`}
          style={{ minWidth:'100px', ...pastHeader, outline: !d.isPast && d.dateStr === TODAY.toISOString().split('T')[0] ? '2px solid #3B82F6' : undefined }}>
          <span className="day-name">{d.dayName}</span>
          <span className="day-date" style={d.isPast ? { color:'#475569' } : {}}>{d.day} {d.mon}</span>
          {d.isPast && <span style={{ display:'block', fontSize:'9px', color:'#334155' }}>PASADO</span>}
        </th>
      );
      if (d.sun) cols.push(
        <th key={`cut-${d.dateStr}`} className="col-total"
          style={{ background: d.isPast ? '#0d1a2b' : '#1E293B',
            borderLeft:'1px solid var(--border-color)', minWidth:'110px',
            fontSize:'11px', lineHeight:1.4, whiteSpace:'pre-line' }}>
          <span style={{ color: d.isPast ? '#334155' : '#94A3B8', display:'block' }}>{weekLabel(d.dateStr)}</span>
          <span style={{ color: d.isPast ? '#334155' : '#F1F5F9', fontSize:'10px' }}>TOTAL</span>
        </th>
      );
    });
    return cols;
  };

  // ── Worker row ──
  const workerRow = (worker) => {
    const sched = schedules[worker.id] || {};
    const cells = [
      <td key={`n-${worker.id}`} className="worker-cell"
        style={{ position:'sticky', left:0, zIndex:40, background:'#0F172A',
          borderRight:'1px solid var(--border-color)' }}>
        <div className="worker-name" style={{ color:'#F1F5F9' }}>{worker.name}</div>
        <div className="worker-rut">{worker.rut}</div>
      </td>
    ];

    let weekH = 0;
    DAYS.forEach(d => {
      const code = sched[d.dateStr];
      const tpl  = templates.find(t => t.code === code);
      weekH += tpl ? calcHours(tpl.start, tpl.end) : 0;
      const cellKey = `${worker.id}-${d.dateStr}`;

      cells.push(
        <td key={cellKey}
          className={`shift-cell ${d.sun ? 'sunday-col' : ''}`}
          style={{ padding:'6px', background: d.isPast ? 'rgba(10,16,27,0.3)' : undefined }}>
          <ShiftCell
            code={code} date={d.dateStr} workerId={worker.id}
            templates={templates}
            isPast={d.isPast}
            swapMode={swapMode} swapSource={swapSource}
            onSelect={c => setShift(worker.id, d.dateStr, c)}
            onSwapClick={handleSwapClick}
            isOpen={openCellKey === cellKey}
            onToggle={(open) => setOpenCellKey(open ? cellKey : null)}
          />
        </td>
      );

      if (d.sun) {
        const ideal = weekH >= 36 && weekH <= 42;
        const over  = weekH > 42;
        const cls   = weekH === 0 ? 'empty' : ideal ? 'ok' : over ? 'danger' : 'warning';
        const pastTotStyle = d.isPast ? { opacity: 0.4 } : {};
        cells.push(
          <td key={`tot-${worker.id}-${d.dateStr}`}
            style={{ background: d.isPast ? 'rgba(10,16,27,0.3)' : 'rgba(30,41,59,0.35)',
              borderLeft:'1px solid var(--border-color)',
              textAlign:'center', verticalAlign:'middle', padding:'10px 14px', ...pastTotStyle }}>
            <span className={`total-hours ${cls}`}>{weekH}h</span>
            <div style={{ fontSize:'18px', marginTop:'4px' }}>
              {weekH > 0 ? (ideal ? '✅' : over ? '❌' : '⚠️') : '–'}
            </div>
            {weekH > 0 && (
              <div className="total-bar" style={{ marginTop:'6px' }}>
                <div className={`total-bar-fill ${cls}`}
                  style={{ width:`${Math.min(100, weekH/44*100)}%` }}/>
              </div>
            )}
          </td>
        );
        weekH = 0;
      }
    });
    return cells;
  };

  return (
    <>
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">📅</span>
            <span className="logo-text">TurnosRRHH</span>
          </div>
          <span className="header-divider"/>
          <span className="branch-name">Planificación Anual Continua</span>
        </div>
        <div className="header-right">
          <button
            className={`btn ${swapMode ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => swapMode ? cancelSwap() : setSwapMode(true)}
            style={{ marginRight:'10px' }}
          >
            {swapMode ? '✖ Cancelar intercambio' : '🔄 Intercambiar turnos'}
          </button>
          <button className="btn btn-outline" onClick={() => setShowTplModal(true)} style={{ marginRight:'15px' }}>
            ⚙️ Plantillas
          </button>
          <div className="user-info">
            <div className="user-avatar">CM</div>
            <div className="user-details">
              <span className="user-name">Carlos Muñoz</span>
              <span className="user-role">RRHH Admin</span>
            </div>
          </div>
        </div>
      </header>

      <main className="main-content">
        {swapMode && (
          <div className="alert" style={{
            background: swapSource ? 'rgba(59,130,246,0.12)' : 'rgba(245,158,11,0.12)',
            border: `1px solid ${swapSource ? '#3B82F6' : '#F59E0B'}`,
            color: swapSource ? '#93C5FD' : '#FCD34D',
            marginBottom:'12px', borderRadius:'8px', padding:'10px 16px', fontSize:'13px' }}>
            {swapSource
              ? `🎯 Seleccionaste a ${INIT_WORKERS.find(w=>w.id===swapSource.workerId)?.name} en ${swapSource.date}. Ahora haz clic en el turno destino.`
              : '🔄 Modo intercambio activo — haz clic en el primer turno a intercambiar.'}
          </div>
        )}

        <div className="top-bar">
          <div className="top-bar-actions">
            <div className="status-badge published"><span className="status-dot"/>Planificación</div>
            <div style={{ display:'flex', gap:'16px', alignItems:'center', fontSize:'12px', color:'#94A3B8' }}>
              <span>Días semanales: <strong style={{color:'#F1F5F9'}}>6 máx</strong></span>
              <span style={{ color:'#334155' }}>|</span>
              <span>Mínimo hrs semanales: <strong style={{color:'#10B981'}}>36 hrs ✅</strong></span>
              <span style={{ color:'#334155' }}>|</span>
              <span>Máximo hrs semanales: <strong style={{color:'#EF4444'}}>42 hrs ❌</strong></span>
            </div>
          </div>
        </div>

        <div className="action-bar">
          <div className="action-bar-left">
            <button className="btn btn-secondary" onClick={scrollToToday} style={{ background:'rgba(59,130,246,0.1)', borderColor:'#3B82F6', color:'#93C5FD' }}>📍 Ir a Hoy</button>
            <button className="btn btn-secondary" onClick={handleCopyMonth}>📋 Copiar 4 Sem. Anteriores</button>
            <button className="btn btn-secondary" onClick={() => {
              if (confirm('¿Limpiar todos los turnos futuros asignados?')) {
                setSchedules(prev => {
                  const next = {};
                  INIT_WORKERS.forEach(w => {
                    next[w.id] = {};
                    DAYS.filter(d => d.isPast).forEach(d => { next[w.id][d.dateStr] = prev[w.id]?.[d.dateStr]; });
                  });
                  return next;
                });
              }
            }}>🗑️ Limpiar futuro</button>
          </div>
          {/* FIX 3: Removed useless assignments counter — action-bar-right intentionally empty */}
        </div>

        <div ref={tableWrapperRef} className="table-wrapper"
          style={{ overflowX:'auto', maxWidth:'100%', height:'auto',
            maxHeight:'calc(100vh - 220px)', background:'#0F172A', position:'relative', zIndex:1 }}>
          <table className="schedule-table"
            style={{ borderCollapse:'separate', borderSpacing:0, width:'max-content' }}>
            <thead><tr>{header()}</tr></thead>
            <tbody>
              {INIT_WORKERS.map(w => <tr key={w.id}>{workerRow(w)}</tr>)}
            </tbody>
          </table>
        </div>

        <div className="bottom-actions" style={{ marginTop:'16px' }}>
          <div className="bottom-buttons">
            <button className="btn btn-outline">Guardar borrador</button>
            {/* FIX 5: Renamed button */}
            <button className="btn btn-primary">💾 Guardar Turnos</button>
          </div>
        </div>
      </main>

      {showTplModal && (
        <TplModal
          templates={templates}
          setTemplates={setTemplates}
          onClose={() => setShowTplModal(false)}
        />
      )}
    </>
  );
}
