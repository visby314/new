// 数える・計算する（画面に触らない）
import { dayKey, todayKey, shiftDay, daysBetween, pct } from './util.js';
import KOUZA from '../data/kouza-data.js';

// ---------- 勉強時間 ----------
export const liveSessions = study => study.sessions.filter(s => !s.deleted && s.sec > 0);
export const secOfDay = (study, key) => liveSessions(study).filter(s => dayKey(Date.parse(s.start)) === key).reduce((t, s) => t + s.sec, 0);
export function byDay(study) {
  const m = new Map();
  for (const s of liveSessions(study)) {
    const k = dayKey(Date.parse(s.start));
    let d = m.get(k); if (!d) { d = {total: 0, subj: new Map()}; m.set(k, d); }
    d.total += s.sec; d.subj.set(s.subjectId, (d.subj.get(s.subjectId) || 0) + s.sec);
  }
  return m;
}
// 締め切りまでの進み具合。期間は開始日から締め切り日の前日まで（勉強時間アプリと同じ数え方）
export function planInfo(study, today = todayKey()) {
  const plan = study.plan || {start: null, end: '2027-02-25'};
  const end = plan.end || '2027-02-25';
  const live = liveSessions(study);
  const first = live.map(s => dayKey(Date.parse(s.start))).sort()[0];
  const start = plan.start || (first && first < today ? first : today);
  const goal = (+study.goalH || 0) * 3600, total = daysBetween(start, end);
  if (!goal || total <= 0) return null;
  const inPlan = k => k >= start && k < end;
  let done = 0, doneYday = 0;
  for (const s of live) { const k = dayKey(Date.parse(s.start)); if (!inPlan(k)) continue; done += s.sec; if (k < today) doneYday += s.sec; }
  const passed = Math.max(0, Math.min(total, daysBetween(start, today)));
  const left = Math.max(0, daysBetween(today, end));
  const target = goal * total, pace = goal * passed;
  return {start, end, total, done, doneYday, passed, left, target, pace, need: left ? Math.max(0, target - done) / left : 0,
    auto: !plan.start ? (first && first < today ? 'first' : 'today') : ''};
}

// ---------- 教材ノルマ ----------
export const UNITS = ['問', 'ページ', '回', '講', '章', '題'];
export const liveBooks = study => (study.books || []).filter(b => !b.deleted);
export function bookInfo(b, today = todayKey()) {
  const log = b.log || [];
  const done = (+b.base || 0) + log.reduce((t, x) => t + x.n, 0);
  const doneToday = log.filter(x => x.d === today).reduce((t, x) => t + x.n, 0);
  const rest = Math.max(0, b.total - done), restBefore = Math.max(0, b.total - (done - doneToday));
  const daysLeft = daysBetween(today, b.deadline) + 1; // 締め切りの日も入れる
  const quota = daysLeft > 0 ? Math.ceil(restBefore / daysLeft) : restBefore;
  const todayLeft = Math.max(0, quota - doneToday);
  const week = log.filter(x => daysBetween(x.d, today) < 7).reduce((t, x) => t + x.n, 0);
  const span = Math.max(1, Math.min(7, b.created ? daysBetween(b.created, today) + 1 : 7));
  const pace = week / span;
  const eta = rest === 0 ? null : pace > 0 ? shiftDay(today, Math.ceil(rest / pace) - 1) : null;
  return {done, doneToday, rest, daysLeft, quota, todayLeft, week, pace, eta, span, finished: rest === 0, late: rest > 0 && daysLeft <= 0, slow: rest > 0 && (!eta || eta > b.deadline)};
}

// ---------- 講座 ----------
export const COURSES = [...KOUZA.science, ...KOUZA.kono];
export const COURSE = Object.fromEntries(COURSES.map(c => [c.id, c]));
export const STAGES = [{bit: 1, name: '視聴', k: 'k1', act: '見た'}, {bit: 2, name: '演習', k: 'k2', act: '演習した'}, {bit: 4, name: '復習', k: 'k3', act: '復習した'}];
export const GROUPS = [
  {name: '化学', sub: 'マナビス ハイレベル化学・演習', ids: ['kagaku']},
  {name: '物理', sub: 'マナビス ハイレベル物理・演習', ids: ['butsuri']},
  {name: '河野塾', sub: '徹底基礎講座 数A・数B・数C・数Ⅲ', ids: ['sugA', 'sugB', 'sugC', 'sug3']},
];
export const sectionsOf = c => c.chapters.flatMap(ch => ch.sections);
const flatCache = new Map();
// [{n: 通し番号, label, section}]
export function flatItems(c) {
  let v = flatCache.get(c.id);
  if (!v) { v = sectionsOf(c).flatMap(s => s.items.map((label, i) => ({n: s.start + i, label, section: s.name}))); flatCache.set(c.id, v); }
  return v;
}
export const bitOf = (items, cid, n) => (items[cid + ':' + n] || {}).b || 0;
export function countCourse(items, c, nums) {
  const r = [0, 0, 0];
  for (const n of (nums || flatItems(c).map(x => x.n))) { const b = bitOf(items, c.id, n); if (b & 1) r[0]++; if (b & 2) r[1]++; if (b & 4) r[2]++; }
  return r;
}
export const kouzaSummary = items => COURSES.map(c => { const r = countCourse(items, c); return {id: c.id, name: c.full || c.name, total: flatItems(c).length, 視聴: r[0], 演習: r[1], 復習: r[2]}; });
// 次にやる1本：視聴はまだ見ていない最初の1本、演習は見たのに解いていない最初の1本、復習は解いたのに解き直していない最初の1本
export function nextOf(items, c, bit) {
  for (const it of flatItems(c)) {
    const b = bitOf(items, c.id, it.n);
    if (b & bit) continue;
    if (bit === 1 || (bit === 2 && (b & 1)) || (bit === 4 && (b & 2))) return it;
  }
  return null;
}
// 印を付ける・外す。付けた日(d)と変えた時刻(u)も残す
export function setBit(items, cid, n, bit, on, stamp, today = todayKey()) {
  const k = cid + ':' + n;
  const x = items[k] || (items[k] = {b: 0, u: stamp, d: {}});
  const was = x.b || 0, now = on ? (was | bit) : (was & ~bit);
  if (was === now) return false;
  x.b = now; x.u = stamp; x.d = x.d || {};
  for (const s of STAGES) { if ((now & s.bit) && !(was & s.bit)) x.d[s.bit] = today; if (!(now & s.bit)) delete x.d[s.bit]; }
  return true;
}
export const marksInDays = (items, days, today = todayKey()) => {
  const r = [0, 0, 0];
  for (const x of Object.values(items)) for (let i = 0; i < 3; i++) { const d = x.d && x.d[STAGES[i].bit]; if (d && (x.b & STAGES[i].bit) && daysBetween(d, today) < days && daysBetween(d, today) >= 0) r[i]++; }
  return r;
};

