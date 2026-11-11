// 「設定」の画面：保存先、時間割、知らせ、教材ノルマ、目標と科目、過去問の配点、今日に出す講座
import { $, $$, armed, typingIn, unlockAudio } from './dom.js';
import { db, ui, saveUI, changed, gh, saveGh, ghReady, checkGh, syncAll } from './store.js';
import { esc, nowISO, uid, todayKey, md, dur, fmtN, weekdayIdx, hmToMin, minToHm, WD } from './util.js';
import { liveTables, activeTable, sortSlots, overlaps, slotMinutes } from './tt.js';
import { UNITS, liveBooks, bookInfo, COURSES, liveAttempts } from './calc.js';
import { subj, subjColor, dotHTML, subjOptions } from './shared.js';
import * as notify from './notify.js';

const SPARE = ['#a16207', '#be185d', '#4d7c0f', '#0369a1', '#7c2d12', '#4338ca'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 月〜日

// ================= 時間割 =================
let edTable = null, edDay = weekdayIdx(todayKey()), copyTo = new Set(), showNew = false, showGen = false;
const tableById = id => db.tt.tables.find(t => t.id === id && !t.deleted);
const touchTable = t => { t.updatedAt = nowISO(); changed('tt'); };
const dayTotal = list => list.reduce((t, s) => t + slotMinutes(s), 0);
function newSlot(list) {
  const last = sortSlots(list).slice(-1)[0];
  const s = last ? hmToMin(last.e) + 10 : 6 * 60;
  return {id: 's' + uid(), s: minToHm(s), e: minToHm(s + 90), subjectId: last ? last.subjectId : (db.study.subjects[0]?.id || ''), memo: '', c: todayKey()};
}
function renderTT() {
  const box = $('ttEditor'), today = todayKey();
  const tables = liveTables(db.tt).slice().sort((a, b) => (a.from || '') < (b.from || '') ? -1 : 1);
  const active = activeTable(db.tt, today);
  $('ttState').textContent = !tables.length ? 'まだありません' : active ? `今日は${(active.days[weekdayIdx(today)] || []).length}コマ` : `${md(tables[0].from)}から`;
  if (!tables.length) {
    box.innerHTML = `<p class="note">曜日ごとにコマ（何時から何時まで、何の科目か）を入れておくと、「今日」の画面にその日のコマが出ます。コマが終わったら「やった／やってない／科目が違う」を押すだけで記録になります。</p>
      <button type="button" class="primary" data-tt="create">時間割を作る</button>`;
    return;
  }
  if (!tableById(edTable)) edTable = (active || tables[0]).id;
  const t = tableById(edTable), list = sortSlots(t.days[edDay] || []), bad = overlaps(list);
  const label = x => `${x.from} から${active && x.id === active.id ? '（いま使っている）' : x.from > today ? '（これから）' : '（前の）'}`;
  box.innerHTML = `
    <div class="field"><label class="flabel" for="ttTable">どの時間割を直すか</label><select id="ttTable">${tables.map(x => `<option value="${x.id}"${x.id === t.id ? ' selected' : ''}>${label(x)}</option>`).join('')}</select></div>
    <div class="tools"><button type="button" class="tool" data-tt="new-toggle" aria-expanded="${showNew}">切り替え日を決めて、別の時間割を足す</button><button type="button" class="tool danger" data-tt="del-table">この時間割を消す</button></div>
    ${showNew ? `<div class="cfgsub"><div class="field"><label class="flabel" for="ttNewFrom">いつから切り替えるか</label><input type="date" id="ttNewFrom" value="${nextMonthFirst()}"></div>
      <label class="check"><input type="checkbox" id="ttNewCopy" checked> いま開いている時間割を写して始める</label>
      <div class="tools"><button type="button" class="tool fill" data-tt="new-ok">足す</button></div>
      <p class="note">例：12月1日から共テ向けの配分にするなら、12月1日を選んで足し、中身を直します。その日が来ると自動で切り替わります。</p></div>` : ''}
    <div class="field"><label class="flabel" for="ttFrom">この時間割を使い始める日</label><input type="date" id="ttFrom" value="${t.from || ''}"></div>
    <div class="wdtabs" role="tablist" aria-label="曜日">${WD_ORDER.map(w => { const m = dayTotal(t.days[w] || []); return `<button type="button" class="mini" role="tab" data-wd="${w}" aria-selected="${w === edDay}">${WD[w]}<small>${m ? fmtN(m / 60) : '–'}</small></button>`; }).join('')}</div>
    <div class="ttrows">${list.length ? list.map(s => `<div class="ttrow${bad.has(s.id) ? ' bad' : ''}" data-id="${s.id}">
      <input type="time" data-f="s" value="${esc(s.s)}" aria-label="始まる時刻"><input type="time" data-f="e" value="${esc(s.e)}" aria-label="終わる時刻">
      <select data-f="subjectId" aria-label="科目">${subjOptions(s.subjectId)}${subj(s.subjectId) ? '' : `<option value="${esc(s.subjectId)}" selected>（消した科目）</option>`}</select>
      <button type="button" class="tool sm danger del" data-tt="del-slot">消す</button>
      <input type="text" class="memo" data-f="memo" value="${esc(s.memo || '')}" placeholder="メモ（例：河野塾 数B）" aria-label="メモ"></div>`).join('') : `<p class="empty">${WD[edDay]}曜のコマはまだありません。</p>`}</div>
    <div class="ttsum"><span>${WD[edDay]}曜：${list.length}コマ・合計 ${dur(dayTotal(list) * 60)}</span>${bad.size ? '<span class="badt">時間が重なっているコマがあります</span>' : ''}</div>
    <div class="tools"><button type="button" class="tool fill" data-tt="add-slot">コマを足す</button><button type="button" class="tool" data-tt="gen-toggle" aria-expanded="${showGen}">まとめて作る</button></div>
    ${showGen ? `<div class="cfgsub"><div class="row2"><div class="field"><label class="flabel" for="genS">始める時刻</label><input type="time" id="genS" value="06:00"></div><div class="field"><label class="flabel" for="genE">終える時刻</label><input type="time" id="genE" value="21:30"></div></div>
      <div class="row2"><div class="field"><label class="flabel" for="genLen">1コマの長さ（分）</label><input type="number" inputmode="numeric" id="genLen" value="90" min="10" max="300"></div><div class="field"><label class="flabel" for="genGap">間の休み（分）</label><input type="number" inputmode="numeric" id="genGap" value="10" min="0" max="120"></div></div>
      <div class="tools"><button type="button" class="tool fill" data-tt="gen-ok">${list.length ? `${WD[edDay]}曜のコマを消して作り直す` : `${WD[edDay]}曜のコマを作る`}</button></div>
      <p class="note">同じ長さのコマを並べます。科目はあとで1つずつ選び直してください。食事などで空ける時間は、できたコマを消すか時刻を直します。</p></div>` : ''}
    <div class="field"><span class="flabel">${WD[edDay]}曜のコマを、ほかの曜日に写す</span>
      <div class="chips">${WD_ORDER.filter(w => w !== edDay).map(w => `<button type="button" class="chip" aria-pressed="${copyTo.has(w)}" data-copy="${w}">${WD[w]}</button>`).join('')}<button type="button" class="chip" data-copy="all">全部</button></div>
      <div class="tools"><button type="button" class="tool" data-tt="copy-ok"${copyTo.size && list.length ? '' : ' disabled'}>選んだ曜日に写す（その曜日のコマは置き換わる）</button></div></div>
    <p class="msg" id="ttMsg" role="status">${esc(ttMsg)}</p>`;
  ttMsg = '';
}
let ttMsg = '';
const nextMonthFirst = () => { const d = new Date(); return `${d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear()}-${String((d.getMonth() + 1) % 12 + 1).padStart(2, '0')}-01`; };
function initTT() {
  const box = $('ttEditor');
  box.addEventListener('click', e => {
    const wd = e.target.closest('[data-wd]'); if (wd) { edDay = +wd.dataset.wd; copyTo.clear(); showGen = false; renderTT(); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) { if (cp.dataset.copy === 'all') { const all = WD_ORDER.filter(w => w !== edDay); if (all.every(w => copyTo.has(w))) copyTo.clear(); else all.forEach(w => copyTo.add(w)); } else { const w = +cp.dataset.copy; copyTo.has(w) ? copyTo.delete(w) : copyTo.add(w); } renderTT(); return; }
    const b = e.target.closest('[data-tt]'); if (!b) return; const act = b.dataset.tt;
    if (act === 'create') {
      const t = {id: 't' + uid(), name: '', from: todayKey(), days: {0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []}, updatedAt: nowISO()};
      db.tt.tables.push(t); edTable = t.id; changed('tt'); renderTT(); return;
    }
    const t = tableById(edTable); if (!t) return;
    if (act === 'new-toggle') { showNew = !showNew; renderTT(); return; }
    if (act === 'gen-toggle') { showGen = !showGen; renderTT(); return; }
    if (act === 'new-ok') {
      const from = $('ttNewFrom').value;
      if (!from) { ttMsg = '切り替える日を入れてください。'; renderTT(); return; }
      if (liveTables(db.tt).some(x => x.from === from)) { ttMsg = 'その日から始まる時間割はもうあります。'; renderTT(); return; }
      const days = {};
      for (let w = 0; w < 7; w++) days[w] = $('ttNewCopy').checked ? (t.days[w] || []).map(s => Object.assign({}, s, {id: 's' + uid() + w, c: todayKey()})) : [];
      const nt = {id: 't' + uid(), name: '', from, days, updatedAt: nowISO()};
      db.tt.tables.push(nt); edTable = nt.id; showNew = false; ttMsg = `${from} からの時間割を足しました。中身を直してください。`; changed('tt'); renderTT(); return;
    }
    if (act === 'del-table') { if (!armed(b, 'もう一度押すと、この時間割を消します')) return; t.deleted = true; touchTable(t); edTable = null; ttMsg = '時間割を消しました。付けた記録は残ります。'; renderTT(); return; }
    if (act === 'add-slot') { (t.days[edDay] || (t.days[edDay] = [])).push(newSlot(t.days[edDay] || [])); touchTable(t); renderTT(); return; }
    if (act === 'del-slot') { const id = b.closest('.ttrow').dataset.id; t.days[edDay] = (t.days[edDay] || []).filter(s => s.id !== id); touchTable(t); renderTT(); return; }
    if (act === 'gen-ok') {
      const a = hmToMin($('genS').value || '06:00'), len = Math.round(+$('genLen').value), gap = Math.round(+$('genGap').value || 0);
      let z = hmToMin($('genE').value || '21:30'); if (z <= a) z += 1440;
      if (!(len >= 10 && len <= 300) || gap < 0) { ttMsg = '1コマの長さは10〜300分で入れてください。'; renderTT(); return; }
      if ((t.days[edDay] || []).length && !armed(b, 'もう一度押すと、いまのコマを消して作り直します')) return;
      const sid = db.study.subjects[0]?.id || '', out = [];
      for (let m = a, i = 0; m + len <= z && i < 40; m += len + gap, i++) out.push({id: 's' + uid() + i, s: minToHm(m), e: minToHm(m + len), subjectId: sid, memo: '', c: todayKey()});
      t.days[edDay] = out; showGen = false; ttMsg = `${out.length}コマを作りました。科目を選び直してください。`; touchTable(t); renderTT(); return;
    }
    if (act === 'copy-ok') {
      const src = t.days[edDay] || []; if (!src.length || !copyTo.size) return;
      if (!armed(b, 'もう一度押すと写します')) return;
      for (const w of copyTo) t.days[w] = src.map((s, i) => Object.assign({}, s, {id: 's' + uid() + w + i, c: todayKey()}));
      ttMsg = `${[...copyTo].sort((x, y) => WD_ORDER.indexOf(x) - WD_ORDER.indexOf(y)).map(w => WD[w]).join('・')}曜に写しました。`; copyTo.clear(); touchTable(t); renderTT();
    }
  });
  box.addEventListener('change', e => {
    if (e.target.id === 'ttTable') { edTable = e.target.value; showNew = false; copyTo.clear(); renderTT(); return; }
    const t = tableById(edTable); if (!t) return;
    if (e.target.id === 'ttFrom') {
      const v = e.target.value;
      if (!v) { e.target.value = t.from || ''; return; }
      if (liveTables(db.tt).some(x => x.id !== t.id && x.from === v)) { ttMsg = 'その日から始まる時間割はもうあります。'; renderTT(); return; }
      t.from = v; touchTable(t); renderTT(); return;
    }
    const row = e.target.closest('.ttrow'), f = e.target.dataset.f; if (!row || !f) return;
    const s = (t.days[edDay] || []).find(x => x.id === row.dataset.id); if (!s) return;
    if ((f === 's' || f === 'e') && !e.target.value) { e.target.value = s[f]; return; }
    s[f] = f === 'memo' ? e.target.value.trim() : e.target.value;
    touchTable(t);
    if (f !== 'memo') renderTT(); // 時刻を変えたら並べ直す
  });
}

// ================= 教材ノルマ =================
let bookEditing = null;
function fillBookForm() {
  $('bSubj').innerHTML = subjOptions(subj($('bSubj').value) ? $('bSubj').value : (subj(ui.subj) ? ui.subj : db.study.subjects[0]?.id));
  if (!$('bUnit').options.length) $('bUnit').innerHTML = UNITS.map(u => `<option>${u}</option>`).join('');
}
function resetBookForm() {
  bookEditing = null; fillBookForm(); $('bName').value = ''; $('bTotal').value = ''; $('bDone').value = ''; $('bDeadline').value = '';
  $('bUnit').value = '問'; $('bSave').textContent = '足す'; $('bCancel').hidden = true; $('bDel').hidden = true; $('bookTitle').textContent = '教材を足す';
}
function bookCard(b) {
  const x = bookInfo(b), u = esc(b.unit), s = subj(b.subjectId), pc = Math.min(100, x.done * 100 / (b.total || 1));
  let q;
  if (x.finished) q = '<span class="bq ok">全部終わり</span>';
  else if (x.late) q = `<span class="bq bad">締め切りを過ぎています（残り ${x.rest}${u}）</span>`;
  else if (!x.todayLeft) q = `<span class="bq ok">今日の分は終わり（今日 ${x.doneToday}${u}）</span>`;
  else q = `<span class="bq warn">今日あと ${x.todayLeft}${u}</span><span class="note">（今日のノルマ ${x.quota}${u}・やった ${x.doneToday}${u}）</span>`;
  const eta = x.finished ? '' : x.pace > 0 ? `${x.span < 7 ? `足してからの${x.span}日` : '直近7日'}で1日 ${fmtN(x.pace)}${u}。このままだと ${md(x.eta)} に終わる${x.slow ? '（締め切りに間に合わない）' : ''}` : (x.span < 7 ? '足してからまだ進んでいません' : '直近7日は進んでいません');
  return `<div class="book" data-bid="${b.id}">
    <div class="atop"><span class="asub">${dotHTML(b.subjectId)}${esc(b.name)}<span class="tag muted">${esc(s ? s.name : '')}</span></span><span class="ascore">${x.done}<small>/ ${b.total}${u}</small></span></div>
    <div class="bar"><i style="width:${pc}%;background:${subjColor(b.subjectId)}"></i></div>
    <div class="ameta">${Math.floor(pc)}%・締め切り ${md(b.deadline)}${x.daysLeft > 0 ? `（今日を入れてあと${x.daysLeft}日）` : ''}</div>
    <div class="tools">${q}</div>
    <div class="ameta${x.slow ? ' warnt' : ''}">${eta}</div>
    <div class="badd"><button type="button" class="tool sm" data-add="-1">−1</button><button type="button" class="tool sm" data-add="1">＋1</button><input type="number" inputmode="numeric" min="1" placeholder="数" aria-label="${esc(b.name)}に足す数"><button type="button" class="tool sm" data-addn>足す</button><button type="button" class="tool sm" data-bedit>直す</button></div></div>`;
}
function renderBooks() {
  const bs = liveBooks(db.study).slice();
  const order = b => { const x = bookInfo(b); return x.finished ? 3 : x.late ? 0 : x.todayLeft ? 1 : 2; };
  bs.sort((a, b) => order(a) - order(b) || (a.deadline < b.deadline ? -1 : 1));
  $('bookState').textContent = bs.length ? `${bs.length}冊` : 'まだありません';
  if (typingIn($('bookList'))) return;
  $('bookList').innerHTML = bs.length ? bs.map(bookCard).join('') : '<p class="empty">教材がまだありません。上から足してください。</p>';
}
function addProgress(id, n) {
  const b = db.study.books.find(x => x.id === id); if (!b || !n) return;
  const k = todayKey(), e = b.log.find(x => x.d === k);
  if (e) e.n += n; else b.log.push({d: k, n});
  if (e && e.n === 0) b.log = b.log.filter(x => x !== e);
  b.updatedAt = nowISO(); changed('study'); renderBooks();
}
function initBooks() {
  $('bookList').addEventListener('click', e => {
    const box = e.target.closest('[data-bid]'); if (!box) return; const id = box.dataset.bid;
    const a = e.target.closest('[data-add]'); if (a) { addProgress(id, +a.dataset.add); return; }
    if (e.target.closest('[data-addn]')) { const inp = box.querySelector('input'), n = Math.round(+inp.value); inp.blur(); if (n) addProgress(id, n); return; }
    if (e.target.closest('[data-bedit]')) {
      const b = db.study.books.find(x => x.id === id); if (!b) return; fillBookForm();
      bookEditing = id; $('bookTitle').textContent = '教材を直す';
      $('bName').value = b.name; $('bSubj').value = b.subjectId; if (!UNITS.includes(b.unit)) $('bUnit').insertAdjacentHTML('beforeend', `<option>${esc(b.unit)}</option>`); $('bUnit').value = b.unit;
      $('bTotal').value = b.total; $('bDone').value = bookInfo(b).done; $('bDeadline').value = b.deadline;
      $('bSave').textContent = 'この教材を直す'; $('bCancel').hidden = false; $('bDel').hidden = false; $('bMsg').textContent = '';
      $('bookForm').scrollIntoView({block: 'start'});
    }
  });
  $('bookForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('bName').value.trim(), total = Math.round(+$('bTotal').value), doneNow = Math.round(+$('bDone').value || 0), dl = $('bDeadline').value;
    if (!name) { $('bMsg').textContent = '教材の名前を入れてください。'; return; }
    if (!(total >= 1)) { $('bMsg').textContent = '全部の量を1以上で入れてください。'; return; }
    if (doneNow < 0 || doneNow > total) { $('bMsg').textContent = '済んだ量は0から全部の量までで入れてください。'; return; }
    if (!dl) { $('bMsg').textContent = '締め切りの日を入れてください。'; return; }
    let b = bookEditing ? db.study.books.find(x => x.id === bookEditing) : null;
    if (!b) { b = {id: 'b' + uid(), log: [], created: todayKey()}; db.study.books.push(b); }
    const logged = b.log.reduce((t, x) => t + x.n, 0);
    Object.assign(b, {name, subjectId: $('bSubj').value, unit: $('bUnit').value, total, base: doneNow - logged, deadline: dl, updatedAt: nowISO()});
    $('bMsg').textContent = `${name}を${bookEditing ? '直しました' : '足しました'}。`;
    resetBookForm(); changed('study'); renderBooks();
  });
  $('bCancel').addEventListener('click', () => { resetBookForm(); $('bMsg').textContent = ''; });
  $('bDel').addEventListener('click', () => {
    if (!armed($('bDel'))) return;
    const b = db.study.books.find(x => x.id === bookEditing); if (b) { b.deleted = true; b.updatedAt = nowISO(); }
    $('bMsg').textContent = '消しました。'; resetBookForm(); changed('study'); renderBooks();
  });
}

