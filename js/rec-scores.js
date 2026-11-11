// 「記録」→ 過去問：点数を入れる（大問ごとの時間も計れる）、推移、消化表、記録の一覧
import { $, $$, armed, nav } from './dom.js';
import { db, ui, saveUI, changed } from './store.js';
import { esc, nowISO, uid, fmtN as fmt, pct, clock, dateKey } from './util.js';
import { TODAI_SUBJ, maxOf, sumOf, liveAttempts, yearKey, newestAttempt } from './calc.js';
import * as send from './send.js';

const exam = id => db.scores.exams.find(e => e.id === id);
const subj = (eid, sid) => (exam(eid)?.subjects || []).find(s => s.id === sid);
const live = () => liveAttempts(db.scores);
const examLabel = e => e.name + (e.note ? `（${e.note}）` : '');
const shortOf = s => s.short || s.name.slice(0, 2);
const localDate = () => dateKey(new Date());

// ---------- 年度・回の選び方（得点記録アプリと同じ） ----------
const TOP_YEAR = (() => { const d = new Date(); return d.getMonth() >= 2 ? d.getFullYear() : d.getFullYear() - 1; })();
const range = (a, b) => { const o = []; if (a >= b) for (let i = a; i >= b; i--) o.push(i); else for (let i = a; i <= b; i++) o.push(i); return o; };
const KYOTE_KINDS = ['本試', '追試', 'Z会', '駿台', '河合'];
const KYOTE_FIRST = 2021, OLDEST = 1990, FREE = '__free';
function labelsFor(eid, kind) {
  if (eid === 'kyote') return (kind === '本試' || kind === '追試') ? range(TOP_YEAR, KYOTE_FIRST).map(y => `${y}年度 ${kind}`) : range(1, 10).map(n => `${kind} 第${n}回`);
  return range(TOP_YEAR, OLDEST).map(y => `${y}年度`);
}
function parseLabel(eid, l) {
  if (eid === 'kyote') { let m = l.match(/^(\d{4})年度 (本試|追試)$/); if (m) return +m[1] <= TOP_YEAR && +m[1] >= KYOTE_FIRST ? {kind: m[2]} : null; m = l.match(/^(Z会|駿台|河合) 第(\d+)回$/); return m && +m[2] >= 1 && +m[2] <= 10 ? {kind: m[1]} : null; }
  const m = l.match(/^(\d{4})年度$/); return m && +m[1] <= TOP_YEAR && +m[1] >= OLDEST ? {kind: ''} : null;
}