// ---------- 過去問 ----------
const P = (name, max) => ({name, max});
const nParts = (n, max) => Array.from({length: n}, (_, i) => P(`第${i + 1}問`, max));
// 初めて使うときの試験と科目（得点記録アプリと同じ。満点の多くは仮で、設定で直せる）
export const DEFAULT_EXAMS = [
  {id: 'todai', name: '東大2次', note: '理科類', subjects: [
    {id: 'kokugo', name: '国語', short: '国', target: 40, prov: true, parts: [P('第1問 現代文', 40), P('第2問 古文', 20), P('第3問 漢文', 20)]},
    {id: 'sugaku', name: '数学', short: '数', target: 65, prov: true, parts: nParts(6, 20)},
    {id: 'eigo', name: '英語', short: '英', target: 75, prov: true, parts: ['1A', '1B', '2A', '2B', '3A', '3B', '3C', '4A', '4B', '5'].map(x => P(x, 12))},
    {id: 'butsuri', name: '物理', short: '物', target: 30, prov: true, parts: nParts(3, 20)},
    {id: 'kagaku', name: '化学', short: '化', target: 35, prov: true, parts: nParts(3, 20)},
  ]},
  {id: 'kyote', name: '共通テスト', note: '', subjects: [
    {id: 'kokugo', short: '国', name: '国語', target: 180, prov: true, parts: [P('第1問', 45), P('第2問', 45), P('第3問', 20), P('第4問', 45), P('第5問', 45)]},
    {id: 'sugaku1', short: 'IA', name: '数学IA', target: 90, prov: false, parts: [P('合計', 100)]},
    {id: 'sugaku2', short: 'IIBC', name: '数学IIBC', target: 90, prov: false, parts: [P('合計', 100)]},
    {id: 'eigoR', short: 'R', name: '英語R', target: 90, prov: false, parts: [P('合計', 100)]},
    {id: 'eigoL', short: 'L', name: '英語L', target: 90, prov: false, parts: [P('合計', 100)]},
    {id: 'butsuri', short: '物', name: '物理', target: 90, prov: false, parts: [P('合計', 100)]},
    {id: 'kagaku', short: '化', name: '化学', target: 90, prov: false, parts: [P('合計', 100)]},
    {id: 'kokyo', short: '公', name: '公共・政経', target: 90, prov: false, parts: [P('合計', 100)]},
    {id: 'joho', short: '情', name: '情報I', target: 90, prov: false, parts: [P('合計', 100)]},
  ]},
  {id: 'hamu', name: '大阪公立 工', note: '中期', subjects: [
    {id: 'sugaku', name: '数学', short: '数', target: null, prov: false, parts: [P('合計', 240)]},
    {id: 'eigo', name: '英語', short: '英', target: null, prov: false, parts: [P('合計', 120)]},
    {id: 'butsuri', name: '物理', short: '物', target: null, prov: true, parts: [P('合計', 120)]},
    {id: 'kagaku', name: '化学', short: '化', target: null, prov: true, parts: [P('合計', 120)]},
  ]},
  {id: 'keio', name: '慶應 経済', note: 'A方式', subjects: [
    {id: 'eigo', name: '英語', short: '英', target: null, prov: false, parts: [P('合計', 200)]},
    {id: 'sugaku', name: '数学', short: '数', target: null, prov: false, parts: [P('合計', 200)]},
  ]},
];
export const EXAMS_VER = 2;
export const TODAI_SUBJ = ['kokugo', 'sugaku', 'eigo', 'butsuri', 'kagaku'];
export const maxOf = parts => parts.reduce((t, p) => t + (+p.max || 0), 0);
export const sumOf = a => a.scores.reduce((t, x) => t + (x == null ? 0 : +x), 0);
export const liveAttempts = scores => scores.attempts.filter(a => !a.deleted);
export const yearKey = l => { const m = String(l).match(/(\d{4})/); return m ? +m[1] : -1; };
export const newestAttempt = xs => xs.slice().sort((x, y) => y.date.localeCompare(x.date) || y.updatedAt.localeCompare(x.updatedAt))[0];
export const rate = a => pct(sumOf(a), maxOf(a.parts));
