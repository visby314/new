// 計算と合わせ方の確認。使い方: TZ=Asia/Tokyo node --test tests/
// OLD_APPS に古いアプリのフォルダ、STUDY_INBOX に study-inbox のフォルダを指定すると、実物との行き来も確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mergeStudy, defaultStudy, mergeScores, normScores, mergeKouzaItems, mergeTT, defaultTT } from '../js/merge.js';
import { slotsFor, slotState, reconcile, slotSessionId, pendingDays, measuredOverlap, activeTable, nowAndNext, overlaps } from '../js/tt.js';
import { bookInfo, planInfo, nextOf, setBit, COURSE, kouzaSummary, DEFAULT_EXAMS, secOfDay, flatItems } from '../js/calc.js';
import { slotMs, slotRange, dayKey, shiftDay, daysBetween, clone } from '../js/util.js';

const OLD = process.env.OLD_APPS, INBOX = process.env.STUDY_INBOX;
const at = (day, hhmm) => new Date(slotMs(day, hhmm)).toISOString();
const sess = (id, day, s, e, extra = {}) => ({id, subjectId: 'sugaku', subjectName: '数学', start: at(day, s), end: at(day, e), sec: Math.round((slotMs(day, e) - slotMs(day, s)) / 1000), kind: 'sw', memo: '', updatedAt: '2026-11-11T00:00:00.000Z', ...extra});

// 古いアプリの merge をソースから取り出す
function oldFn(app, name, pre = '') {
  const src = fs.readFileSync(path.join(OLD, app, 'index.html'), 'utf8');
  const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, `${app} に ${name} がない`);
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; if (src[k] === '}') { depth--; if (!depth) { j = k + 1; break; } } }
  return new Function(`${pre}; return ${src.slice(i, j)}`)();
}

test('時刻：4時より前は次の日の夜中、朝4時で日付が変わる', () => {
  assert.equal(new Date(slotMs('2026-11-11', '05:30')).getHours(), 5);
  assert.equal(dayKey(slotMs('2026-11-11', '01:00')), '2026-11-11');
  assert.equal(new Date(slotMs('2026-11-11', '01:00')).getDate(), 12);
  const [a, b] = slotRange('2026-11-11', '23:00', '00:30');
  assert.equal((b - a) / 60000, 90);
  assert.equal(daysBetween('2026-11-11', '2027-02-25'), 106);
  assert.equal(shiftDay('2026-11-30', 1), '2026-12-01');
});

test('study-log：新しいほうを残し、知らないキーも消さない', () => {
  const a = defaultStudy(); a.sessions.push(sess('x1', '2026-11-11', '09:00', '10:00', {updatedAt: '2026-11-11T02:00:00.000Z', memo: '端末'}));
  const b = defaultStudy(); b.sessions.push(sess('x1', '2026-11-11', '09:00', '10:00', {updatedAt: '2026-11-11T01:00:00.000Z', memo: 'GitHub'}), sess('x2', '2026-11-10', '09:00', '10:00'));
  b.goalH = 13; b.goalAt = '2026-10-29T00:00:00.000Z'; b.future = {keep: true};
  const m = mergeStudy(a, b);
  assert.deepEqual(m.sessions.map(s => s.id), ['x2', 'x1']);
  assert.equal(m.sessions[1].memo, '端末');
  assert.equal(m.goalH, 13);
  assert.deepEqual(m.future, {keep: true});
  assert.deepEqual(Object.keys(m).slice(0, 9), ['v', 'sessions', 'subjects', 'subjAt', 'goalH', 'goalAt', 'plan', 'planAt', 'books']);
});

test('時間割：切り替え日と曜日でコマが決まる', () => {
  const tt = defaultTT();
  const slot = (id, s, e, subjectId = 'sugaku', c = '2026-11-01') => ({id, s, e, subjectId, memo: '', c});
  tt.tables.push({id: 't1', name: '', from: '2026-11-01', days: {0: [slot('h', '09:00', '12:00')], 1: [], 2: [], 3: [slot('b', '07:10', '08:40'), slot('a', '05:30', '07:00')], 4: [], 5: [], 6: []}, updatedAt: 'x'});
  tt.tables.push({id: 't2', name: '', from: '2026-12-01', days: {0: [], 1: [], 2: [slot('k', '06:00', '07:00', 'eigo', '2026-11-11')], 3: [], 4: [], 5: [], 6: []}, updatedAt: 'x'});
  assert.equal(activeTable(tt, '2026-11-11').id, 't1');
  assert.equal(activeTable(tt, '2026-12-01').id, 't2');
  assert.equal(activeTable(tt, '2026-10-31'), null);
  assert.deepEqual(slotsFor(tt, '2026-11-11').map(s => s.id), ['a', 'b']); // 水曜
  assert.deepEqual(slotsFor(tt, '2026-11-15').map(s => s.id), ['h']);      // 日曜
  assert.deepEqual(slotsFor(tt, '2026-12-01').map(s => s.id), ['k']);      // 火曜、新しい時間割
  assert.equal(slotsFor(tt, '2026-11-11')[0].full, 5400);
});

