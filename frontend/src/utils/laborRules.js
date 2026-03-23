/**
 * Labor rules validation utilities.
 * Rules are loaded from the API on mount and passed as a `rules` object.
 *
 * Expected `rules` shape (from GET /api/schedules/labor-rules):
 * [{ rule_code, rule_value, description }, ...]
 */

export function parseRules(rulesArray = []) {
  const map = {};
  rulesArray.forEach(r => { map[r.rule_code] = r.rule_value; });
  return {
    MAX_WEEKLY: map['MAX_WEEKLY_HOURS'] ?? 42,
    MIN_WEEKLY: map['MIN_WEEKLY_HOURS'] ?? 36,
    MAX_CONSECUTIVE: map['MAX_CONSECUTIVE_DAYS'] ?? 6,
    MIN_FREE_SUNDAYS: map['MIN_FREE_SUNDAYS'] ?? 2,
    MAX_OVERTIME_DAILY: map['MAX_OVERTIME_DAILY_HOURS'] ?? 2,
    OVERTIME_THRESHOLD: map['OVERTIME_THRESHOLD'] ?? 42,
  };
}

/**
 * Classify weekly hours into a visual status.
 * Returns: { cls: 'ok'|'warning'|'danger'|'overtime'|'empty', label, emoji }
 */
export function classifyWeeklyHours(hours, rules) {
  const { MAX_WEEKLY, MIN_WEEKLY, OVERTIME_THRESHOLD } = rules;
  if (hours === 0) return { cls: 'empty', label: '—', emoji: '—' };
  if (hours < MIN_WEEKLY) return { cls: 'danger', label: `${hours}h`, emoji: '🔴' };
  if (hours <= OVERTIME_THRESHOLD) return { cls: 'ok', label: `${hours}h`, emoji: '✅' };
  if (hours <= MAX_WEEKLY) return { cls: 'overtime', label: `${hours}h ⏱`, emoji: '🟡' };
  return { cls: 'danger', label: `${hours}h`, emoji: '❌' };
}

/**
 * Check if a date is a locked day (7th consecutive or Sunday lock).
 * The backend enforces this on save, but the frontend uses it to show 🔒 immediately.
 */
export function isAutoLocked(dateStr, schedMap, rules) {
  const { MAX_CONSECUTIVE, MIN_FREE_SUNDAYS } = rules;
  const d = new Date(dateStr + 'T12:00:00');

  // Check consecutive — look back MAX_CONSECUTIVE days
  let consecutive = 0;
  for (let i = 1; i <= MAX_CONSECUTIVE; i++) {
    const prev = new Date(d);
    prev.setDate(d.getDate() - i);
    const prevStr = prev.toISOString().split('T')[0];
    const entry = schedMap[prevStr];
    if (entry && !entry.is_day_off && !entry.isEmpty) {
      consecutive++;
    } else {
      break;
    }
  }
  if (consecutive >= MAX_CONSECUTIVE) return true;

  // Check Sunday rule
  if (d.getDay() === 0) {
    const year = d.getFullYear(), month = d.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let workedSundays = 0;
    for (let day = firstDay; day <= d; day.setDate(day.getDate() + 1)) {
      if (day.getDay() === 0 && day < d) {
        const str = day.toISOString().split('T')[0];
        const entry = schedMap[str];
        if (entry && !entry.is_day_off && !entry.isEmpty) workedSundays++;
      }
    }
    if (workedSundays >= MIN_FREE_SUNDAYS) return true;
  }

  return false;
}

export const COLORS = {
  ok: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  overtime: '#F59E0B',
  empty: '#475569',
};
