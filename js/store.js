// 記録の置き場所：端末（localStorage）と GitHub（study-inbox の records/）
import { enc, dec, nowISO, clone, T0 } from './util.js';
import { mergeStudy, normStudy, defaultStudy, mergeScores, normScores, mergeKouzaItems, mergeTT, normTT, defaultTT } from './merge.js';
import { reconcile } from './tt.js';
import { DEFAULT_EXAMS, EXAMS_VER, kouzaSummary } from './calc.js';

// ---------- 保存先の設定（古いアプリと同じ名前で端末に置く。同じブラウザなら鍵を入れ直さなくてよい） ----------
const LS_GH = 'study-inbox-settings-v1';
export const gh = {owner: '', repo: '', token: ''};
try { Object.assign(gh, JSON.parse(localStorage.getItem(LS_GH) || '{}')); } catch (e) {}
export const ghReady = () => !!(gh.owner && gh.repo && gh.token);
export function saveGh(v) {
  gh.owner = v.owner; gh.repo = v.repo; gh.token = v.token;
  try { localStorage.setItem(LS_GH, JSON.stringify(gh)); } catch (e) {}
}
export const api = (path, opt = {}) => fetch(`https://api.github.com/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}${path}`, Object.assign({
  headers: {'Authorization': 'Bearer ' + gh.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'},
}, opt));
// 鍵とリポジトリを確かめる。{ok, msg}
export async function checkGh() {
  if (!ghReady()) return {ok: false, msg: '3つとも入れてください。'};
  try {
    const r = await api('', {cache: 'no-store'});
    if (r.status === 401) return {ok: false, msg: '鍵が正しくないか、期限が切れています。'};
    if (r.status === 404) return {ok: false, msg: 'リポジトリが見つかりません。名前と、鍵にこのリポジトリの許可があるかを確認してください。'};
    if (!r.ok) return {ok: false, msg: 'GitHubにつながりませんでした（' + r.status + '）。'};
    const j = await r.json();
    if (!j.private) return {ok: false, msg: 'このリポジトリは公開になっています。非公開のリポジトリを使ってください。'};
    return {ok: true, msg: 'つながりました。記録は records/ に、間違えた問題は inbox/ に入ります。'};
  } catch (e) { return {ok: false, msg: 'GitHubにつながりませんでした。電波を確認してください。'}; }
}

// ---------- 画面の好み（この端末だけ） ----------
const LS_UI = 'new-ui-v1';
export const ui = {
  tab: 'today', mode: 'tt', subj: 'sugaku', runMode: 'sw', timerMin: 50, awake: false,
  recTab: 'time', range: 7, kouzaTab: 'kagaku', kouzaFilter: 0, kouzaOpen: {}, hideCourses: [],
  exam: 'todai', examSubj: 'sugaku', kind: '本試', lmode: 'grid',
  alertStart: true, alertEnd: true, alertSound: true, sendSubject: '数学', recentSources: [],
};
try { Object.assign(ui, JSON.parse(localStorage.getItem(LS_UI) || '{}')); } catch (e) {}
export const saveUI = () => { try { localStorage.setItem(LS_UI, JSON.stringify(ui)); } catch (e) {} };

// ---------- 4つのファイル ----------
// 古い版の試験設定を新しい版に合わせる（得点記録アプリと同じ）
function migrateScores(d) {
  if ((d.examsVer || 1) >= EXAMS_VER) return false;
  const def = id => DEFAULT_EXAMS.find(e => e.id === id);
  d.exams.forEach(e => { const de = def(e.id); if (!de) return; e.subjects.forEach(s => { const ds = de.subjects.find(x => x.id === s.id); if (ds && !s.short) s.short = ds.short; }); });
  for (const id of ['hamu', 'keio']) {
    const e = d.exams.find(x => x.id === id);
    if (!e) d.exams.push(clone(def(id))); else if (!e.subjects.length) e.subjects = clone(def(id).subjects);
  }
  if (!d.attempts.some(a => a.examId === 'kyudai' && !a.deleted)) d.exams = d.exams.filter(e => e.id !== 'kyudai');
  d.examsVer = EXAMS_VER; d.examsAt = nowISO();
  return true;
}
const KOUZA_NOTE = 'b は 1=視聴 2=演習 4=復習 の合計。d は各段階を付けた日（同期を入れる前に付けたものは日付なし）';
const FILES = {
  study: {
    path: 'records/study-log.json', msg: 'study-log: update', init: defaultStudy, norm: normStudy,
    // {data: 端末に持つ形, out: GitHub に置く形}
    merge(local, remote) { const data = mergeStudy(local, remote); reconcile(data, nowISO()); return {data, out: data}; },
    same: (remote, out) => JSON.stringify(remote) === JSON.stringify(out),
  },
  scores: {
    path: 'records/scores.json', msg: 'scores: update',
    init: () => ({v: 1, attempts: [], exams: clone(DEFAULT_EXAMS), examsAt: T0, examsVer: EXAMS_VER, kyoteRate: 90, rateAt: T0}),
    norm: d => normScores(d, DEFAULT_EXAMS),
    merge(local, remote) { const data = mergeScores(normScores(local, DEFAULT_EXAMS), remote ? normScores(remote, DEFAULT_EXAMS) : null); migrateScores(data); return {data, out: data}; },
    same: (remote, out) => JSON.stringify(remote) === JSON.stringify(out),
  },
  kouza: {
    path: 'records/kouza.json', msg: 'kouza: update', init: () => ({items: {}}),
    norm: d => { const x = d && typeof d === 'object' ? d : {}; if (!x.items || typeof x.items !== 'object') x.items = {}; return x; },
    merge(local, remote) {
      const items = mergeKouzaItems(local.items, remote && remote.items);
      const out = {v: 1, app: 'kouza-checklist', note: KOUZA_NOTE, summary: kouzaSummary(items), items};
      return {data: {items}, out};
    },
    same: (remote, out) => JSON.stringify(remote.items) === JSON.stringify(out.items) && JSON.stringify(remote.summary) === JSON.stringify(out.summary),
    stamp: out => { out.updatedAt = nowISO(); },
  },
  tt: {
    path: 'records/timetable.json', msg: 'timetable: update', init: defaultTT, norm: normTT,
    merge(local, remote) { const data = mergeTT(local, remote); return {data, out: data}; },
    same: (remote, out) => JSON.stringify(remote) === JSON.stringify(out),
  },
};
export const NAMES = Object.keys(FILES);
export const db = {};
const dirty = {}, rev = {};
const lsKey = n => `new-${n}-v1`;
for (const n of NAMES) {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(lsKey(n)) || 'null'); } catch (e) {}
  db[n] = FILES[n].norm(v && v.v === 1 && v.data ? v.data : FILES[n].init());
  dirty[n] = !!(v && v.dirty); rev[n] = 0;
}
let saveFailed = false;
function saveLocal(n) {
  try { localStorage.setItem(lsKey(n), JSON.stringify({v: 1, data: db[n], dirty: dirty[n]})); saveFailed = false; }
  catch (e) { if (!saveFailed) { saveFailed = true; setStatus('この端末に保存できませんでした', 'warn'); } }
}