// ================= 目標と科目 =================
function renderGoal() {
  $('goalState').textContent = `1日 ${fmtN(+db.study.goalH || 0)}時間`;
  if (typingIn($('set-goal'))) return;
  $('goalH').value = db.study.goalH; $('planStart').value = (db.study.plan && db.study.plan.start) || ''; $('planEnd').value = (db.study.plan && db.study.plan.end) || '2027-02-25';
  $('subjCfg').innerHTML = db.study.subjects.map(s => `<div class="srow" data-sid="${s.id}"><input type="color" value="${s.color}" data-f="color" aria-label="${esc(s.name)}の色"><input type="text" value="${esc(s.name)}" data-f="name" aria-label="科目名"><button type="button" class="tool sm danger" data-delsub>消す</button></div>`).join('');
}
function initGoal() {
  $('planStart').addEventListener('change', () => { db.study.plan = Object.assign({}, db.study.plan, {start: $('planStart').value || null}); db.study.planAt = nowISO(); changed('study'); renderGoal(); });
  $('planEnd').addEventListener('change', () => { if (!$('planEnd').value) return; db.study.plan = Object.assign({}, db.study.plan, {end: $('planEnd').value}); db.study.planAt = nowISO(); changed('study'); renderGoal(); });
  $('goalH').addEventListener('change', () => { db.study.goalH = Math.max(0, Math.min(24, +$('goalH').value || 0)); db.study.goalAt = nowISO(); changed('study'); renderGoal(); });
  $('subjCfg').addEventListener('change', e => {
    const row = e.target.closest('.srow'); if (!row) return; const s = subj(row.dataset.sid); if (!s) return;
    if (e.target.dataset.f === 'name') { const v = e.target.value.trim(); if (!v) { e.target.value = s.name; return; } s.name = v; }
    if (e.target.dataset.f === 'color') s.color = e.target.value;
    db.study.subjAt = nowISO(); changed('study');
  });
  $('subjCfg').addEventListener('click', e => {
    const b = e.target.closest('[data-delsub]'); if (!b) return;
    if (db.study.subjects.length <= 1 || !armed(b)) return;
    db.study.subjects = db.study.subjects.filter(s => s.id !== b.closest('.srow').dataset.sid); db.study.subjAt = nowISO(); changed('study'); renderGoal();
  });
  $('addSubj').addEventListener('click', () => {
    const used = db.study.subjects.map(s => s.color), c = SPARE.find(x => !used.includes(x)) || SPARE[db.study.subjects.length % SPARE.length];
    db.study.subjects.push({id: 's' + uid(), name: '新しい科目', color: c}); db.study.subjAt = nowISO(); changed('study'); renderGoal();
  });
}

