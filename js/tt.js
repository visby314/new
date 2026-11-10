// 時間割の決まり（画面に触らない）
import { slotRange, dayOrder, shiftDay, weekdayIdx, dayKey } from './util.js';

export const slotSessionId = (dayK, slotId) => `tt-${dayK}-${slotId}`;
export const liveTables = tt => (tt.tables || []).filter(t => !t.deleted);

// その日に使う時間割：切り替え日(from)がその日以前で、いちばん新しいもの
export function activeTable(tt, dayK) {
  let best = null;
  for (const t of liveTables(tt)) {
    if (!t.from || t.from > dayK) continue;
    if (!best || t.from > best.from || (t.from === best.from && (t.updatedAt || '') > (best.updatedAt || ''))) best = t;
  }
  return best;
}
// その日のコマ（始まりの早い順）。足した日(c)より前の日には出さない
export function slotsFor(tt, dayK) {
  const t = activeTable(tt, dayK);
  if (!t) return [];
  const list = (t.days[weekdayIdx(dayK)] || []).filter(s => s && s.s && s.e && (!s.c || s.c <= dayK));
  return list.map(s => { const [startMs, endMs] = slotRange(dayK, s.s, s.e); return {id: s.id, s: s.s, e: s.e, subjectId: s.subjectId, memo: s.memo || '', startMs, endMs, full: Math.round((endMs - startMs) / 1000), tableId: t.id}; })
    .sort((a, b) => a.startMs - b.startMs);
}
export const sortSlots = list => list.slice().sort((a, b) => dayOrder(a.s) - dayOrder(b.s));

// 計った記録（時間割の記録ではないもの）が、ある時間帯に重なっている秒数
// 途中で止めた記録は、時間帯に入っている割合で数える
export function measuredOverlap(sessions, startMs, endMs, excludeId) {
  let sum = 0;
  for (const s of sessions) {
    if (s.deleted || s.kind === 'slot' || s.id === excludeId || !s.sec) continue;
    const a = Date.parse(s.start), b = Date.parse(s.end);
    if (!(b > a)) continue;
    const lo = Math.max(a, startMs), hi = Math.min(b, endMs);
    if (hi <= lo) continue;
    sum += (hi - lo) / 1000 * Math.min(1, s.sec / ((b - a) / 1000));
  }
  return Math.min(sum, (endMs - startMs) / 1000);
}

// コマの状態：done=やった / skip=やってない / run=計って記録した / now=いま / future=これから / pending=まだ答えていない
export function slotState(tt, sessions, dayK, slot, nowMs) {
  const S = sessions.find(x => x.id === slotSessionId(dayK, slot.id));
  if (S && !S.deleted) return {st: 'done', session: S, sec: S.sec, subjectId: S.subjectId};
  const measured = measuredOverlap(sessions, slot.startMs, slot.endMs);
  if (S && S.deleted && S.covered) return {st: 'run', sec: measured};
  let mark = tt.marks && tt.marks[dayK] && tt.marks[dayK][slot.id];
  if (mark && mark.st === 'none') mark = null;
  if (mark && mark.st === 'skip') return {st: 'skip', sec: measured};
  if (mark && mark.st === 'run') return {st: 'run', sec: measured};
  if (measured >= slot.full * 0.5) return {st: 'run', sec: measured};
  if (nowMs < slot.startMs) return {st: 'future', sec: 0};
  if (nowMs < slot.endMs) return {st: 'now', sec: measured};
  return {st: 'pending', sec: measured};
}

// 時間割の記録（kind: slot）の秒数を、計った記録と重ならないように直す。変わったら true
export function reconcile(study, stamp) {
  let changed = false;
  for (const S of study.sessions) {
    if (S.kind !== 'slot' || !S.slot || S.slot.fixed || !S.slot.full) continue;
    if (S.deleted && !S.covered) continue;
    const a = Date.parse(S.start), b = a + S.slot.full * 1000;
    let want = Math.max(0, Math.round(S.slot.full - measuredOverlap(study.sessions, a, b, S.id)));
    if (want < 60) want = 0;
    if (S.deleted && S.covered) {
      if (want > 0) { delete S.deleted; delete S.covered; S.sec = want; S.updatedAt = stamp; changed = true; }
    } else if (want === 0) { S.deleted = true; S.covered = true; S.updatedAt = stamp; changed = true; }
    else if (S.sec !== want) { S.sec = want; S.updatedAt = stamp; changed = true; }
  }
  return changed;
}

// まだ答えていないコマを、今日から back 日前までさかのぼって集める（新しい日が先）
export function pendingDays(tt, sessions, nowMs, back = 6) {
  const today = dayKey(nowMs), out = [];
  for (let i = 0; i <= back; i++) {
    const d = shiftDay(today, -i);
    const slots = slotsFor(tt, d).filter(s => slotState(tt, sessions, d, s, nowMs).st === 'pending');
    if (slots.length) out.push({dayK: d, slots});
  }
  return out;
}

// いまのコマと次のコマ
export function nowAndNext(tt, nowMs) {
  const today = dayKey(nowMs), slots = slotsFor(tt, today);
  const cur = slots.find(s => nowMs >= s.startMs && nowMs < s.endMs) || null;
  let next = slots.find(s => s.startMs > nowMs) || null, nextDay = today;
  if (!next) { nextDay = shiftDay(today, 1); next = slotsFor(tt, nextDay)[0] || null; }
  return {cur, next, nextDay, today, slots};
}

// 時間割の重なり（同じ曜日で時間がかぶっているコマ）を見つける
export function overlaps(list) {
  const xs = list.filter(s => s.s && s.e).map(s => { const [a, b] = slotRange('2026-01-05', s.s, s.e); return {id: s.id, a, b}; }).sort((x, y) => x.a - y.a);
  const bad = new Set();
  for (let i = 1; i < xs.length; i++) if (xs[i].a < xs[i - 1].b) { bad.add(xs[i].id); bad.add(xs[i - 1].id); }
  return bad;
}
export const slotMinutes = s => { if (!s.s || !s.e) return 0; const [a, b] = slotRange('2026-01-05', s.s, s.e); return Math.round((b - a) / 60000); };
