import { useState, useEffect, useRef, useCallback } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useAuth } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import api from './api/client'
import { parseRules, classifyWeeklyHours, isAutoLocked } from './utils/laborRules'
import './index.css'

// ─── Helpers ───────────────────────────────────────────────────
const calcHours = (start, end) => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let d = (eh + em / 60) - (sh + sm / 60);
  if (d < 0) d += 24;
  return Math.round(d * 10) / 10;
};

const getMonday = (d) => {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
};

const toDateStr = (d) => d.toISOString().split('T')[0];

const genWeekDays = (mondayDate) => {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayDate);
    d.setDate(mondayDate.getDate() + i);
    days.push({
      dateStr: toDateStr(d),
      day: d.getDate(),
      dayName: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getDay()],
      mon: d.toLocaleString('es-ES', { month: 'short' }),
      isSun: d.getDay() === 0,
    });
  }
  return days;
};

// ─── Protected Route ────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ color: '#94A3B8', padding: '40px', textAlign: 'center' }}>Cargando...</div>;
  return user ? children : <Navigate to="/login" replace />;
}

// ─── Portal Dropdown ────────────────────────────────────────────
const PortalDropdown = ({ open, rect, templates, code, onSelect, onClose }) => {
  if (!open || !rect) return null;
  const spaceBelow = window.innerHeight - rect.bottom;
  const flip = spaceBelow < 300 && rect.top > 300;
  const rawLeft = rect.left + rect.width / 2;
  const safeLeft = Math.max(rawLeft, 220);
  const style = {
    position: 'fixed', left: safeLeft,
    transform: flip ? 'translate(-50%, -100%)' : 'translateX(-50%)',
    top: flip ? rect.top - 4 : rect.bottom + 4,
    zIndex: 9999, background: '#1E293B', border: '1px solid #334155',
    borderRadius: '8px', padding: '6px',
    boxShadow: '0 14px 28px rgba(0,0,0,.55)', minWidth: '175px',
    maxHeight: '280px', overflowY: 'auto',
  };
  return createPortal(
    <div data-portal-dropdown="true" onClick={e => e.stopPropagation()} style={style}>
      <div className="dropdown-item clear" onClick={() => { onSelect(null); onClose(); }}>
        <span>🗑️ Borrar turno</span>
      </div>
      <div className="dropdown-item" style={{ color: '#94A3B8' }}
        onClick={() => { onSelect('__OFF__'); onClose(); }}>
        <span>🛌 Día Libre</span>
      </div>
      <div className="dropdown-divider" />
      {templates.map(t => {
        const h = calcHours(t.start_time, t.end_time);
        return (
          <div key={t.id} className="dropdown-item"
            onClick={() => { onSelect(t); onClose(); }}
            style={{ background: code === t.code ? 'rgba(255,255,255,0.07)' : undefined, borderRadius: '6px' }}>
            <div className="dropdown-color" style={{ background: t.color }} />
            <div style={{ flex: 1 }}>
              <span style={{ color: t.color, fontWeight: 'bold', fontSize: '13px' }}>{t.code}</span>
              <div style={{ fontSize: '10px', color: '#64748B' }}>{t.start_time}–{t.end_time}</div>
            </div>
            <span className="dropdown-item-hours">{h}h</span>
          </div>
        );
      })}
    </div>,
    document.body
  );
};