// ---------- 記録する ----------
let editingId = null;
const solvedN = l => live().filter(a => a.examId === ui.exam && a.subjectId === ui.examSubj && a.label === l && a.id !== editingId).length;
const getLabel = () => $('yearPick').value === FREE ? $('yearFree').value.trim() : $('yearPick').value;
function fillPick(pref) {
  const isK = ui.exam === 'kyote';
  $('kindPick').hidden = !isK;
  if (isK) { if (!KYOTE_KINDS.includes(ui.kind)) ui.kind = '本試'; $('kindPick').innerHTML = KYOTE_KINDS.map(k => `<option value="${k}"${k === ui.kind ? ' selected' : ''}>${k}</option>`).join(''); }
  const labels = labelsFor(ui.exam, ui.kind);
  $('yearPick').innerHTML = labels.map(l => { const n = solvedN(l); return `<option value="${esc(l)}">${esc(l)}${n ? `（済${n > 1 ? '・' + n + '回' : ''}）` : ''}</option>`; }).join('') + `<option value="${FREE}">その他（自分で書く）</option>`;
  const v = pref === FREE ? FREE : (pref && labels.includes(pref) ? pref : (labels.find(l => !solvedN(l)) || labels[0]));
  $('yearPick').value = v; $('yearFree').hidden = v !== FREE;
}
function setLabel(l) {
  const p = parseLabel(ui.exam, l);
  if (p) { if (ui.exam === 'kyote') ui.kind = p.kind; fillPick(l); }
  else { fillPick(FREE); $('yearFree').value = l; }
  updateAttemptNote();
}
function renderExamChips() {
  const ex = exam(ui.exam) || db.scores.exams[0]; if (!ex) return; ui.exam = ex.id;
  $('examChips').innerHTML = db.scores.exams.map(e => `<button type="button" class="chip" role="radio" aria-checked="${e.id === ui.exam}" data-exam="${e.id}">${esc(e.name)}</button>`).join('');
  if (!ex.subjects.some(s => s.id === ui.examSubj)) ui.examSubj = ex.subjects[0]?.id || '';
  $('exSubjChips').innerHTML = ex.subjects.length
    ? ex.subjects.map(s => `<button type="button" class="chip" role="radio" aria-checked="${s.id === ui.examSubj}" data-exsubj="${s.id}">${esc(s.name)}</button>`).join('')
    : `<p class="note">この試験には科目がまだありません。設定の「過去問の試験と配点」で足してください。</p>`;
  fillPick($('yearPick').value || null);
  renderParts(currentScores());
}
function currentScores() { return $$('#parts input').map(x => x.value === '' ? null : +x.value); }
function renderParts(keep) {
  const s = subj(ui.exam, ui.examSubj);
  $('provNote').hidden = !(s && s.prov);
  if (!s) { $('parts').innerHTML = ''; updateSum(); renderTm(); return; }
  const old = keep || [], on = tmHere();
  $('parts').innerHTML = s.parts.map((p, i) => `<label class="part${on && tm.active === i ? ' now' : ''}"><span class="pn">${esc(p.name)}</span><input type="number" inputmode="decimal" min="0" max="${p.max}" step="any" data-i="${i}" value="${old[i] ?? ''}" aria-label="${esc(p.name)}の点数"><span class="pm">/ ${p.max}</span>${on ? `<button type="button" class="ptime" data-go="${i}" aria-label="${esc(p.name)}を解く"><span>${tm.active === i ? '解いている' : '時間'}</span><b data-pt="${i}">${clock(partMs(i))}</b></button>` : ''}</label>`).join('');
  updateSum(); updateAttemptNote(); renderTm();
}
// ---------- 大問ごとのタイマー（この端末だけ。閉じても時刻から数え直す） ----------
// tm = {exam, subj, acc:[ms], active:大問の番号|null, since:ms|null, done:bool, last}
const LS_TM = 'new-tm-v1';
let tm = null;
try { tm = JSON.parse(localStorage.getItem(LS_TM) || 'null'); } catch (e) {}
const saveTm = () => { try { tm ? localStorage.setItem(LS_TM, JSON.stringify(tm)) : localStorage.removeItem(LS_TM); } catch (e) {} };
const tmHere = () => !!(tm && tm.exam === ui.exam && tm.subj === ui.examSubj);
const partMs = i => tm ? (tm.acc[i] || 0) + (tm.active === i && tm.since ? Date.now() - tm.since : 0) : 0;
const totalMs = () => tm ? tm.acc.reduce((t, x, i) => t + partMs(i), 0) : 0;
function tmStop() { if (tm && tm.active != null && tm.since) tm.acc[tm.active] = (tm.acc[tm.active] || 0) + Date.now() - tm.since; if (tm) { tm.active = null; tm.since = null; } }
function tmGo(i) { if (!tm) return; tmStop(); tm.active = i; tm.since = Date.now(); tm.done = false; tm.last = i; saveTm(); renderParts(currentScores()); }
function renderTm() {
  const s = subj(ui.exam, ui.examSubj), box = $('tmBar');
  if (!s || editingId) { box.innerHTML = ''; return; }
  if (tm && !tmHere()) { box.innerHTML = `<p class="note">${esc((exam(tm.exam) || {}).name || '')} ${esc((subj(tm.exam, tm.subj) || {}).name || '')}の時間を計っています。その科目に戻すと続きが見られます。</p><div class="tools"><button type="button" class="tool danger" data-tm="cancel">その計測を消す</button></div>`; return; }
  if (!tm) { box.innerHTML = `<button type="button" class="tool" data-tm="start">大問ごとに時間を計る</button>`; return; }
  const running = tm.active != null, cur = running ? s.parts[tm.active]?.name : '';
  box.innerHTML = `<div class="tmhead"><span class="tmstate">${tm.done ? '計り終えました' : running ? `いま ${esc(cur || '')}` : '止めています'}</span><b class="tmclock" id="tmClock">${clock(totalMs())}</b></div>
    <p class="note">${tm.done ? '点数を入れて「記録する」を押すと、大問ごとの時間も残ります。' : '解く大問の「時間」を押すと、その大問に切り替わります。'}</p>
    <div class="tools">${tm.done ? '' : running ? '<button type="button" class="tool" data-tm="pause">一時停止</button>' : '<button type="button" class="tool" data-tm="resume">再開</button>'}${tm.done ? '' : '<button type="button" class="tool" data-tm="finish">計り終える</button>'}<button type="button" class="tool danger" data-tm="cancel">計測を消す</button></div>`;
}
export function tick() {
  if (!tm || tm.active == null || !tmHere() || $('rec-scores').hidden) return;
  const c = $('tmClock'); if (c) c.textContent = clock(totalMs());
  const p = document.querySelector(`[data-pt="${tm.active}"]`); if (p) p.textContent = clock(partMs(tm.active));
}
function updateSum() {
  const s = subj(ui.exam, ui.examSubj), sc = currentScores();
  const total = sc.reduce((t, x) => t + (x || 0), 0), max = s ? maxOf(s.parts) : 0;
  $('sumNow').textContent = fmt(total); $('sumMax').textContent = `/ ${max}`;
  if (s && s.target && sc.some(x => x != null)) {
    const d = total - s.target;
    $('sumVs').textContent = d >= 0 ? `目標 ${s.target} を ${fmt(d)} 上回る` : `目標 ${s.target} まで あと ${fmt(-d)}`;
    $('sumVs').dataset.kind = d >= 0 ? 'ok' : 'warn';
  } else { $('sumVs').textContent = s && s.target ? `目標 ${s.target}` : ''; $('sumVs').dataset.kind = ''; }
}
function updateAttemptNote() {
  const label = getLabel();
  if (!label) { $('attemptNote').textContent = '年度・回の名前を書くと何回目か出ます'; return; }
  const n = solvedN(label);
  $('attemptNote').textContent = n ? `${n + 1}回目（前回までの記録も残ります）` : 'はじめて';
}
function resetForm() {
  editingId = null; $('scSave').textContent = '記録する'; $('scCancel').hidden = true; $('scAddTitle').textContent = '過去問を記録する';
  $('scMinutes').value = ''; $('scMemo').value = ''; $('scDate').value = localDate();
  renderParts();
}
function startEdit(id) {
  const a = db.scores.attempts.find(x => x.id === id); if (!a) return;
  ui.exam = a.examId; ui.examSubj = a.subjectId; $('yearPick').innerHTML = ''; renderExamChips();
  editingId = a.id; $('scSave').textContent = 'この記録を直す'; $('scCancel').hidden = false; $('scAddTitle').textContent = '記録を直す';
  setLabel(a.label); $('scDate').value = a.date; $('scMinutes').value = a.minutes ?? ''; $('scMemo').value = a.memo || '';
  renderParts(a.scores); $('scAddBox').open = true; $('scMsg').textContent = '直してから「この記録を直す」を押してください。';
  $('scAddBox').scrollIntoView({block: 'start'});
}

