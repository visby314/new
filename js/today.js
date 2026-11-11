// 「今日」の画面：計る（時間割／普通に計る）、今日のコマ、今日のノルマ、講座の次の1本
import { $, $$, toast, armed, nav, unlockAudio, beep, keepAwake } from './dom.js';
import { db, ui, saveUI, changed } from './store.js';
import { esc, nowISO, uid, todayKey, dayKey, weekday, md, hm, dur, clock } from './util.js';
import { slotsFor, slotState, slotSessionId, pendingDays, nowAndNext, liveTables } from './tt.js';
import { liveSessions, liveBooks, bookInfo, COURSES, COURSE, STAGES, nextOf, setBit, flatItems } from './calc.js';
import { subj, subjName, subjColor, dotHTML, subjChips } from './shared.js';

const PRESETS = [25, 50, 60, 90];
const EARLY_MS = 30 * 60000; // 次のコマを早めに始められるのは30分前から

// ---------- 計っている途中の状態（この端末だけ） ----------
// {mode:'sw'|'timer', subjectId, firstStart, resumedAt, acc, paused, target, memo, slot:{d,id,s,e,startMs,endMs}|null}
const LS_RUN = 'new-run-v1';
let run = null;
try { run = JSON.parse(localStorage.getItem(LS_RUN) || 'null'); } catch (e) {}
const saveRun = () => { try { run ? localStorage.setItem(LS_RUN, JSON.stringify(run)) : localStorage.removeItem(LS_RUN); } catch (e) {} };
const activeMs = () => run ? run.acc + (run.paused ? 0 : Date.now() - run.resumedAt) : 0;
const wantAwake = () => ui.awake && run && !run.paused;
export const isRunning = () => !!run;

// ---------- 上の合計 ----------
function renderSum() {
  const k = todayKey();
  const ss = liveSessions(db.study).filter(s => dayKey(Date.parse(s.start)) === k);
  const tot = ss.reduce((t, s) => t + s.sec, 0), goal = (+db.study.goalH || 0) * 3600;
  const per = new Map(); ss.forEach(s => per.set(s.subjectId, (per.get(s.subjectId) || 0) + s.sec));
  const base = Math.max(goal, tot, 1);
  const segs = [...per.entries()].sort((a, b) => b[1] - a[1]).map(([id, sec]) => `<i style="width:${(sec * 100 / base).toFixed(2)}%;background:${subjColor(id)}" title="${esc(subjName(id))} ${dur(sec)}"></i>`).join('');
  const left = goal - tot;
  $('tdSum').innerHTML = `<div class="line"><span class="date">${md(k)}<small>（${weekday(k)}）</small></span><span class="bignum">${dur(tot)}${goal ? `<small>/ 目標 ${dur(goal)}</small>` : ''}</span></div>
    <div class="segbar" role="img" aria-label="今日の勉強時間 ${dur(tot)}">${segs}</div>
    ${goal ? `<p class="note">${left > 0 ? `目標まであと ${dur(left)}` : '<span class="okt">今日の目標に届きました</span>'}${per.size ? '・' + [...per.entries()].sort((a, b) => b[1] - a[1]).map(([id, sec]) => `${esc(subjName(id))} ${dur(sec)}`).join('、') : ''}</p>` : ''}`;
}