// ─── Shift Cell ─────────────────────────────────────────────────
const ShiftCell = ({ entry, dateStr, workerId, templates, rules, schedMap, swapMode, swapSource, onSelect, onSwapClick, isOpen, onToggle }) => {
  const [rect, setRect] = useState(null);
  const ref = useRef(null);
  const isLocked = entry?.is_locked || isAutoLocked(dateStr, schedMap, rules);
  const isDayOff = entry?.is_day_off;
  const template = entry?.shift_template ? templates.find(t => t.id === entry.shift_template.id) : null;
  const h = template ? calcHours(template.start_time, template.end_time) : 0;
  const isSource = swapSource?.workerId === workerId && swapSource?.date === dateStr;
  const isTarget = swapMode && swapSource && !isSource;

  useEffect(() => {
    if (!isOpen) return;
    const close = (e) => {
      if (!e.target.closest('.shift-selector') && !e.target.closest('[data-portal-dropdown]')) onToggle(false);
    };
    const scroll = (e) => { if (!e.target.closest('[data-portal-dropdown]')) onToggle(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', scroll, true); };
  }, [isOpen, onToggle]);

  const handleClick = () => {
    if (isLocked) return;
    if (swapMode) { onSwapClick(workerId, dateStr); return; }
    if (ref.current && !isOpen) setRect(ref.current.getBoundingClientRect());
    onToggle(!isOpen);
  };

  let extraStyle = {};
  if (isSource) extraStyle = { boxShadow: '0 0 0 2px #F59E0B', borderColor: '#F59E0B', background: 'rgba(245,158,11,0.12)' };
  if (isTarget) extraStyle = { boxShadow: '0 0 0 2px #3B82F6', borderColor: '#3B82F6', background: 'rgba(59,130,246,0.10)', cursor: 'crosshair' };
  const lockedStyle = isLocked ? { opacity: 0.6, cursor: 'not-allowed', background: 'rgba(124,58,237,0.08)' } : {};

  return (
    <div ref={ref} style={{ display: 'block' }}>
      <button type="button" onClick={handleClick}
        className={`shift-btn ${template ? 'has-shift' : isDayOff ? 'day-off' : ''}`}
        style={{ '--shift-color': template?.color, ...extraStyle, ...lockedStyle, minHeight: '64px', width: '100%' }}>
        {isLocked && <span style={{ position: 'absolute', top: '3px', right: '4px', fontSize: '10px', color: '#7C3AED' }}>🔒</span>}
        {template ? (
          <>
            <span className="shift-code">{template.code}</span>
            <span style={{ fontSize: '10px', color: template.color, opacity: 0.85, marginTop: '2px' }}>{template.start_time}–{template.end_time}</span>
            <span className="shift-hours-label">{h}h</span>
          </>
        ) : isDayOff || isLocked ? (
          <>
            <span style={{ fontSize: '16px' }}>🛌</span>
            <span className="shift-dayoff-label">{isLocked ? 'Libre 🔒' : 'Libre'}</span>
          </>
        ) : (
          <span className="shift-empty" style={{ fontSize: '24px' }}>+</span>
        )}
      </button>
      {!isLocked && (
        <PortalDropdown open={isOpen} rect={rect} templates={templates} code={template?.code}
          onSelect={onSelect} onClose={() => onToggle(false)} />
      )}
    </div>
  );
};

// ─── Main Schedule Dashboard ────────────────────────────────────
function ScheduleDashboard() {
  const { user, logout, currentBranch, currentBranchId, switchBranch } = useAuth();
  const tableRef = useRef(null);

  const [weekMonday, setWeekMonday] = useState(() => getMonday(new Date()));
  const [templates, setTemplates] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [scheduleData, setScheduleData] = useState({ workers: [] });
  const [rules, setRules] = useState(parseRules([]));
  const [weeklyStatus, setWeeklyStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [openCellKey, setOpenCellKey] = useState(null);
  const [swapMode, setSwapMode] = useState(false);
  const [swapSource, setSwapSource] = useState(null);
  // Local draft: { workerId: { dateStr: { template, is_day_off } } }
  const [draft, setDraft] = useState({});

  const days = genWeekDays(weekMonday);
  const weekStartStr = toDateStr(weekMonday);
  const weekEndStr = toDateStr(days[6].date || new Date(weekMonday.getTime() + 6 * 86400000));

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load data on branch/week change
  const loadData = useCallback(async () => {
    if (!currentBranchId) return;
    setLoading(true);
    try {
      const [tplRes, wRes, schRes, rulesRes] = await Promise.all([
        api.templates.list({ branch_id: currentBranchId, is_active: true }),
        api.workers.list({ branch_id: currentBranchId, is_active: true }),
        api.schedules.get({ branch_id: currentBranchId, week_start: weekStartStr }),
        api.schedules.laborRules(),
      ]);
      setTemplates(tplRes);
      setWorkers(wRes);
      setScheduleData(schRes.data || { workers: [] });
      setRules(parseRules(rulesRes));
      // Build draft from API data
      const newDraft = {};
      (schRes.data?.workers || []).forEach(w => {
        newDraft[w.worker_id] = {};
        Object.entries(w.days || {}).forEach(([date, day]) => {
          newDraft[w.worker_id][date] = day;
        });
      });
      setDraft(newDraft);
      // Weekly status
      const statusRes = await api.status.branch(currentBranchId, { week_start: weekStartStr });
      setWeeklyStatus(statusRes.publish_status || 'pending');
    } catch (err) {
      showToast(`Error al cargar: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [currentBranchId, weekStartStr]);

  useEffect(() => { loadData(); }, [loadData]);

  // Build a flat schedMap for a worker (for rule checks)
  const getSchedMap = (workerId) => draft[workerId] || {};

  const setShift = (workerId, dateStr, value) => {
    setDraft(prev => {
      const workerDraft = { ...(prev[workerId] || {}) };
      if (value === null) {
        delete workerDraft[dateStr];
      } else if (value === '__OFF__') {
        workerDraft[dateStr] = { is_day_off: true, shift_template: null, total_hours: 0 };
      } else {
        workerDraft[dateStr] = {
          is_day_off: false,
          is_locked: false,
          shift_template: { id: value.id, code: value.code, name: value.name },
          total_hours: calcHours(value.start_time, value.end_time),
        };
      }
      return { ...prev, [workerId]: workerDraft };
    });
  };

  const handleSave = async () => {
    if (!currentBranchId) return;
    setSaving(true);
    try {
      const entries = [];
      Object.entries(draft).forEach(([workerId, days]) => {
        Object.entries(days).forEach(([dateStr, day]) => {
          entries.push({
            worker_id: parseInt(workerId),
            date: dateStr,
            shift_template_id: day.shift_template?.id || null,
            is_day_off: day.is_day_off || false,
            notes: day.notes || null,
          });
        });
      });
      const res = await api.schedules.bulk({
        branch_id: currentBranchId,
        week_start: weekStartStr,
        schedules: entries,
      });
      const warnings = res.warnings?.length ? `\n⚠️ ${res.warnings.join(', ')}` : '';
      showToast(`${res.message}${warnings}`, res.warnings?.length ? 'warning' : 'success');
      await loadData();
    } catch (err) {
      showToast(`Error al guardar: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!confirm('¿Publicar semana? Los jefes recibirán los horarios.')) return;
    try {
      const res = await api.schedules.publish({ branch_id: currentBranchId, week_start: weekStartStr });
      showToast(res.message);
      setWeeklyStatus('published');
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleCopyPrevWeek = async () => {
    const prevMonday = new Date(weekMonday);
    prevMonday.setDate(weekMonday.getDate() - 7);
    if (!confirm(`¿Copiar semana ${toDateStr(prevMonday)} a esta semana?`)) return;
    try {
      const res = await api.schedules.copyWeek({
        branch_id: currentBranchId,
        source_week: toDateStr(prevMonday),
        target_week: weekStartStr,
      });
      showToast(res.message);
      await loadData();
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleSwapClick = (workerId, dateStr) => {
    if (!swapSource) {
      setSwapSource({ workerId, date: dateStr });
    } else {
      api.schedules.swap({
        swap_a: { worker_id: swapSource.workerId, date: swapSource.date },
        swap_b: { worker_id: workerId, date: dateStr },
      }).then(res => {
        showToast(res.message);
        loadData();
      }).catch(err => showToast(`Error: ${err.message}`, 'error'));
      setSwapSource(null);
      setSwapMode(false);
    }
  };

  const handleExcelExport = () => {
    api.export.excel({ branch_id: currentBranchId, week_start: weekStartStr })
      .catch(err => showToast(`Error exportando: ${err.message}`, 'error'));
  };

  const navigateWeek = (dir) => {
    const next = new Date(weekMonday);
    next.setDate(weekMonday.getDate() + dir * 7);
    setWeekMonday(next);
    setDraft({});
  };

  // Header columns
  const headerCols = [
    <th key="worker" className="col-worker"
      style={{ position: 'sticky', left: 0, zIndex: 60, background: '#0F172A', minWidth: '160px', borderRight: '1px solid var(--border-color)' }}>
      Trabajador
    </th>,
    ...days.map(d => (
      <th key={d.dateStr} data-date={d.dateStr} className={`col-day ${d.isSun ? 'col-sunday' : ''}`}
        style={{ minWidth: '100px' }}>
        <span className="day-name">{d.dayName}</span>
        <span className="day-date">{d.day} {d.mon}</span>
      </th>
    )),
    <th key="total" className="col-total"
      style={{ background: '#1E293B', borderLeft: '1px solid var(--border-color)', minWidth: '90px', fontSize: '11px' }}>
      TOTAL
    </th>,
  ];

  // Worker row
  const renderWorkerRow = (worker) => {
    const workerDraft = draft[worker.worker_id] || {};
    const schedMap = workerDraft;
    let totalHours = 0;

    const cells = [
      <td key="name" className="worker-cell"
        style={{ position: 'sticky', left: 0, zIndex: 40, background: '#0F172A', borderRight: '1px solid var(--border-color)' }}>
        <div className="worker-name">{worker.name}</div>
        <div className="worker-rut">{worker.rut}</div>
      </td>,
    ];

    days.forEach(d => {
      const entry = workerDraft[d.dateStr];
      const h = entry?.total_hours || 0;
      if (!entry?.is_day_off) totalHours += h;
      const cellKey = `${worker.worker_id}-${d.dateStr}`;
      cells.push(
        <td key={d.dateStr} className={`shift-cell ${d.isSun ? 'sunday-col' : ''}`} style={{ padding: '6px' }}>
          <ShiftCell
            entry={entry} dateStr={d.dateStr} workerId={worker.worker_id}
            templates={templates} rules={rules} schedMap={schedMap}
            swapMode={swapMode} swapSource={swapSource}
            onSelect={val => setShift(worker.worker_id, d.dateStr, val)}
            onSwapClick={handleSwapClick}
            isOpen={openCellKey === cellKey}
            onToggle={open => setOpenCellKey(open ? cellKey : null)}
          />
        </td>
      );
    });

    const status = classifyWeeklyHours(totalHours, rules);
    const colorMap = { ok: '#10B981', danger: '#EF4444', overtime: '#F59E0B', empty: '#475569', warning: '#F59E0B' };
    cells.push(
      <td key="total"
        style={{ background: 'rgba(30,41,59,0.35)', borderLeft: '1px solid var(--border-color)', textAlign: 'center', verticalAlign: 'middle', padding: '10px 14px' }}>
        <span className={`total-hours ${status.cls}`}>{status.label}</span>
        <div style={{ fontSize: '16px', marginTop: '4px' }}>{status.emoji}</div>
        {totalHours > 0 && (
          <div className="total-bar" style={{ marginTop: '6px' }}>
            <div className={`total-bar-fill ${status.cls}`}
              style={{ width: `${Math.min(100, totalHours / rules.MAX_WEEKLY * 100)}%`, background: colorMap[status.cls] }} />
          </div>
        )}
      </td>
    );

    return cells;
  };

  const statusColors = { pending: '#94A3B8', draft: '#F59E0B', published: '#10B981' };
  const statusLabels = { pending: 'Sin turnos', draft: 'Borrador', published: 'Publicado' };

  return (
    <>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 99999,
          background: toast.type === 'error' ? '#EF4444' : toast.type === 'warning' ? '#F59E0B' : '#10B981',
          color: '#fff', padding: '12px 20px', borderRadius: '10px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', fontSize: '13px', fontWeight: 600,
          maxWidth: '360px', animation: 'fadeIn 0.2s ease',
        }}>
          {toast.msg}
        </div>
      )}

      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">📅</span>
            <span className="logo-text">TurnosRRHH</span>
          </div>
          <span className="header-divider" />
          {/* Branch selector */}
          {user?.branches?.length > 1 ? (
            <select
              value={currentBranchId || ''}
              onChange={e => switchBranch(parseInt(e.target.value))}
              style={{ background: '#1E293B', border: '1px solid #334155', color: '#F1F5F9', borderRadius: '8px', padding: '6px 10px', fontSize: '13px', cursor: 'pointer' }}>
              {user.branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          ) : (
            <span className="branch-name">{currentBranch?.name || '—'}</span>
          )}
        </div>
        <div className="header-right">
          <button className={`btn ${swapMode ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { swapMode ? (setSwapMode(false), setSwapSource(null)) : setSwapMode(true); }}
            style={{ marginRight: '10px' }}>
            {swapMode ? '✖ Cancelar intercambio' : '🔄 Intercambiar turnos'}
          </button>
          <button className="btn btn-outline" onClick={handleExcelExport} style={{ marginRight: '10px' }}>
            📥 Exportar Excel
          </button>
          <div className="user-info" style={{ cursor: 'pointer' }} onClick={logout}>
            <div className="user-avatar">{user?.first_name?.[0]}{user?.last_name?.[0]}</div>
            <div className="user-details">
              <span className="user-name">{user?.first_name} {user?.last_name}</span>
              <span className="user-role">{user?.role === 'admin' ? 'Admin RRHH' : 'Jefe Sucursal'}</span>
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
            marginBottom: '12px', borderRadius: '8px', padding: '10px 16px', fontSize: '13px',
          }}>
            {swapSource
              ? `🎯 Seleccionaste ${swapSource.date}. Haz clic en el turno destino.`
              : '🔄 Modo intercambio — haz clic en el primer turno a intercambiar.'}
          </div>
        )}

        {/* Week navigation + status bar */}
        <div className="top-bar">
          <div className="top-bar-actions">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button className="btn btn-outline" onClick={() => navigateWeek(-1)}>‹ Anterior</button>
              <span style={{ color: '#F1F5F9', fontWeight: 600, fontSize: '14px' }}>
                {days[0]?.day} {days[0]?.mon} – {days[6]?.day} {days[6]?.mon}
              </span>
              <button className="btn btn-outline" onClick={() => navigateWeek(1)}>Siguiente ›</button>
              <button className="btn btn-outline"
                onClick={() => { setWeekMonday(getMonday(new Date())); setDraft({}); }}
                style={{ background: 'rgba(59,130,246,0.1)', borderColor: '#3B82F6', color: '#93C5FD' }}>
                📍 Hoy
              </button>
            </div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '12px', color: '#94A3B8' }}>
              <span>Estado: <strong style={{ color: statusColors[weeklyStatus] }}>{statusLabels[weeklyStatus]}</strong></span>
              <span style={{ color: '#334155' }}>|</span>
              <span>Rango OK: <strong style={{ color: '#10B981' }}>{rules.MIN_WEEKLY}-{rules.MAX_WEEKLY}h ✅</strong></span>
              <span style={{ color: '#334155' }}>|</span>
              <span>Extra hasta: <strong style={{ color: '#F59E0B' }}>{rules.MAX_WEEKLY + rules.MAX_OVERTIME_DAILY}h</strong></span>
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div className="action-bar">
          <div className="action-bar-left">
            <button className="btn btn-secondary" onClick={handleCopyPrevWeek}>📋 Copiar semana anterior</button>
            <button className="btn btn-secondary" onClick={() => { if (confirm('¿Limpiar todos los turnos del borrador?')) setDraft({}); }}>
              🗑️ Limpiar borrador
            </button>
          </div>
        </div>

        {/* Schedule grid */}
        {loading ? (
          <div style={{ color: '#94A3B8', textAlign: 'center', padding: '60px', fontSize: '15px' }}>
            ⏳ Cargando horarios...
          </div>
        ) : (
          <div ref={tableRef} className="table-wrapper"
            style={{ overflowX: 'auto', maxWidth: '100%', maxHeight: 'calc(100vh - 240px)', background: '#0F172A', position: 'relative', zIndex: 1 }}>
            <table className="schedule-table" style={{ borderCollapse: 'separate', borderSpacing: 0, width: 'max-content' }}>
              <thead><tr>{headerCols}</tr></thead>
              <tbody>
                {workers.length === 0 ? (
                  <tr><td colSpan={days.length + 2} style={{ textAlign: 'center', color: '#475569', padding: '40px' }}>
                    No hay trabajadores en esta sucursal. Agrega trabajadores primero.
                  </td></tr>
                ) : workers.map(w => (
                  <tr key={w.id}>
                    {renderWorkerRow({ worker_id: w.id, name: `${w.first_name} ${w.last_name}`, rut: w.rut })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Bottom actions */}
        <div className="bottom-actions" style={{ marginTop: '16px' }}>
          <div className="bottom-buttons">
            <button className="btn btn-outline" onClick={handleSave} disabled={saving}>
              {saving ? '⏳ Guardando...' : '💾 Guardar Borrador'}
            </button>
            <button className="btn btn-primary" onClick={handlePublish}
              disabled={weeklyStatus === 'published' || saving}>
              {weeklyStatus === 'published' ? '✅ Publicado' : '🚀 Publicar Semana'}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}

// ─── Root App ───────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={
        <ProtectedRoute>
          <ScheduleDashboard />
        </ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
