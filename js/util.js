// 共通の小道具（画面に触らないものだけ）
export const DAY_START_H = 4; // 朝4時で日付を区切る（勉強時間アプリと同じ）
export const T0 = '1970-01-01T00:00:00.000Z';
export const WD = '日月火水木金土';

export const pad = n => String(n).padStart(2, '0');
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
export const nowISO = () => new Date().toISOString();
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const clone = x => JSON.parse(JSON.stringify(x));

// ---- 日付（"2026-11-11" の形。朝4時区切り） ----
export const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dayKey = ms => dateKey(new Date(ms - DAY_START_H * 3600000));
export const todayKey = () => dayKey(Date.now());
export const keyDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const shiftDay = (k, n) => { const d = keyDate(k); d.setDate(d.getDate() + n); return dateKey(d); };
export const daysBetween = (a, b) => Math.round((keyDate(b) - keyDate(a)) / 86400000);
export const weekdayIdx = k => keyDate(k).getDay(); // 0=日
export const weekday = k => WD[weekdayIdx(k)];
export const md = k => `${+k.slice(5, 7)}/${+k.slice(8)}`;

// ---- 時間の表し方 ----
export const hm = ms => { const d = new Date(ms); return `${d.getHours()}:${pad(d.getMinutes())}`; };
export const dur = sec => { const m = Math.round(sec / 60); const h = Math.floor(m / 60); return h ? `${h}時間${m % 60 ? (m % 60) + '分' : ''}` : `${m}分`; };
export const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`; };
export const fmtH = sec => (Math.round(sec / 360) / 10).toString();
export const fmtN = n => (Math.round(n * 10) / 10).toString();
export const pct = (a, b) => b ? Math.round(a * 1000 / b) / 10 : 0;

// ---- 時間割の時刻（"05:30"）を、その勉強日の時刻(ms)にする。4時より前は次の日の夜中 ----
export const hmToMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
export const minToHm = n => { n = ((Math.round(n) % 1440) + 1440) % 1440; return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`; };
export function slotMs(dayK, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = keyDate(dayK); d.setHours(h, m || 0, 0, 0);
  let t = d.getTime(); if (h < DAY_START_H) t += 86400000;
  return t;
}
export function slotRange(dayK, s, e) {
  const a = slotMs(dayK, s); let b = slotMs(dayK, e);
  if (b <= a) b += 86400000;
  return [a, b];
}
// 1日の中の並び順（4時を先頭にする）
export const dayOrder = hhmm => (hmToMin(hhmm) - DAY_START_H * 60 + 1440) % 1440;

// ---- 文字列を GitHub に送る形に ----
export const enc = t => btoa(unescape(encodeURIComponent(t)));
export const dec = b => decodeURIComponent(escape(atob(String(b).replace(/\n/g, ''))));