test('時間割：コマの状態と、計った記録との重なり', () => {
  const tt = defaultTT();
  const mk = (id, s, e) => ({id, s, e, subjectId: 'sugaku', memo: '', c: '2026-11-01'});
  tt.tables.push({id: 't1', from: '2026-11-01', days: {0: [], 1: [], 2: [], 3: [mk('a', '05:30', '07:00'), mk('b', '07:10', '08:40'), mk('c', '09:00', '10:30')], 4: [], 5: [], 6: []}, updatedAt: 'x'});
  const day = '2026-11-11', study = defaultStudy();
  const [a, b, c] = slotsFor(tt, day);
  const t = hhmm => slotMs(day, hhmm);
  assert.equal(slotState(tt, study.sessions, day, a, t('05:00')).st, 'future');
  assert.equal(slotState(tt, study.sessions, day, a, t('06:00')).st, 'now');
  assert.equal(slotState(tt, study.sessions, day, a, t('07:05')).st, 'pending');
  assert.deepEqual(pendingDays(tt, study.sessions, t('09:10'), 0)[0].slots.map(s => s.id), ['a', 'b']);
  // a を「やった」にする
  study.sessions.push({id: slotSessionId(day, 'a'), subjectId: 'sugaku', subjectName: '数学', start: at(day, '05:30'), end: at(day, '07:00'), sec: 5400, kind: 'slot', memo: '', slot: {d: day, id: 'a', full: 5400}, updatedAt: 'x'});
  assert.equal(reconcile(study, 'y'), false);
  assert.equal(slotState(tt, study.sessions, day, a, t('09:10')).st, 'done');
  // b は「やってない」
  tt.marks[day] = {b: {st: 'skip', u: 'x'}};
  assert.equal(slotState(tt, study.sessions, day, b, t('09:10')).st, 'skip');
  tt.marks[day].b = {st: 'none', u: 'y'};
  assert.equal(slotState(tt, study.sessions, day, b, t('09:10')).st, 'pending');
  // a の時間帯に 30分 計った記録が入ると、a は 60分 に減る（二重に数えない）
  study.sessions.push(sess('m1', day, '06:00', '06:30'));
  assert.equal(reconcile(study, 'z'), true);
  assert.equal(study.sessions[0].sec, 3600);
  assert.equal(secOfDay(study, day), 5400);
  // c の時間帯を 60分 計ったら、c は聞かれない
  study.sessions.push(sess('m2', day, '09:10', '10:10'));
  assert.equal(slotState(tt, study.sessions, day, c, t('11:00')).st, 'run');
  // a をまるごと覆う記録が入ると a は消え、その記録を消すと戻る
  study.sessions.push(sess('m3', day, '05:30', '07:00', {sec: 3600}));
  reconcile(study, 'w');
  assert.equal(study.sessions[0].deleted, true);
  assert.equal(slotState(tt, study.sessions, day, a, t('11:00')).st, 'run');
  study.sessions.find(s => s.id === 'm3').deleted = true; study.sessions.find(s => s.id === 'm1').deleted = true;
  reconcile(study, 'v');
  assert.equal(study.sessions[0].deleted, undefined);
  assert.equal(study.sessions[0].sec, 5400);
  // 途中で止めた記録は割合で数える（2時間の枠で実働1時間 → 重なりは半分）
  assert.equal(Math.round(measuredOverlap([sess('p', day, '05:30', '07:30', {sec: 3600})], t('05:30'), t('06:30'))), 1800);
  const nn = nowAndNext(tt, t('08:50')); assert.equal(nn.cur, null); assert.equal(nn.next.id, 'c');
  assert.deepEqual([...overlaps([mk('x', '05:00', '06:00'), mk('y', '05:30', '06:30'), mk('z', '07:00', '08:00')])].sort(), ['x', 'y']);
});

test('時間割：2台で付けた印は新しいほうが残る', () => {
  const a = defaultTT(), b = defaultTT();
  a.marks['2026-11-11'] = {s1: {st: 'skip', u: '2'}, s2: {st: 'skip', u: '1'}};
  b.marks['2026-11-11'] = {s1: {st: 'none', u: '1'}, s2: {st: 'none', u: '3'}, s3: {st: 'run', u: '1'}};
  const m = mergeTT(a, b);
  assert.deepEqual(m.marks['2026-11-11'], {s1: {st: 'skip', u: '2'}, s2: {st: 'none', u: '3'}, s3: {st: 'run', u: '1'}});
});