// ---------- 推移 ----------
function chartSVG(rows, s) {
  const W = 340, H = 190, L = 34, R = 10, T = 14, B = 34;
  const pts = rows.map(a => ({a, y: pct(sumOf(a), maxOf(a.parts))}));
  const tgt = s.target ? pct(s.target, maxOf(s.parts)) : null;
  const xs = i => pts.length === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (pts.length - 1);
  const ys = v => T + (100 - v) * (H - T - B) / 100;
  const grid = [0, 25, 50, 75, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}" class="g"/><text x="${L - 6}" y="${ys(v) + 4}" class="ax" text-anchor="end">${v}</text>`).join('');
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L${xs(pts.length - 1).toFixed(1)},${ys(0)} L${xs(0).toFixed(1)},${ys(0)} Z`;
  const dots = pts.map((p, i) => `<circle cx="${xs(i).toFixed(1)}" cy="${ys(p.y).toFixed(1)}" r="${i === pts.length - 1 ? 4.5 : 3}" class="${tgt != null && p.y >= tgt ? 'pt ok' : 'pt'}"/>`).join('');
  const step = Math.max(1, Math.ceil(pts.length / 6));
  const labels = pts.map((p, i) => (i % step === 0 || i === pts.length - 1) ? `<text x="${xs(i).toFixed(1)}" y="${H - B + 16}" class="ax" text-anchor="middle">${esc(String(p.a.label).replace('年度', ''))}</text>` : '').join('');
  const tl = tgt != null ? `<line x1="${L}" x2="${W - R}" y1="${ys(tgt)}" y2="${ys(tgt)}" class="tgt"/><text x="${W - R}" y="${ys(tgt) - 5}" class="tgtl" text-anchor="end">目標 ${s.target}</text>` : '';
  const last = pts[pts.length - 1];
  return `<div class="chead"><span>${esc(s.name)}の得点率の推移</span><span class="num">直近 ${fmt(sumOf(last.a))}<small>/ ${maxOf(last.a.parts)}</small></span></div>
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(s.name)}の得点率の推移">${grid}<path d="${area}" class="area"/><path d="${line}" class="ln"/>${tl}${dots}${labels}</svg>
    <p class="note">縦軸は満点に対する％。横は解いた順（下の数字は年度）。</p>`;
}
const mins = sec => sec == null ? '' : sec < 60 ? '1分未満' : `${Math.round(sec / 60)}分`;
function partsTable(rows, s) {
  const names = s.parts.map(p => p.name), acc = names.map(() => ({sum: 0, n: 0, t: 0, tn: 0}));
  rows.forEach(a => a.parts.forEach((p, i) => { const k = names.indexOf(p.name), v = a.scores[i]; if (k >= 0 && v != null) { acc[k].sum += pct(v, p.max); acc[k].n++; } if (k >= 0 && a.ptimes && a.ptimes[i] != null) { acc[k].t += a.ptimes[i]; acc[k].tn++; } }));
  const avgs = acc.map(x => x.n ? x.sum / x.n : null), valid = avgs.filter(x => x != null);
  if (!valid.length || names.length < 2) return '';
  const low = Math.min(...valid);
  return `<div class="chead"><span>大問ごとの平均得点率</span></div><ul class="plist">${names.map((n, i) => avgs[i] == null ? '' :
    `<li${avgs[i] === low ? ' class="low"' : ''}><span class="pn">${esc(n)}</span><span class="pt"><i style="--r:${fmt(avgs[i])}%"></i></span><span class="pv">${fmt(avgs[i])}%${acc[i].tn ? `<small>${mins(acc[i].t / acc[i].tn)}</small>` : ''}</span></li>`).join('')}</ul>
    <p class="note">赤い大問がいちばん取れていない大問です（${acc.reduce((t, x) => Math.max(t, x.n), 0)}回分の平均）。${acc.some(x => x.tn) ? '小さい数字は、時間を計った回の平均時間です。' : ''}</p>`;
}
function todaiTable() {
  const rows = live().filter(a => a.examId === 'todai');
  const labels = [...new Set(rows.map(a => a.label))].sort((x, y) => yearKey(y) - yearKey(x));
  const full = labels.map(l => { const per = TODAI_SUBJ.map(sid => newestAttempt(rows.filter(a => a.label === l && a.subjectId === sid))); return {l, per, done: per.filter(Boolean).length}; }).filter(x => x.done > 0);
  const kyote = 110 * (+db.scores.kyoteRate || 0) / 100;
  if (!full.length) return '<div class="chead"><span>東大の合計見込み</span></div><p class="note">同じ年度の5科目（国語・数学・英語・物理・化学）を解くと、ここに合計が出ます。</p>';
  return `<div class="chead"><span>東大の合計見込み（550点満点・目標340）</span></div>
    <div class="tscroll"><table class="ttable"><thead><tr><th>年度</th>${TODAI_SUBJ.map(sid => `<th>${esc((subj('todai', sid)?.name || sid).slice(0, 1))}</th>`).join('')}<th>2次</th><th>＋共テ</th></tr></thead><tbody>
    ${full.map(x => { const sum = x.per.reduce((t, a) => t + (a ? sumOf(a) : 0), 0), all = x.done === TODAI_SUBJ.length, est = sum + kyote;
      return `<tr><th>${esc(x.l)}</th>${x.per.map(a => `<td>${a ? fmt(sumOf(a)) : '<span class="na">－</span>'}</td>`).join('')}<td>${fmt(sum)}${all ? '' : '<span class="na">*</span>'}</td><td class="${all ? (est >= 340 ? 'ok' : 'warn') : ''}">${all ? fmt(est) : '－'}</td></tr>`; }).join('')}
    </tbody></table></div><p class="note">共テは見込み ${fmt(+db.scores.kyoteRate || 0)}％（${fmt(kyote)}点）で足しています。* は5科目そろっていない年度です。同じ年度を何回も解いたときは、いちばん新しい記録を使います。</p>`;
}
function renderTrend() {
  const eid = $('scExam').value, sid = $('scSubj').value, s = subj(eid, sid);
  const rows = live().filter(a => a.examId === eid && a.subjectId === sid).sort((x, y) => x.date.localeCompare(y.date) || x.updatedAt.localeCompare(y.updatedAt));
  let parts = '';
  if (!s) $('scTrend').innerHTML = '<p class="empty">科目を選んでください。</p>';
  else if (!rows.length) $('scTrend').innerHTML = `<div class="chead"><span>${esc(s.name)}の得点率の推移</span></div><p class="empty">${esc(s.name)}の記録はまだありません。上の「過去問を記録する」から入れてください。</p>`;
  else { $('scTrend').innerHTML = chartSVG(rows, s); parts = partsTable(rows, s); }
  $('scParts').innerHTML = parts; $('scParts').hidden = !parts;
  $('scTodai').innerHTML = eid === 'todai' ? todaiTable() : ''; $('scTodai').hidden = eid !== 'todai';
}

// ---------- 消化表：年度×科目。数字はいちばん新しい記録の点 ----------
function gridRows(eid) {
  const rec = [...new Set(live().filter(a => a.examId === eid).map(a => a.label))];
  const base = eid === 'kyote' ? range(TOP_YEAR, KYOTE_FIRST).map(y => `${y}年度 本試`) : range(TOP_YEAR, TOP_YEAR - (eid === 'todai' ? 24 : 9)).map(y => `${y}年度`);
  const rank = l => { const p = parseLabel(eid, l); if (!p) return 9; return eid === 'kyote' ? KYOTE_KINDS.indexOf(p.kind) : 0; };
  const extra = rec.filter(l => !base.includes(l)).sort((x, y) => rank(x) - rank(y) || yearKey(y) - yearKey(x) || x.localeCompare(y, 'ja', {numeric: true}));
  return {base, rows: [...base, ...extra]};
}
const rowName = l => l.replace(/^(\d{4})年度$/, '$1').replace(/^(\d{4})年度 /, '$1 ');
function renderGrid() {
  const eid = $('scExam').value, ex = exam(eid);
  if (!ex || !ex.subjects.length) { $('scGrid').innerHTML = '<p class="empty">この試験には科目がまだありません。設定で足してください。</p>'; return; }
  const all = live().filter(a => a.examId === eid);
  const {base, rows} = gridRows(eid), done = ex.subjects.map(() => 0);
  const body = rows.map(l => {
    let sum = 0, cnt = 0;
    const cells = ex.subjects.map((s, j) => {
      const xs = all.filter(a => a.label === l && a.subjectId === s.id);
      if (!xs.length) return `<td><button type="button" class="gc none" data-go="${esc(l)}" data-sid="${s.id}" aria-label="${esc(l)} ${esc(s.name)}：まだ。押すと記録する"></button></td>`;
      const a = newestAttempt(xs), v = sumOf(a); done[j]++; cnt++; sum += v;
      const k = s.target ? (v >= s.target ? 'ok' : 'warn') : '';
      return `<td><button type="button" class="gc" data-kind="${k}" data-jump="${esc(l)}" aria-label="${esc(l)} ${esc(s.name)}：${fmt(v)}点${xs.length > 1 ? `、${xs.length}回解いた` : ''}">${fmt(v)}${xs.length > 1 ? `<sup>${xs.length}</sup>` : ''}</button></td>`;
    }).join('');
    return `<tr><th scope="row">${esc(rowName(l))}</th>${cells}<td class="gsum${cnt === ex.subjects.length ? '' : ' gpart'}">${cnt ? fmt(sum) : ''}</td></tr>`;
  }).join('');
  const maxAll = ex.subjects.reduce((t, s) => t + maxOf(s.parts), 0);
  $('scGrid').innerHTML = `<div class="chead"><span>${esc(examLabel(ex))}の消化表</span></div>
    <div class="tscroll"><table class="gtable"><thead><tr><th></th>${ex.subjects.map(s => `<th scope="col">${esc(shortOf(s))}</th>`).join('')}<th scope="col" class="gsum">計</th></tr></thead>
    <tbody>${body}</tbody><tfoot><tr><th scope="row">済</th>${done.map(n => `<td>${n}</td>`).join('')}<td class="gsum">/ ${maxAll}</td></tr></tfoot></table></div>
    <p class="note">数字はいちばん新しい記録の点数です。右上の小さい数字は解いた回数。緑は目標以上、茶色は目標未満。空いたマスを押すと、その年度と科目で記録できます。点数を押すと、その年度の記録へ飛びます。${eid === 'kyote' ? '追試と予想問題集は、記録した回だけ出ます。' : `表には${base.length}年度分を出しています。それより前の年度は記録すると出ます。`}</p>`;
}

// ---------- 記録の一覧 ----------
function yearSum(eid, items) {
  const latest = new Map();
  items.forEach(a => { const b = latest.get(a.subjectId); if (!b || a.date > b.date || (a.date === b.date && a.updatedAt > b.updatedAt)) latest.set(a.subjectId, a); });
  const list = [...latest.values()];
  const sum = list.reduce((t, a) => t + sumOf(a), 0), max = list.reduce((t, a) => t + maxOf(a.parts), 0);
  let note = `${list.length}科目`, extra = '';
  if (eid === 'todai') {
    const miss = TODAI_SUBJ.filter(s => !latest.has(s)).map(s => subj('todai', s)?.name || s);
    if (miss.length) note += `（${miss.join('・')}がまだ）`;
    else { const est = sum + 110 * (+db.scores.kyoteRate || 0) / 100; extra = `<span class="yest" data-kind="${est >= 340 ? 'ok' : 'warn'}">共テ見込みを足すと <b>${fmt(est)}</b> / 550</span>`; }
  }
  const re = items.length > list.length ? '・解き直しは新しいほう' : '';
  return `<div class="ysum"><span class="ylab">合計</span><b>${fmt(sum)}</b><span class="ymax">/ ${max}</span><span class="ynote">${note}${re}</span>${extra}</div>`;
}
function attRow(a, sameLabel) {
  const s = subj(a.examId, a.subjectId), tot = sumOf(a), max = maxOf(a.parts);
  const nth = sameLabel.filter(x => x.subjectId === a.subjectId && x.date <= a.date).length;
  const hit = s && s.target ? (tot >= s.target ? 'ok' : 'warn') : '';
  const bars = a.parts.map((p, i) => { const v = a.scores[i], r = v == null ? 0 : pct(v, p.max); return `<span class="pb" title="${esc(p.name)} ${v ?? '－'}/${p.max}"><i style="--r:${r}%"></i></span>`; }).join('');
  return `<li class="att" data-id="${esc(a.id)}">
    <div class="atop"><span class="asub">${esc(a.subjectName)}${nth > 1 ? `<span class="tag">${nth}回目</span>` : ''}</span><span class="ascore" data-kind="${hit}">${fmt(tot)}<small>/ ${max}</small></span></div>
    <div class="abars">${bars}</div>
    <div class="ameta">${esc(a.date.replace(/-/g, '/'))}${a.minutes != null ? `・${a.minutes}分` : ''}${s && s.target ? `・目標 ${s.target}` : ''}</div>
    ${a.memo ? `<div class="amemo">${esc(a.memo)}</div>` : ''}
    <details class="adetail"><summary>大問ごとの点と操作</summary>
      <table class="ptable"><tbody>${a.parts.map((p, i) => `<tr><th>${esc(p.name)}</th><td>${a.scores[i] ?? '－'}</td><td>/ ${p.max}</td>${a.ptimes ? `<td class="na">${mins(a.ptimes[i])}</td>` : ''}<td>${a.parts.length > 1 ? `<button type="button" class="tool sm" data-send="${esc(a.id)}" data-part="${i}">受け箱へ</button>` : ''}</td></tr>`).join('')}</tbody></table>
      <div class="tools"><button type="button" class="tool" data-send="${esc(a.id)}" data-part="-1">間違えた問題を受け箱へ</button><button type="button" class="tool" data-edit="${esc(a.id)}">直す</button><button type="button" class="tool danger" data-del="${esc(a.id)}">消す</button></div>
    </details></li>`;
}
function renderRecords() {
  const eid = $('scExam').value, sid = $('scAllSubj').checked ? '' : $('scSubj').value;
  const rows = live().filter(a => a.examId === eid && (!sid || a.subjectId === sid));
  if (!rows.length) { $('scList').innerHTML = '<p class="empty">まだ記録がありません。</p>'; return; }
  const groups = new Map();
  rows.forEach(a => { if (!groups.has(a.label)) groups.set(a.label, []); groups.get(a.label).push(a); });
  const keys = [...groups.keys()].sort((x, y) => yearKey(y) - yearKey(x) || x.localeCompare(y, 'ja'));
  const order = s => { const i = (exam(eid)?.subjects || []).findIndex(x => x.id === s); return i < 0 ? 99 : i; };
  $('scList').innerHTML = keys.map(k => {
    const items = groups.get(k).slice().sort((x, y) => order(x.subjectId) - order(y.subjectId) || x.date.localeCompare(y.date));
    return `<section class="ygroup" data-label="${esc(k)}"><h3>${esc(k)}</h3>${sid ? '' : yearSum(eid, groups.get(k))}<ol class="atts">${items.map(a => attRow(a, groups.get(k))).join('')}</ol></section>`;
  }).join('');
}
const toInSubj = n => /数/.test(n) ? '数学' : /物理/.test(n) ? '物理' : /化学/.test(n) ? '化学' : /英/.test(n) ? '英語' : /国/.test(n) ? '国語' : 'その他';

// ---------- まとめ ----------
function fillFilters() {
  const ke = $('scExam').value, ks = $('scSubj').value;
  $('scExam').innerHTML = db.scores.exams.map(e => `<option value="${e.id}">${esc(examLabel(e))}</option>`).join('');
  $('scExam').value = exam(ke) ? ke : (exam(ui.exam) ? ui.exam : db.scores.exams[0]?.id);
  fillSubjFilter(ks);
}
function fillSubjFilter(keep) {
  const ex = exam($('scExam').value);
  $('scSubj').innerHTML = (ex?.subjects || []).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const has = v => [...$('scSubj').options].some(o => o.value === v);
  if (has(keep)) $('scSubj').value = keep; else if (has(ui.examSubj)) $('scSubj').value = ui.examSubj;
}
function renderLists() { renderTrend(); renderGrid(); renderRecords(); }
export function render() {
  const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#scForm');
  if (!typing) renderExamChips();
  fillFilters(); renderLists();
}
export function init() {
  $('examChips').addEventListener('click', e => {
    const b = e.target.closest('[data-exam]'); if (!b) return;
    if (tm && !tm.done && tm.active != null && b.dataset.exam !== ui.exam) { $('scMsg').textContent = '時間を計っている間は、試験を変える前に一時停止してください。'; return; }
    if (ui.exam !== b.dataset.exam) $('yearPick').innerHTML = '';
    ui.exam = b.dataset.exam; saveUI(); renderParts(); renderExamChips();
  });
  $('exSubjChips').addEventListener('click', e => { const b = e.target.closest('[data-exsubj]'); if (!b) return; ui.examSubj = b.dataset.exsubj; saveUI(); renderParts(); renderExamChips(); });
  $('parts').addEventListener('input', updateSum);
  $('parts').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (!b) return; e.preventDefault(); tmGo(+b.dataset.go); });
  $('kindPick').addEventListener('change', () => { ui.kind = $('kindPick').value; saveUI(); fillPick(); updateAttemptNote(); });
  $('yearPick').addEventListener('change', () => { $('yearFree').hidden = $('yearPick').value !== FREE; if (!$('yearFree').hidden) $('yearFree').focus(); updateAttemptNote(); });
  $('yearFree').addEventListener('input', updateAttemptNote);
  $('tmBar').addEventListener('click', e => {
    const b = e.target.closest('[data-tm]'); if (!b) return; const act = b.dataset.tm, s = subj(ui.exam, ui.examSubj);
    if (act === 'start' && s) { tm = {exam: ui.exam, subj: ui.examSubj, acc: s.parts.map(() => 0), active: null, since: null, done: false}; tmGo(0); return; }
    if (act === 'pause') { tmStop(); saveTm(); renderParts(currentScores()); }
    if (act === 'resume') tmGo(tm.last ?? 0);
    if (act === 'finish') { tmStop(); tm.done = true; saveTm(); $('scMinutes').value = Math.max(1, Math.round(totalMs() / 60000)); renderParts(currentScores()); }
    if (act === 'cancel') { if (!armed(b)) return; tm = null; saveTm(); renderParts(currentScores()); }
  });
  $('scForm').addEventListener('submit', e => {
    e.preventDefault();
    const s = subj(ui.exam, ui.examSubj);
    if (!s) { $('scMsg').textContent = '科目を選んでください。'; return; }
    const label = getLabel();
    if (!label) { $('scMsg').textContent = '「その他」のときは、年度か回の名前を書いてください。'; $('yearFree').focus(); return; }
    const scores = currentScores();
    if (!scores.some(x => x != null)) { $('scMsg').textContent = '点数を1つ以上入れてください。'; return; }
    const over = scores.findIndex((x, i) => x != null && x > s.parts[i].max);
    if (over >= 0) { $('scMsg').textContent = `${s.parts[over].name}が満点（${s.parts[over].max}）を超えています。`; return; }
    const old = editingId ? db.scores.attempts.find(a => a.id === editingId) : null;
    let ptimes = old && old.ptimes ? old.ptimes : null;
    if (!editingId && tmHere()) { tmStop(); ptimes = s.parts.map((_, i) => Math.round((tm.acc[i] || 0) / 1000)); if ($('scMinutes').value === '') $('scMinutes').value = Math.max(1, Math.round(totalMs() / 60000)); tm = null; saveTm(); }
    const rec = {id: editingId || uid(), examId: ui.exam, subjectId: ui.examSubj, examName: exam(ui.exam).name, subjectName: s.name, label,
      date: $('scDate').value || localDate(), parts: s.parts.map(p => ({...p})), scores, minutes: $('scMinutes').value === '' ? null : +$('scMinutes').value, memo: $('scMemo').value.trim(), updatedAt: nowISO()};
    if (ptimes && ptimes.length === rec.parts.length) rec.ptimes = ptimes;
    const i = db.scores.attempts.findIndex(a => a.id === rec.id);
    if (i >= 0) db.scores.attempts[i] = rec; else db.scores.attempts.push(rec);
    const wasEdit = !!editingId;
    resetForm(); fillPick(null);
    $('scMsg').textContent = `${rec.subjectName} ${rec.label}：${fmt(sumOf(rec))} / ${maxOf(rec.parts)} を${wasEdit ? '直しました' : '記録しました'}。`;
    $('scExam').value = rec.examId; fillSubjFilter(rec.subjectId);
    changed('scores'); renderLists();
  });
  $('scCancel').addEventListener('click', () => { resetForm(); fillPick(null); $('scMsg').textContent = ''; });
  $('scExam').addEventListener('change', () => { fillSubjFilter(''); renderLists(); });
  $('scSubj').addEventListener('change', () => { renderTrend(); renderRecords(); });
  $('scAllSubj').addEventListener('change', renderRecords);
  $('scGrid').addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) {
      ui.exam = $('scExam').value; ui.examSubj = go.dataset.sid; saveUI(); editingId = null; resetForm();
      $('yearPick').innerHTML = ''; renderExamChips(); setLabel(go.dataset.go);
      $('scAddBox').open = true; $('scMsg').textContent = ''; $('scAddBox').scrollIntoView({block: 'start'}); return;
    }
    const j = e.target.closest('[data-jump]'); if (!j) return;
    $('scAllSubj').checked = true; renderRecords();
    const sec = $$('#scList .ygroup').find(x => x.dataset.label === j.dataset.jump);
    if (sec) sec.scrollIntoView({block: 'start'});
  });
  $('scList').addEventListener('click', e => {
    const sd = e.target.closest('[data-send]');
    if (sd) {
      const a = db.scores.attempts.find(x => x.id === sd.dataset.send); if (!a) return;
      const part = +sd.dataset.part, pn = part >= 0 && a.parts[part] ? ' ' + a.parts[part].name : '';
      send.prefill({subject: toInSubj(a.subjectName), source: `${a.examName} ${a.label} ${a.subjectName}${pn}`});
      nav.goto('send'); return;
    }
    const ed = e.target.closest('[data-edit]'); if (ed) { startEdit(ed.dataset.edit); return; }
    const del = e.target.closest('[data-del]'); if (!del || !armed(del)) return;
    const a = db.scores.attempts.find(x => x.id === del.dataset.del); if (!a) return;
    a.deleted = true; a.updatedAt = nowISO(); changed('scores'); renderLists();
  });
  resetForm();
}