// ================= 過去問の試験と配点 =================
const exam = id => db.scores.exams.find(e => e.id === id);
function parseParts(text) {
  const out = [];
  for (const line of text.split(/\n/)) {
    const t = line.trim(); if (!t) continue;
    const m = t.match(/^(.+?)\s*[:：]\s*(\d+(?:\.\d+)?)$/);
    if (!m) return {error: `「${t}」は「名前:満点」の形になっていません。`};
    out.push({name: m[1].trim(), max: +m[2]});
  }
  if (!out.length) return {error: '大問を1つ以上書いてください（大問に分けないなら「合計:100」のように1行）。'};
  return {parts: out};
}
function renderExams() {
  if (typingIn($('set-exams'))) return;
  $('kyoteRate').value = db.scores.kyoteRate;
  const keep = $('cfgExam').value;
  $('cfgExam').innerHTML = db.scores.exams.map(e => `<option value="${e.id}">${esc(e.name + (e.note ? `（${e.note}）` : ''))}</option>`).join('');
  if (exam(keep)) $('cfgExam').value = keep;
  const ex = exam($('cfgExam').value); if (!ex) { $('cfgSubjects').innerHTML = ''; return; }
  $('cfgSubjects').innerHTML = ex.subjects.map(s => `<div class="cfgsub" data-sid="${s.id}">
    <div class="row2"><div class="field"><label class="flabel">科目名</label><input type="text" data-f="name" value="${esc(s.name)}"></div>
    <div class="field"><label class="flabel">目標点</label><input type="number" inputmode="decimal" data-f="target" value="${s.target ?? ''}"></div></div>
    <div class="field"><label class="flabel">大問と満点${s.prov ? '<span class="tag warn">仮</span>' : ''}</label><textarea rows="${Math.min(10, s.parts.length + 1)}" data-f="parts">${esc(s.parts.map(p => `${p.name}:${p.max}`).join('\n'))}</textarea></div>
    <div class="cfgfoot"><span class="msg" data-msg></span><button type="button" class="tool danger" data-delexsub>この科目を消す</button></div></div>`).join('')
    || '<p class="note">科目がまだありません。「科目を足す」で入れてください。</p>';
}
function initExams() {
  $('kyoteRate').addEventListener('change', () => { db.scores.kyoteRate = Math.max(0, Math.min(100, +$('kyoteRate').value || 0)); db.scores.rateAt = nowISO(); changed('scores'); });
  $('cfgExam').addEventListener('change', () => { $('cfgExam').blur(); renderExams(); });
  $('cfgSubjects').addEventListener('change', e => {
    const box = e.target.closest('.cfgsub'); if (!box) return;
    const ex = exam($('cfgExam').value), s = ex.subjects.find(x => x.id === box.dataset.sid), msg = box.querySelector('[data-msg]'), f = e.target.dataset.f;
    if (f === 'name') { const v = e.target.value.trim(); if (!v) { msg.textContent = '科目名を入れてください。'; return; } s.name = v; }
    if (f === 'target') s.target = e.target.value === '' ? null : +e.target.value;
    if (f === 'parts') { const r = parseParts(e.target.value); if (r.error) { msg.textContent = r.error; return; } s.parts = r.parts; s.prov = false; const t = box.querySelector('.tag.warn'); if (t) t.remove(); }
    msg.textContent = '保存しました'; db.scores.examsAt = nowISO(); changed('scores');
  });
  $('cfgSubjects').addEventListener('click', e => {
    const b = e.target.closest('[data-delexsub]'); if (!b) return;
    const box = b.closest('.cfgsub'), ex = exam($('cfgExam').value);
    const used = liveAttempts(db.scores).some(a => a.examId === ex.id && a.subjectId === box.dataset.sid);
    if (!armed(b, used ? '記録は残ります。もう一度押すと消します' : 'もう一度押すと消します')) return;
    ex.subjects = ex.subjects.filter(x => x.id !== box.dataset.sid); db.scores.examsAt = nowISO(); changed('scores'); renderExams();
  });
  $('addExSubj').addEventListener('click', () => {
    const ex = exam($('cfgExam').value); if (!ex) return;
    ex.subjects.push({id: 's' + uid(), name: '新しい科目', target: null, prov: false, parts: [{name: '合計', max: 100}]});
    db.scores.examsAt = nowISO(); changed('scores'); renderExams();
  });
}