test('教材ノルマ：今日の分は、残りを締め切りまでの日数で割る', () => {
  const b = {id: 'b1', log: [{d: '2026-11-10', n: 2}], created: '2026-10-30', name: 'x', subjectId: 'eigo', unit: '題', total: 32, base: 0, deadline: '2026-11-30'};
  const x = bookInfo(b, '2026-11-11');
  assert.equal(x.done, 2); assert.equal(x.daysLeft, 20); assert.equal(x.quota, 2); assert.equal(x.todayLeft, 2); assert.equal(x.slow, true);
});

test('講座：次の1本と、印の付け外し', () => {
  const items = {}, c = COURSE.butsuri;
  assert.equal(nextOf(items, c, 1).n, 1);
  assert.equal(nextOf(items, c, 2), null);
  setBit(items, 'butsuri', 1, 1, true, 't1', '2026-11-11');
  assert.deepEqual(items['butsuri:1'], {b: 1, u: 't1', d: {1: '2026-11-11'}});
  assert.equal(nextOf(items, c, 1).n, 2);
  assert.equal(nextOf(items, c, 2).n, 1);
  setBit(items, 'butsuri', 1, 2, true, 't2', '2026-11-12');
  assert.equal(nextOf(items, c, 4).n, 1);
  setBit(items, 'butsuri', 1, 1, false, 't3', '2026-11-12');
  assert.deepEqual(items['butsuri:1'], {b: 2, u: 't3', d: {2: '2026-11-12'}});
  assert.equal(kouzaSummary(items).find(x => x.id === 'butsuri').演習, 1);
  assert.equal(flatItems(COURSE.sugA).length, 521);
});

test('実物の記録：読んで合わせても中身が変わらない', {skip: !INBOX}, () => {
  const rd = f => JSON.parse(fs.readFileSync(path.join(INBOX, 'records', f), 'utf8'));
  const study = rd('study-log.json');
  assert.equal(JSON.stringify(mergeStudy(defaultStudy(), clone(study))), JSON.stringify(study));
  const scores = rd('scores.json');
  const local = normScores({v: 1, attempts: [], exams: clone(DEFAULT_EXAMS), examsAt: '1970-01-01T00:00:00.000Z', examsVer: 2, kyoteRate: 90, rateAt: '1970-01-01T00:00:00.000Z'});
  assert.equal(JSON.stringify(mergeScores(local, clone(scores))), JSON.stringify(scores));
  const kz = rd('kouza.json');
  const items = mergeKouzaItems({}, kz.items);
  assert.equal(JSON.stringify(items), JSON.stringify(kz.items));
  assert.equal(JSON.stringify(kouzaSummary(items)), JSON.stringify(kz.summary));
  assert.ok(planInfo(study, '2026-11-10'));
});

test('古いアプリと行き来しても、時間割の記録が残る', {skip: !OLD}, () => {
  const T0 = "const T0 = '1970-01-01T00:00:00.000Z'";
  const kMerge = oldFn('kirocker2', 'merge', T0);
  const mine = defaultStudy();
  mine.sessions.push({id: 'tt-2026-11-11-a', subjectId: 'sugaku', subjectName: '数学', start: at('2026-11-11', '05:30'), end: at('2026-11-11', '07:00'), sec: 5400, kind: 'slot', memo: '', slot: {d: '2026-11-11', id: 'a', full: 5400}, updatedAt: '2026-11-11T00:00:00.000Z'});
  mine.subjAt = '2026-11-01T00:00:00.000Z';
  const oldLocal = {v: 1, sessions: [sess('k1', '2026-11-11', '08:00', '09:00')], subjects: mine.subjects, subjAt: '1970-01-01T00:00:00.000Z', goalH: 8, goalAt: '1970-01-01T00:00:00.000Z', plan: {start: null, end: '2027-02-25'}, planAt: '1970-01-01T00:00:00.000Z', books: []};
  const viaOld = kMerge(oldLocal, clone(mine));
  assert.deepEqual(viaOld.sessions.find(s => s.id === 'tt-2026-11-11-a').slot, {d: '2026-11-11', id: 'a', full: 5400});
  // 古いアプリが書いたものをこのアプリで読み直しても同じ
  assert.equal(JSON.stringify(mergeStudy(clone(viaOld), clone(viaOld))), JSON.stringify(viaOld));
  const sMerge = oldFn('oresamatenbuyer', 'merge');
  const sc = normScores({attempts: [{id: 'a1', examId: 'todai', subjectId: 'sugaku', label: '2020年度', date: '2026-11-11', parts: [{name: '第1問', max: 20}], scores: [10], ptimes: [600], updatedAt: 'x'}]}, DEFAULT_EXAMS);
  const viaOldS = sMerge({v: 1, attempts: [], exams: clone(DEFAULT_EXAMS), examsAt: '1970-01-01T00:00:00.000Z', examsVer: 2, kyoteRate: 90, rateAt: '1970-01-01T00:00:00.000Z'}, clone(sc));
  assert.deepEqual(viaOldS.attempts[0].ptimes, [600]);
  assert.equal(JSON.stringify(mergeScores(clone(viaOldS), clone(viaOldS))), JSON.stringify(viaOldS));
});