// ---------- 計る ----------
const slotLine = s => `${hm(s.startMs)}–${hm(s.endMs)}`;
function slotBlock(s, label, x) {
  const tag = x && x.st === 'done' ? '<span class="tag">やった</span>' : x && x.st === 'skip' ? '<span class="tag warn">やってない</span>' : x && x.st === 'run' ? '<span class="tag">計った</span>' : '';
  return `<div class="slotnow"><span class="when">${label} ${slotLine(s)}</span><span class="what">${dotHTML(s.subjectId)}${esc(subjName(s.subjectId))}${s.memo ? `<small>${esc(s.memo)}</small>` : ''}${tag}</span></div>`;
}
function renderRun() {
  const now = Date.now(), mode = ui.mode === 'free' ? 'free' : 'tt';
  $$('#tdMode [data-mode]').forEach(b => { b.setAttribute('aria-checked', String(b.dataset.mode === mode)); b.disabled = !!run; });
  $('tdFree').hidden = !!run || mode !== 'free';
  $('memoField').hidden = !run && mode === 'tt';
  let slotHTML = '', btns = '';
  if (run) {
    if (run.slot) slotHTML = slotBlock({...run.slot, subjectId: run.subjectId, memo: ''}, '時間割のコマ');
    btns = run.paused
      ? `<button type="button" class="primary big" data-act="resume">再開</button><button type="button" class="tool" data-act="finish">終わって記録する</button><button type="button" class="tool danger" data-act="discard">記録せずに消す</button>`
      : `<button type="button" class="primary big" data-act="finish">終わって記録する</button><button type="button" class="tool" data-act="pause">一時停止</button>`;
  } else if (mode === 'tt') {
    if (!liveTables(db.tt).length) {
      slotHTML = `<p class="note">時間割がまだありません。時間割を作ると、コマが終わるたびに「やった／やってない」を押すだけで記録できます。</p>`;
      btns = `<button type="button" class="primary" data-act="make-tt">時間割を作る</button><button type="button" class="tool" data-act="to-free">科目を選んで計る</button>`;
    } else {
      const {cur, next, nextDay, today} = nowAndNext(db.tt, now);
      if (cur) {
        slotHTML = slotBlock(cur, 'いまのコマ', slotState(db.tt, db.study.sessions, today, cur, now));
        btns = `<button type="button" class="primary big" data-act="start-slot">始める</button><button type="button" class="tool" data-act="to-free">ほかの科目を計る</button>`;
      } else {
        if (next) slotHTML = slotBlock(next, nextDay === today ? '次のコマ' : '次のコマ（あした）');
        else slotHTML = `<p class="note">この先のコマはありません。</p>`;
        const early = next && next.startMs - now <= EARLY_MS;
        btns = (early ? `<button type="button" class="primary big" data-act="start-next">次のコマを早めに始める</button>` : '') + `<button type="button" class="${early ? 'tool' : 'primary'}" data-act="to-free">科目を選んで計る</button>`;
      }
    }
  } else {
    btns = `<button type="button" class="primary big" data-act="start-free">始める</button>`;
    if (!subj(ui.subj)) ui.subj = db.study.subjects[0]?.id || '';
    $('subjChips').innerHTML = subjChips(ui.subj);
    $$('#runModes [data-rmode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.rmode === ui.runMode)));
    $('timerSet').hidden = ui.runMode !== 'timer';
    $('presets').innerHTML = PRESETS.map(m => `<button type="button" class="chip" role="radio" aria-checked="${m === +ui.timerMin}" data-min="${m}">${m}分</button>`).join('');
    if (document.activeElement !== $('timerMin')) $('timerMin').value = ui.timerMin;
  }
  $('tdSlot').innerHTML = slotHTML; $('tdSlot').hidden = !slotHTML;
  $('clock').hidden = !run && mode === 'tt' && !liveTables(db.tt).length;
  $('runBtns').innerHTML = btns;
  $('awakeRow').hidden = !('wakeLock' in navigator);
  $('awake').checked = !!ui.awake;
  if (run && document.activeElement !== $('runMemo')) $('runMemo').value = run.memo || '';
  tick(true);
}
let lastSig = '';
export function tick(force) {
  const now = Date.now();
  if (run && run.mode === 'timer' && activeMs() >= run.target) { finishRun(true); return; }
  const C = $('clock'), L = $('clockLabel'), B = $('clockBig'), S = $('clockSub');
  let bar = null, state = 'idle', title = '勉強';
  const nn = liveTables(db.tt).length ? nowAndNext(db.tt, now) : null;
  if (nn) { // コマの切り替わりや日付の変わり目で、画面を描き直す
    const sig = `${nn.today}|${nn.cur ? nn.cur.id : ''}|${nn.slots.filter(s => s.endMs <= now).length}|${nn.next && nn.next.startMs - now <= EARLY_MS ? 1 : 0}`;
    if (!force && sig !== lastSig) { lastSig = sig; render(); return; }
    lastSig = sig;
  }
  if (run) {
    const a = activeMs(), nm = subjName(run.subjectId);
    state = run.paused ? 'paused' : 'running';
    if (run.mode === 'timer') {
      L.textContent = run.paused ? '残り（止めています）' : '残り'; B.textContent = clock(run.target - a + 999);
      S.textContent = `${nm}・経過 ${clock(a)}・${hm(run.firstStart)}から`; bar = Math.min(100, a * 100 / run.target);
    } else {
      L.textContent = run.paused ? '経過（止めています）' : '経過'; B.textContent = clock(a);
      let sub = `${nm}・${hm(run.firstStart)}から`;
      if (run.slot) { sub += now < run.slot.endMs ? `・コマの残り ${clock(run.slot.endMs - now)}` : '・コマの時間を過ぎています'; bar = Math.min(100, Math.max(0, (now - run.slot.startMs) * 100 / (run.slot.endMs - run.slot.startMs))); }
      S.textContent = sub;
    }
    if (!run.paused) title = `${B.textContent} ${nm}`;
  } else if (ui.mode !== 'free') {
    const {cur, next, nextDay, today} = nn || {};
    if (cur) { L.textContent = 'このコマの残り'; B.textContent = clock(cur.endMs - now + 999); S.textContent = ''; bar = (now - cur.startMs) * 100 / (cur.endMs - cur.startMs); }
    else if (next) { L.textContent = nextDay === today ? '次のコマまで' : `次のコマ（あした ${hm(next.startMs)}）まで`; B.textContent = clock(next.startMs - now + 999); S.textContent = ''; }
    else { L.textContent = '時間割'; B.textContent = '–'; S.textContent = ''; }
  } else {
    const isT = ui.runMode === 'timer';
    L.textContent = isT ? 'タイマー' : '経過'; B.textContent = isT ? clock((+ui.timerMin || 0) * 60000) : '0:00'; S.textContent = '';
  }
  C.dataset.state = state;
  $('clockBar').hidden = bar == null; if (bar != null) $('clockFill').style.width = bar.toFixed(1) + '%';
  document.title = title;
}
function begin(mode, subjectId, target, memo, slot) {
  unlockAudio();
  const t = Date.now();
  run = {mode, subjectId, firstStart: t, resumedAt: t, acc: 0, paused: false, target, memo: memo || '', slot: slot || null};
  saveRun(); $('runMsg').textContent = ''; if (ui.awake) keepAwake(true);
  $('runMemo').value = run.memo;
  render();
}
function startFree() {
  if (!subj(ui.subj)) { $('runMsg').textContent = '科目を選んでください。'; return; }
  let target = null;
  if (ui.runMode === 'timer') { const m = +ui.timerMin; if (!(m >= 1 && m <= 600)) { $('runMsg').textContent = 'タイマーは1〜600分で入れてください。'; return; } target = m * 60000; }
  begin(ui.runMode === 'timer' ? 'timer' : 'sw', ui.subj, target, $('runMemo').value.trim(), null);
}
function startSlot(which) {
  const {cur, next, nextDay, today} = nowAndNext(db.tt, Date.now());
  const s = which === 'next' ? next : cur, d = which === 'next' ? nextDay : today;
  if (!s) { render(); return; }
  begin('sw', subj(s.subjectId) ? s.subjectId : (db.study.subjects[0]?.id || ''), null, s.memo || '', {d, id: s.id, s: s.s, e: s.e, startMs: s.startMs, endMs: s.endMs});
}
function setMark(dayK, slotId, st) {
  const day = db.tt.marks[dayK] || (db.tt.marks[dayK] = {});
  const cur = day[slotId];
  if (!cur && st === 'none') return false;
  if (cur && cur.st === st) return false;
  day[slotId] = {st, u: nowISO()};
  return true;
}
function finishRun(byTimer) {
  if (!run) return;
  let a = activeMs(), endMs = Date.now();
  if (run.mode === 'timer' && a >= run.target) { if (!run.paused) endMs = run.resumedAt + (run.target - run.acc); a = run.target; }
  const sec = Math.round(a / 1000);
  const memo = $('runMemo').value.trim() || run.memo || '';
  const s = subj(run.subjectId);
  if (sec < 60) { $('runMsg').textContent = '1分に満たなかったので、記録しませんでした。'; }
  else {
    db.study.sessions.push({id: uid(), subjectId: run.subjectId, subjectName: s ? s.name : '', start: new Date(run.firstStart).toISOString(), end: new Date(endMs).toISOString(), sec, kind: run.mode, memo, updatedAt: nowISO()});
    const names = ['study'];
    if (run.slot && setMark(run.slot.d, run.slot.id, 'run')) names.push('tt');
    $('runMsg').textContent = `${s ? s.name : ''} ${dur(sec)}を記録しました。${byTimer ? 'タイマーが終わりました。' : ''}`;
    changed(...names);
  }
  run = null; saveRun(); $('runMemo').value = ''; keepAwake(false);
  if (byTimer) beep();
  render();
}

// ---------- 今日のコマ ----------
const editing = new Set(); // 「直す」を押した行
let altFor = null;         // 「科目が違う」を押した行
const keyOf = (d, id) => d + '|' + id;
function markDone(dayK, slot, subjectId) {
  const sid = slotSessionId(dayK, slot.id), sj = subj(subjectId || slot.subjectId) || db.study.subjects[0];
  const rec = {id: sid, subjectId: sj ? sj.id : '', subjectName: sj ? sj.name : '', start: new Date(slot.startMs).toISOString(), end: new Date(slot.endMs).toISOString(),
    sec: slot.full, kind: 'slot', memo: slot.memo || '', slot: {d: dayK, id: slot.id, full: slot.full}, updatedAt: nowISO()};
  const i = db.study.sessions.findIndex(x => x.id === sid);
  if (i >= 0) db.study.sessions[i] = rec; else db.study.sessions.push(rec);
  return setMark(dayK, slot.id, 'none') ? ['study', 'tt'] : ['study'];
}
function dropSession(dayK, slot) {
  const S = db.study.sessions.find(x => x.id === slotSessionId(dayK, slot.id));
  if (S && !(S.deleted && !S.covered)) { S.deleted = true; delete S.covered; S.updatedAt = nowISO(); return true; }
  return false;
}
function markSkip(dayK, slot) { const a = dropSession(dayK, slot), b = setMark(dayK, slot.id, 'skip'); return [a && 'study', b && 'tt'].filter(Boolean); }
function markClear(dayK, slot) { const a = dropSession(dayK, slot), b = setMark(dayK, slot.id, 'none'); return [a && 'study', b && 'tt'].filter(Boolean); }
function stateHTML(x, slot) {
  if (x.st === 'done') return `<b>やった</b>${dur(x.sec)}`;
  if (x.st === 'skip') return `<b>やってない</b>`;
  if (x.st === 'run') return `<b>計った</b>${x.sec >= 60 ? dur(x.sec) : ''}`;
  if (x.st === 'now') return `<span class="tag">いま</span>`;
  return '';
}
function slotRow(dayK, slot, x) {
  const k = keyOf(dayK, slot.id), edit = editing.has(k), open = x.st === 'pending' || edit;
  const actual = x.st === 'done' && x.subjectId && x.subjectId !== slot.subjectId;
  const sid = actual ? x.subjectId : slot.subjectId;
  let acts = '';
  if (open) {
    acts = `<div class="acts"><button type="button" class="tool fill" data-sact="done">やった</button><button type="button" class="tool" data-sact="skip">やってない</button><button type="button" class="tool" data-sact="alt" aria-expanded="${altFor === k}">科目が違う</button>${edit ? `<button type="button" class="tool" data-sact="clear">印を外す</button>` : ''}${altFor === k ? `<div class="chips" role="radiogroup" aria-label="やった科目">${subjChips(null, 'data-alt')}</div>` : ''}</div>`;
  }
  const canEdit = x.st === 'done' || x.st === 'skip' || x.st === 'run';
  return `<li class="slot" data-st="${x.st}" data-day="${dayK}" data-slot="${esc(slot.id)}">
    <span class="tm">${slotLine(slot)}</span>
    <span class="sj">${dotHTML(sid)}${esc(subjName(sid))}${actual ? `<small>予定は${esc(subjName(slot.subjectId))}</small>` : slot.memo ? `<small>${esc(slot.memo)}</small>` : ''}</span>
    <span class="st">${stateHTML(x, slot)}${canEdit ? `<button type="button" class="linkbtn" data-sact="edit">${edit ? '閉じる' : '直す'}</button>` : ''}</span>${acts}</li>`;
}
function renderSlots() {
  const box = $('tdSlots');
  if (!liveTables(db.tt).length) { box.hidden = true; box.innerHTML = ''; return; }
  const now = Date.now(), today = todayKey(), sessions = db.study.sessions;
  const past = pendingDays(db.tt, sessions, now, 6).filter(d => d.dayK !== today);
  let html = '';
  if (past.length) {
    html += `<div class="chead"><span>前の日の、答えていないコマ</span><span class="num warnt">${past.reduce((t, d) => t + d.slots.length, 0)}</span></div>`;
    html += past.map(d => `<div class="dayhead"><span>${md(d.dayK)}（${weekday(d.dayK)}）・${d.slots.length}コマ</span><span class="tools"><button type="button" class="tool fill" data-bulk="done" data-day="${d.dayK}">全部やった</button><button type="button" class="tool" data-bulk="skip" data-day="${d.dayK}">全部やってない</button></span></div>
      <details class="fold"${d.slots.some(s => editing.has(keyOf(d.dayK, s.id)) || altFor === keyOf(d.dayK, s.id)) || openDays.has(d.dayK) ? ' open' : ''} data-pastday="${d.dayK}"><summary>1コマずつ答える</summary><ul class="slots">${d.slots.map(s => slotRow(d.dayK, s, {st: 'pending', sec: 0})).join('')}</ul></details>`).join('');
  }
  const rows = slotsFor(db.tt, today).map(s => ({s, x: slotState(db.tt, sessions, today, s, now)}));
  if (rows.length) {
    const ok = rows.filter(r => r.x.st === 'done' || r.x.st === 'run').length, ended = rows.filter(r => r.s.endMs <= now).length;
    html += `<div class="chead"><span>今日のコマ</span><span class="num">${ok}<small>コマやった${ended ? `（終わった${ended}コマのうち）` : ''}・全${rows.length}コマ</small></span></div>
      <div class="daystrip" role="img" aria-label="今日のコマの進み具合">${rows.map(r => `<i data-st="${r.x.st}" style="--w:${r.s.full}" title="${slotLine(r.s)} ${esc(subjName(r.s.subjectId))}"></i>`).join('')}</div>
      <ul class="slots">${rows.map(r => slotRow(today, r.s, r.x)).join('')}</ul>`;
  } else {
    html += `<div class="chead"><span>今日のコマ</span></div><p class="note">今日（${weekday(today)}曜）の時間割にはコマがありません。</p>`;
  }
  box.innerHTML = html; box.hidden = false;
}
const openDays = new Set();
export function pendingCount() {
  if (!liveTables(db.tt).length) return 0;
  return pendingDays(db.tt, db.study.sessions, Date.now(), 6).reduce((t, d) => t + d.slots.length, 0);
}

// ---------- 今日のノルマ ----------
function renderBooks() {
  const bs = liveBooks(db.study).map(b => ({b, x: bookInfo(b)})).filter(r => !r.x.finished);
  const order = r => r.x.late ? 0 : r.x.todayLeft ? 1 : 2;
  bs.sort((p, q) => order(p) - order(q) || (p.b.deadline < q.b.deadline ? -1 : 1));
  const left = bs.filter(r => r.x.late || r.x.todayLeft).length;
  let html = `<div class="chead"><span>今日のノルマ</span>${bs.length ? `<span class="num">${left ? `あと ${left}<small>冊</small>` : '<span class="okt">終わり</span>'}</span>` : ''}</div>`;
  if (!liveBooks(db.study).length) html += `<p class="note">教材がまだありません。<button type="button" class="linkbtn" data-goto="settings:books">設定で教材を足す</button>と、締め切りから今日やる量が出ます。</p>`;
  else if (!bs.length) html += `<p class="note okt">教材は全部終わっています。</p>`;
  else html += bs.map(({b, x}) => {
    const u = esc(b.unit), pc = Math.min(100, x.done * 100 / (b.total || 1));
    const q = x.late ? `<b class="bad">締め切りを過ぎています</b>（残り ${x.rest}${u}）` : !x.todayLeft ? `<b class="ok">今日の分は終わり</b>（今日 ${x.doneToday}${u}）` : `<b>今日あと ${x.todayLeft}${u}</b>（ノルマ ${x.quota}・やった ${x.doneToday}）`;
    return `<div class="quota" data-bid="${b.id}"><span class="qn">${dotHTML(b.subjectId)}${esc(b.name)}</span><span class="qb"><button type="button" class="tool" data-add="-1" aria-label="${esc(b.name)}を1${u}減らす">−</button><button type="button" class="tool fill" data-add="1" aria-label="${esc(b.name)}を1${u}進める">＋1</button></span>
      <span class="qs">${q}・全体 ${x.done}/${b.total}${u}・締め切り ${md(b.deadline)}</span><div class="bar"><i style="width:${pc}%;background:${subjColor(b.subjectId)}"></i></div></div>`;
  }).join('');
  $('tdBooks').innerHTML = html;
}
function addProgress(id, n) {
  const b = db.study.books.find(x => x.id === id); if (!b || !n) return;
  const k = todayKey(); const e = b.log.find(x => x.d === k);
  if (!e && n < 0) { toast('今日の分はまだ足していません。前の日の分は、設定の教材ノルマで直せます。'); return; }
  if (e) e.n += n; else b.log.push({d: k, n});
  if (e && e.n === 0) b.log = b.log.filter(x => x !== e);
  b.updatedAt = nowISO(); changed('study'); renderBooks();
}

// ---------- 講座の次の1本 ----------
function renderKouza() {
  const items = db.kouza.items, hide = new Set(ui.hideCourses || []);
  const rows = [];
  for (const c of COURSES) {
    if (hide.has(c.id)) continue;
    for (const st of STAGES) {
      const it = nextOf(items, c, st.bit);
      if (!it) continue;
      rows.push(`<li class="next"><span class="stg ${st.k}">${st.name}</span><span class="nm">${c.num ? `${String(it.n).padStart(3, '0')} ` : ''}${esc(it.label)}<small>${esc(c.name)}${c.num ? '・' + esc(it.section) : ''}</small></span><button type="button" class="tool" data-kz="${c.id}:${it.n}:${st.bit}">${st.act}</button></li>`);
    }
  }
  const shown = COURSES.filter(c => !hide.has(c.id)).length;
  $('tdKouza').innerHTML = `<div class="chead"><span>講座の次の1本</span><button type="button" class="linkbtn" data-goto="record:kouza">全部の表</button></div>` +
    (rows.length ? `<ul class="nexts">${rows.join('')}</ul>` : shown ? `<p class="note okt">出している講座は全部終わっています。</p>` : `<p class="note">「今日」に出す講座がありません。<button type="button" class="linkbtn" data-goto="settings:kouza">設定で選ぶ</button></p>`);
}
function markKouza(cid, n, bit) {
  const c = COURSE[cid]; if (!c) return;
  if (!setBit(db.kouza.items, cid, n, bit, true, nowISO())) return;
  changed('kouza'); renderKouza();
  const it = flatItems(c).find(x => x.n === n), st = STAGES.find(s => s.bit === bit);
  toast(`${c.name} ${it ? it.label : n} を「${st.name}」にしました`, () => { setBit(db.kouza.items, cid, n, bit, false, nowISO()); changed('kouza'); renderKouza(); });
}

// ---------- まとめ ----------
export function render() {
  renderSum(); renderRun(); renderSlots(); renderBooks(); renderKouza();
}
export function init() {
  $('tdMode').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (!b || run) return; ui.mode = b.dataset.mode; saveUI(); $('runMsg').textContent = ''; renderRun(); });
  $('runBtns').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const act = b.dataset.act;
    if (act === 'start-free') startFree();
    if (act === 'start-slot') startSlot('cur');
    if (act === 'start-next') startSlot('next');
    if (act === 'to-free') { ui.mode = 'free'; saveUI(); renderRun(); }
    if (act === 'make-tt') nav.goto('settings', 'tt');
    if (act === 'pause' && run) { run.acc += Date.now() - run.resumedAt; run.paused = true; saveRun(); keepAwake(false); renderRun(); }
    if (act === 'resume' && run) { unlockAudio(); run.resumedAt = Date.now(); run.paused = false; saveRun(); if (ui.awake) keepAwake(true); renderRun(); }
    if (act === 'finish') finishRun(false);
    if (act === 'discard') { if (!armed(b)) return; run = null; saveRun(); keepAwake(false); $('runMsg').textContent = '記録せずに消しました。'; $('runMemo').value = ''; render(); }
  });
  $('subjChips').addEventListener('click', e => { const b = e.target.closest('[data-subj]'); if (!b || run) return; ui.subj = b.dataset.subj; saveUI(); renderRun(); });
  $('runModes').addEventListener('click', e => { const b = e.target.closest('[data-rmode]'); if (!b || run) return; ui.runMode = b.dataset.rmode; saveUI(); renderRun(); });
  $('presets').addEventListener('click', e => { const b = e.target.closest('[data-min]'); if (!b) return; ui.timerMin = +b.dataset.min; saveUI(); renderRun(); });
  $('timerMin').addEventListener('input', () => { ui.timerMin = +$('timerMin').value || 0; saveUI(); $$('#presets [data-min]').forEach(x => x.setAttribute('aria-checked', String(+x.dataset.min === ui.timerMin))); tick(true); });
  $('runMemo').addEventListener('input', () => { if (run) { run.memo = $('runMemo').value; saveRun(); } });
  $('awake').addEventListener('change', () => { ui.awake = $('awake').checked; saveUI(); keepAwake(wantAwake()); });

  $('tdSlots').addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.pastday) { d.open ? openDays.add(d.dataset.pastday) : openDays.delete(d.dataset.pastday); } }, true);
  $('tdSlots').addEventListener('click', e => {
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) {
      const d = bulk.dataset.day, now = Date.now();
      const slots = slotsFor(db.tt, d).filter(s => slotState(db.tt, db.study.sessions, d, s, now).st === 'pending');
      if (!slots.length) return;
      if (!armed(bulk, bulk.dataset.bulk === 'done' ? `${slots.length}コマを「やった」にする` : `${slots.length}コマを「やってない」にする`)) return;
      const names = new Set();
      slots.forEach(s => (bulk.dataset.bulk === 'done' ? markDone(d, s) : markSkip(d, s)).forEach(n => names.add(n)));
      if (names.size) changed(...names);
      render(); return;
    }
    const li = e.target.closest('li.slot'); if (!li) return;
    const d = li.dataset.day, slot = slotsFor(db.tt, d).find(s => s.id === li.dataset.slot); if (!slot) return;
    const k = keyOf(d, slot.id);
    const alt = e.target.closest('[data-alt]');
    let names = null;
    if (alt) names = markDone(d, slot, alt.dataset.alt);
    else {
      const b = e.target.closest('[data-sact]'); if (!b) return; const act = b.dataset.sact;
      if (act === 'edit') { editing.has(k) ? editing.delete(k) : editing.add(k); if (altFor === k) altFor = null; renderSlots(); return; }
      if (act === 'alt') { altFor = altFor === k ? null : k; renderSlots(); return; }
      if (act === 'done') names = markDone(d, slot);
      if (act === 'skip') names = markSkip(d, slot);
      if (act === 'clear') names = markClear(d, slot);
    }
    if (!names) return;
    editing.delete(k); if (altFor === k) altFor = null;
    if (names.length) changed(...names);
    render();
  });
  $('tdBooks').addEventListener('click', e => { const a = e.target.closest('[data-add]'); if (!a) return; addProgress(a.closest('[data-bid]').dataset.bid, +a.dataset.add); });
  $('tdKouza').addEventListener('click', e => { const b = e.target.closest('[data-kz]'); if (!b) return; const [cid, n, bit] = b.dataset.kz.split(':'); markKouza(cid, +n, +bit); });

  if (run && run.mode === 'timer' && activeMs() >= run.target) finishRun(true); // 閉じている間にタイマーが終わっていた
  else if (run) keepAwake(wantAwake());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(wantAwake()); });
}