// ---------- 知らせる相手 ----------
const dataFns = [], statusFns = [];
export const onData = fn => dataFns.push(fn);     // 記録が変わった（自分で変えた・GitHubから届いた）
export const onStatus = fn => statusFns.push(fn); // 同期の状態が変わった
const emitData = src => dataFns.forEach(fn => { try { fn(src); } catch (e) { console.error(e); } });
export let status = {text: '', kind: ''};
function setStatus(text, kind) { status = {text, kind: kind || ''}; statusFns.forEach(fn => fn(status)); }
export const isDirty = () => NAMES.some(n => dirty[n]);

// ---------- 変えたら呼ぶ ----------
let syncTimer = 0;
export function changed(...names) {
  for (const n of names) {
    if (n === 'study') reconcile(db.study, nowISO());
    rev[n]++; dirty[n] = true; saveLocal(n);
  }
  emitData('local');
  clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(), 800);
}

// ---------- GitHub との同期 ----------
async function getFile(path) {
  const r = await api('/contents/' + path, {cache: 'no-store'});
  if (r.status === 404) return {json: null, sha: null};
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  let text;
  if (j.content && j.encoding === 'base64') text = dec(j.content);
  else { // 1MBを超えると中身が付いてこないので、別の口から取る
    const b = await api('/git/blobs/' + j.sha, {cache: 'no-store'});
    if (!b.ok) throw new Error('HTTP ' + b.status);
    text = dec((await b.json()).content);
  }
  return {json: JSON.parse(text), sha: j.sha};
}
async function syncFile(n) {
  const f = FILES[n];
  let fromRemote = false;
  for (let tryNo = 0; tryNo < 3; tryNo++) {
    const {json: remote, sha} = await getFile(f.path);
    const before = JSON.stringify(db[n]);
    const remoteText = remote ? clone(remote) : null; // 合わせる前の形を比べる用にとっておく
    const {data, out} = f.merge(db[n], remote);
    db[n] = f.norm(data);
    const r0 = rev[n];
    if (JSON.stringify(db[n]) !== before) fromRemote = true;
    if (remoteText && f.same(remoteText, out)) { if (rev[n] === r0) dirty[n] = false; break; }
    if (!remoteText && !dirty[n]) break; // まだ何も入れていないファイルは作らない
    if (f.stamp) f.stamp(out);
    const body = {message: f.msg, content: enc(JSON.stringify(out, null, 1))}; if (sha) body.sha = sha;
    const w = await api('/contents/' + f.path, {method: 'PUT', body: JSON.stringify(body)});
    if (w.ok) { if (rev[n] === r0) dirty[n] = false; else again = true; break; }
    if ((w.status === 409 || w.status === 422) && tryNo < 2) continue;
    throw new Error('HTTP ' + w.status);
  }
  saveLocal(n);
  return fromRemote;
}
let syncing = false, again = false, lastFull = 0;
// only：変えたファイルだけ送る。false なら全部のファイルを取りに行く
export async function sync(only = true) {
  if (!ghReady()) { setStatus(isDirty() ? 'この端末に保存中' : '', ''); return false; }
  if (syncing) { again = true; return false; }
  syncing = true; setStatus('同期中…', '');
  let ok = true, got = false;
  try {
    const full = !only || Date.now() - lastFull > 5 * 60000;
    for (const n of NAMES) { if (full || dirty[n]) got = (await syncFile(n)) || got; }
    if (full) lastFull = Date.now();
    setStatus('同期済み', 'ok');
  } catch (err) {
    ok = false;
    setStatus(/HTTP 40[13]/.test(String(err.message || err)) ? '鍵を確認してください' : 'この端末に保存中（あとで送ります）', 'warn');
  } finally {
    syncing = false;
    if (got) emitData('remote');
    if (again) { again = false; setTimeout(() => sync(), 50); }
  }
  return ok;
}
export const syncAll = () => sync(false);
export const lastSyncAge = () => Date.now() - lastFull;
