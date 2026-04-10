/**
 * API Client — TurnosRRHH
 * Centralized HTTP client with JWT auto-refresh and error handling.
 */

// In production (served via nginx), use same-origin so /api/* goes through the proxy.
// In local dev, fall back to http://localhost:8010.
const BASE_URL = import.meta.env.VITE_API_URL
  || (window.location.hostname === 'localhost' ? 'http://localhost:8010' : '');

// ── Token storage ──────────────────────────────────────────────
export const storage = {
  get: (key) => localStorage.getItem(key),
  set: (key, val) => localStorage.setItem(key, val),
  del: (key) => localStorage.removeItem(key),
  clear: () => ['access_token', 'refresh_token', 'user'].forEach(k => localStorage.removeItem(k)),
};

// ── Core fetch with JWT ────────────────────────────────────────
let isRefreshing = false;
let refreshQueue = [];

async function fetchWithAuth(path, options = {}) {
  const token = storage.get('access_token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401 && !options._retry) {
    // Try auto-refresh
    if (!isRefreshing) {
      isRefreshing = true;
      const refreshToken = storage.get('refresh_token');
      try {
        const rr = await fetch(`${BASE_URL}/api/auth/refresh?refresh=${refreshToken}`, { method: 'POST' });
        if (rr.ok) {
          const data = await rr.json();
          storage.set('access_token', data.access_token);
          storage.set('refresh_token', data.refresh_token);
          isRefreshing = false;
          refreshQueue.forEach(cb => cb(data.access_token));
          refreshQueue = [];
          return fetchWithAuth(path, { ...options, _retry: true });
        }
      } catch {}
      isRefreshing = false;
      storage.clear();
      window.location.href = '/login';
      return;
    }

    return new Promise(resolve => {
      refreshQueue.push(token => resolve(fetchWithAuth(path, { ...options, _retry: true })));
    });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || 'Error desconocido');
  }

  // Handle file downloads
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/vnd.openxml') || contentType.includes('octet-stream')) {
    return res.blob();
  }

  return res.json();
}

// ── Auth ───────────────────────────────────────────────────────
export const api = {
  auth: {
    login: (rut, password) =>
      fetchWithAuth('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ rut, password }),
      }),
    me: () => fetchWithAuth('/api/auth/me'),
  },

  // ── Users ──────────────────────────────────────────────────
  users: {
    list: (params = {}) => fetchWithAuth('/api/users?' + new URLSearchParams(params)),
    create: (data) => fetchWithAuth('/api/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => fetchWithAuth(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deactivate: (id) => fetchWithAuth(`/api/users/${id}`, { method: 'DELETE' }),
    resetPassword: (id) => fetchWithAuth(`/api/users/${id}/reset-password`, { method: 'POST' }),
  },

  // ── Branches ───────────────────────────────────────────────
  branches: {
    list: (params = {}) => fetchWithAuth('/api/branches?' + new URLSearchParams(params)),
    create: (data) => fetchWithAuth('/api/branches', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => fetchWithAuth(`/api/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },

  // ── Workers ────────────────────────────────────────────────
  workers: {
    list: (params = {}) => fetchWithAuth('/api/workers?' + new URLSearchParams(params)),
    create: (data) => fetchWithAuth('/api/workers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => fetchWithAuth(`/api/workers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deactivate: (id) => fetchWithAuth(`/api/workers/${id}`, { method: 'DELETE' }),
  },

  // ── Templates ──────────────────────────────────────────────
  templates: {
    list: (params = {}) => fetchWithAuth('/api/shift-templates?' + new URLSearchParams(params)),
  },

  // ── Schedules ──────────────────────────────────────────────
  schedules: {
    get: (params = {}) => fetchWithAuth('/api/schedules?' + new URLSearchParams(params)),
    bulk: (data) => fetchWithAuth('/api/schedules/bulk', { method: 'POST', body: JSON.stringify(data) }),
    copyWeek: (data) => fetchWithAuth('/api/schedules/copy-week', { method: 'POST', body: JSON.stringify(data) }),
    publish: (data) => fetchWithAuth('/api/schedules/publish', { method: 'POST', body: JSON.stringify(data) }),
    swap: (data) => fetchWithAuth('/api/schedules/swap', { method: 'POST', body: JSON.stringify(data) }),
    laborRules: (params = {}) => fetchWithAuth('/api/schedules/labor-rules?' + new URLSearchParams(params)),
  },

  // ── Status / Query API ─────────────────────────────────────
  status: {
    completeness: (params = {}) => fetchWithAuth('/api/status/completeness?' + new URLSearchParams(params)),
    branch: (id, params = {}) => fetchWithAuth(`/api/status/branch/${id}?` + new URLSearchParams(params)),
    auditLog: (params = {}) => fetchWithAuth('/api/status/audit-log?' + new URLSearchParams(params)),
  },

  // ── Export ─────────────────────────────────────────────────
  export: {
    json: (params = {}) => fetchWithAuth('/api/export/json?' + new URLSearchParams(params)),
    excel: async (params = {}) => {
      const blob = await fetchWithAuth('/api/export/excel?' + new URLSearchParams(params));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `turnos_${params.branch_id}_${params.week_start}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    },
  },

  // ── Monthly Planner ─────────────────────────────────────────
  monthlyPlans: {
    /** Crear un nuevo plan mensual */
    create: (data) =>
      fetchWithAuth('/api/monthly-plans', { method: 'POST', body: JSON.stringify(data) }),

    /** Listar planes — filtros opcionales: branch_id, year, month */
    list: (params = {}) =>
      fetchWithAuth('/api/monthly-plans?' + new URLSearchParams(params)),

    /** Obtener plan completo con excepciones + asignaciones */
    get: (id) =>
      fetchWithAuth(`/api/monthly-plans/${id}`),

    /** Actualizar cabecera del plan */
    update: (id, data) =>
      fetchWithAuth(`/api/monthly-plans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

    /** Eliminar plan */
    delete: (id) =>
      fetchWithAuth(`/api/monthly-plans/${id}`, { method: 'DELETE' }),

    /** Agregar excepción mensual (vacaciones, licencia, etc.) */
    addException: (id, data) =>
      fetchWithAuth(`/api/monthly-plans/${id}/exceptions`, { method: 'POST', body: JSON.stringify(data) }),

    /** Eliminar excepción */
    deleteException: (id, excId) =>
      fetchWithAuth(`/api/monthly-plans/${id}/exceptions/${excId}`, { method: 'DELETE' }),

    /** Guardar asignaciones en bulk (upsert) */
    saveAssignments: (id, assignments) =>
      fetchWithAuth(`/api/monthly-plans/${id}/assignments`, {
        method: 'PUT',
        body: JSON.stringify({ assignments }),
      }),

    /** Generar propuesta automática con shift_templates reales */
    generate: (id) =>
      fetchWithAuth(`/api/monthly-plans/${id}/generate`, { method: 'POST' }),

    /** Descargar Excel formato carga (RUT + DIA1..DIA31) */
    exportExcel: async (id, filename) => {
      const blob = await fetchWithAuth(`/api/monthly-plans/${id}/export/excel`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `plan_mensual_${id}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    },
  },
};

export default api;
