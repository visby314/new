// 端末の記録と GitHub の記録を合わせる（画面に触らない）
// 古いアプリ（kirocker2・checkiiii・oresamatenbuyer）と同じ決まりで合わせ、ファイルの形も同じにする
import { T0 } from './util.js';

const newest = (xs, key = 'updatedAt') => {
  const m = new Map();
  for (const x of xs) { if (!x || x.id == null) continue; const y = m.get(x.id); if (!y || (x[key] || '') > (y[key] || '')) m.set(x.id, x); }
  return [...m.values()];
};
// 決まったキーを決まった順に並べ、知らないキーは後ろに残す
function ordered(known, ...srcs) {
  const out = Object.assign({}, known);
  for (const s of srcs) for (const k of Object.keys(s || {})) if (!(k in out)) out[k] = s[k];
  return out;
}

// ---------- records/study-log.json ----------
export const DEFAULT_SUBJ = [
  {id: 'sugaku', name: '数学', color: '#1d4ed8'}, {id: 'butsuri', name: '物理', color: '#15803d'}, {id: 'kagaku', name: '化学', color: '#c2410c'},
  {id: 'eigo', name: '英語', color: '#7c3aed'}, {id: 'kokugo', name: '国語', color: '#b42318'}, {id: 'kyote', name: '共テ', color: '#0e7490'},
  {id: 'other', name: 'その他', color: '#6b7280'},
];
export const defaultStudy = () => ({v: 1, sessions: [], subjects: JSON.parse(JSON.stringify(DEFAULT_SUBJ)), subjAt: T0, goalH: 8, goalAt: T0, plan: {start: null, end: '2027-02-25'}, planAt: T0, books: []});
export function normStudy(d) {
  const x = d && typeof d === 'object' ? d : {};
  if (!Array.isArray(x.sessions)) x.sessions = [];
  if (!Array.isArray(x.subjects) || !x.subjects.length) { x.subjects = JSON.parse(JSON.stringify(DEFAULT_SUBJ)); x.subjAt = x.subjAt || T0; }
  if (!Array.isArray(x.books)) x.books = [];
  x.books.forEach(b => { if (!Array.isArray(b.log)) b.log = []; });
  if (!x.plan) x.plan = {start: null, end: '2027-02-25'};
  x.subjAt = x.subjAt || T0; x.goalAt = x.goalAt || T0; x.planAt = x.planAt || T0;
  if (x.goalH == null) x.goalH = 8;
  x.v = 1;
  return x;
}
export function mergeStudy(a, b) {
  a = normStudy(a);
  if (!b) return a;
  b = normStudy(b);
  const sessions = newest([...a.sessions, ...b.sessions]).sort((x, y) => x.start < y.start ? -1 : x.start > y.start ? 1 : (x.id < y.id ? -1 : 1));
  const ws = b.subjAt > a.subjAt ? b : a;
  const wg = b.goalAt > a.goalAt ? b : a;
  const wp = (b.planAt || T0) > (a.planAt || T0) ? b : a;
  const books = newest([...a.books, ...b.books]).sort((x, y) => x.id < y.id ? -1 : 1);
  return ordered({v: 1, sessions, subjects: ws.subjects, subjAt: ws.subjAt, goalH: wg.goalH, goalAt: wg.goalAt,
    plan: wp.plan || {start: null, end: '2027-02-25'}, planAt: wp.planAt || T0, books}, b, a);
}

// ---------- records/scores.json ----------
export function normScores(d, defaultExams) {
  const x = d && typeof d === 'object' ? d : {};
  if (!Array.isArray(x.attempts)) x.attempts = [];
  if (!Array.isArray(x.exams)) { x.exams = JSON.parse(JSON.stringify(defaultExams || [])); x.examsAt = T0; }
  x.examsAt = x.examsAt || T0; x.rateAt = x.rateAt || T0;
  if (x.kyoteRate == null) x.kyoteRate = 90;
  if (x.examsVer == null) x.examsVer = 1;
  x.v = 1;
  return x;
}
export function mergeScores(a, b) {
  if (!b) return a;
  const attempts = newest([...a.attempts, ...(b.attempts || [])]).sort((x, y) => x.id < y.id ? -1 : 1);
  const w = (b.examsAt || T0) > (a.examsAt || T0) ? b : a;
  const r = (b.rateAt || T0) > (a.rateAt || T0) ? b : a;
  return ordered({v: 1, attempts, exams: w.exams, examsAt: w.examsAt || T0, examsVer: w.examsVer || 1, kyoteRate: r.kyoteRate, rateAt: r.rateAt || T0}, b, a);
}

// ---------- records/kouza.json（items だけを合わせる。summary は書き出すときに作る） ----------
export function mergeKouzaItems(a, b) {
  const out = {};
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
  for (const k of keys) {
    const x = a && a[k], y = b && b[k];
    const w = !x ? y : !y ? x : ((y.u || '') > (x.u || '') ? y : x);
    out[k] = {b: w.b || 0, u: w.u || '2001-01-01T00:00:00.000Z', d: w.d || {}};
  }
  return out;
}

// ---------- records/timetable.json（このアプリだけが使う） ----------
export const TT_NOTE = '時間割。tables は切り替え日(from)ごとの時間割で、days の 0〜6 は 日〜土、コマは s=始まり e=終わり。marks は時間割のコマに付けた印（st: skip=やってない, run=計って記録した, none=取り消し）。やったコマは study-log.json に kind が slot の記録として入る';
export const defaultTT = () => ({v: 1, app: 'new', note: TT_NOTE, tables: [], marks: {}});
export function normTT(d) {
  const x = d && typeof d === 'object' ? d : {};
  if (!Array.isArray(x.tables)) x.tables = [];
  x.tables.forEach(t => { if (!t.days || typeof t.days !== 'object') t.days = {}; for (let i = 0; i < 7; i++) if (!Array.isArray(t.days[i])) t.days[i] = []; });
  if (!x.marks || typeof x.marks !== 'object') x.marks = {};
  x.v = 1; x.app = 'new'; x.note = TT_NOTE;
  return x;
}
export function mergeTT(a, b) {
  a = normTT(a);
  if (!b) return a;
  b = normTT(b);
  const tables = newest([...a.tables, ...b.tables]).sort((x, y) => (x.from || '') < (y.from || '') ? -1 : (x.from || '') > (y.from || '') ? 1 : (x.id < y.id ? -1 : 1));
  const marks = {};
  for (const day of [...new Set([...Object.keys(a.marks), ...Object.keys(b.marks)])].sort()) {
    const ma = a.marks[day] || {}, mb = b.marks[day] || {}, o = {};
    for (const id of [...new Set([...Object.keys(ma), ...Object.keys(mb)])].sort()) {
      const x = ma[id], y = mb[id];
      o[id] = !x ? y : !y ? x : ((y.u || '') > (x.u || '') ? y : x);
    }
    marks[day] = o;
  }
  return ordered({v: 1, app: 'new', note: TT_NOTE, tables, marks}, b, a);
}