// ================= 保存先・知らせ・講座・このアプリ =================
function renderMisc() {
  $('ghState').textContent = ghReady() ? '入れてあります' : 'まだ入れていません';
  if (!typingIn($('ghForm'))) { $('owner').value = gh.owner; $('repo').value = gh.repo; $('token').value = gh.token; }
  $('alStart').checked = !!ui.alertStart; $('alEnd').checked = !!ui.alertEnd; $('alSound').checked = !!ui.alertSound;
  const p = notify.permission();
  $('alertState').textContent = (ui.alertStart || ui.alertEnd) ? '入' : '切';
  $('alPerm').hidden = p === 'granted' || p === 'unsupported';
  if (!$('alMsg').textContent) $('alMsg').textContent = p === 'granted' ? '通知は許可されています。' : p === 'denied' ? '通知が止められています。端末やブラウザの設定で、このアプリの通知を許可してください。画面の中の知らせと音は出ます。' : p === 'unsupported' ? 'この開き方では通知が使えません（iPhone はホーム画面に追加したアプリで開くと使えます）。画面の中の知らせと音は出ます。' : '';
  const hide = new Set(ui.hideCourses || []);
  $('kzShow').innerHTML = COURSES.map(c => `<label class="check"><input type="checkbox" data-course="${c.id}"${hide.has(c.id) ? '' : ' checked'}> ${esc(c.full || c.name)}</label>`).join('');
}
function initMisc(onGh) {
  $('ghForm').addEventListener('submit', async e => {
    e.preventDefault();
    saveGh({owner: $('owner').value.trim(), repo: $('repo').value.trim(), token: $('token').value.trim()});
    $('ghMsg').textContent = '確かめています…';
    const r = await checkGh();
    $('ghMsg').textContent = r.msg; renderMisc();
    if (onGh) onGh(r.ok);
  });
  const bind = (id, key) => $(id).addEventListener('change', () => { ui[key] = $(id).checked; saveUI(); renderMisc(); });
  bind('alStart', 'alertStart'); bind('alEnd', 'alertEnd'); bind('alSound', 'alertSound');
  $('alPerm').addEventListener('click', async () => { unlockAudio(); const p = await notify.askPermission(); $('alMsg').textContent = p === 'granted' ? '通知を許可しました。' : ''; renderMisc(); });
  $('alTest').addEventListener('click', () => { unlockAudio(); notify.fire('知らせの確認', 'コマの始まりと終わりに、このように出ます。', 'test'); });
  $('icsBtn').addEventListener('click', async () => { $('icsMsg').textContent = await notify.shareICS(); });
  $('kzShow').addEventListener('change', e => { const c = e.target.dataset.course; if (!c) return; const s = new Set(ui.hideCourses || []); e.target.checked ? s.delete(c) : s.add(c); ui.hideCourses = [...s]; saveUI(); });
  $('syncNow').addEventListener('click', async () => { $('aboutMsg').textContent = '同期しています…'; const ok = await syncAll(); $('aboutMsg').textContent = !ghReady() ? '先に保存先（鍵）を入れてください。' : ok ? '同期しました。' : '同期できませんでした。電波と鍵を確認してください。'; });
  $('reloadApp').addEventListener('click', async () => {
    $('aboutMsg').textContent = '最新のものを取りに行きます…';
    try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith('new-app')).map(k => caches.delete(k))); } } catch (e) {}
    location.reload();
  });
}

export function render() { renderMisc(); if (!typingIn($('ttEditor'))) renderTT(); renderBooks(); renderGoal(); renderExams(); }
export function open(section) {
  const d = $('set-' + section); if (!d) return;
  $$('#view-settings details.fold').forEach(x => { if (x !== d) x.open = false; });
  d.open = true; setTimeout(() => d.scrollIntoView({block: 'start'}), 0);
}
export function init(onGh) { initTT(); initBooks(); initGoal(); initExams(); initMisc(onGh); resetBookForm(); }
