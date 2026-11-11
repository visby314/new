// 「記録」→ 勉強時間：締め切りまでの進み具合、5週間の表、日ごとの棒グラフ、科目の割合、時間割のでき具合、記録の一覧
import { $, $$, armed } from './dom.js';
import { db, ui, saveUI, changed } from './store.js';
import { esc, nowISO, uid, todayKey, dayKey, shiftDay, weekday, weekdayIdx, md, hm, dur, fmtH, pad, DAY_START_H } from './util.js';
import { liveSessions, byDay, planInfo } from './calc.js';
import { slotsFor, slotState, liveTables } from './tt.js';
import { subj, subjName, subjColor, dotHTML, subjOptions } from './shared.js';

const range0 = n => Array.from({length: n + 1}, (_, i) => i);

function planHTML() {
  const p = planInfo(db.study);
  if (!p) return `<div class="chead"><span>締め切りまでの進み具合</span></div><p class="note">設定の「目標と科目」で1日の目標と締め切り日を入れると、ここに出ます。</p>`;
  const pc = Math.min(100, p.done * 100 / p.target), pacePc = Math.min(100, p.pace * 100 / p.target), diff = p.doneYday - p.pace;
  return `<div class="chead"><span>${md(p.end)}までの進み具合</span><span class="num">${(Math.floor(pc * 10) / 10).toFixed(1)}<small>%</small></span></div>
    <div class="bar" style="height:8px"><i style="width:${pc}%"></i><b style="left:${pacePc}%" title="昨日までの目安"></b></div>
    <div class="kpis"><div><b>${fmtH(p.done)}<small>時間</small></b><span>やった時間（目標 ${fmtH(p.target)}時間）</span></div>
      <div><b class="${diff >= 0 ? 'ok' : 'warn'}">${diff >= 0 ? '+' : '−'}${fmtH(Math.abs(diff))}<small>時間</small></b><span>昨日までの目安 ${fmtH(p.pace)}時間との差</span></div>
      <div><b>${p.left}<small>日</small></b><span>残り（今日を入れて）</span></div>
      <div><b>${fmtH(p.need)}<small>時間</small></b><span>残りを1日に割ると</span></div></div>
    <p class="note">${md(p.start)}${p.auto === 'first' ? '（最初の記録の日）' : p.auto === 'today' ? '（今日）' : ''}から${md(p.end)}の前日までの${p.total}日 × 1日${fmtH((+db.study.goalH || 0) * 3600)}時間で目標を出しています。棒の縦線は、昨日まで目標どおりに進んだときの位置です。</p>`;
}

// この5週間：月曜始まり。色が濃いほど目標に近い
function heatHTML(days) {
  const today = todayKey(), goal = (+db.study.goalH || 0) * 3600;
  const mondayShift = (weekdayIdx(today) + 6) % 7; // 今日が月曜から何日目か
  const start = shiftDay(today, -mondayShift - 28);
  let cells = '', zero = 0, hit = 0;
  for (let i = 0; i < 35; i++) {
    const k = shiftDay(start, i), sec = (days.get(k) || {}).total || 0, fut = k > today;
    const ratio = goal ? sec / goal : (sec ? 0.5 : 0);
    const l = !sec ? 0 : ratio >= 1 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : 1;
    if (!fut) { if (!sec) zero++; if (l === 4) hit++; }
    cells += `<div class="hc${fut ? ' fut' : ''}${k === today ? ' today' : ''}" data-l="${fut ? '' : l}" title="${md(k)} ${dur(sec)}"><b>${fut ? +k.slice(8) : sec ? fmtH(sec) : '0'}</b><span>${md(k)}</span></div>`;
  }
  const passed = 35 - (6 - mondayShift);
  return `<div class="chead"><span>この5週間</span><span class="num ${zero ? 'warnt' : 'okt'}">${zero}<small>日が記録なし（${passed}日のうち）</small></span></div>
    <div class="heat">${'月火水木金土日'.split('').map(w => `<div class="hd">${w}</div>`).join('')}${cells}</div>
    <p class="note">数字はその日の勉強時間（時間）。色が濃いほど目標に近く、いちばん濃い色が目標に届いた日です${goal ? `（${hit}日）` : ''}。白い枠は記録がない日。</p>`;
}

function chartHTML(days, n) {
  const today = todayKey(), goal = (+db.study.goalH || 0) * 3600;
  const keys = Array.from({length: n}, (_, i) => shiftDay(today, i - n + 1));
  const dayTot = keys.map(k => (days.get(k) || {}).total || 0);
  const tot = dayTot.reduce((t, x) => t + x, 0), hit = goal ? dayTot.filter(x => x >= goal).length : 0, studied = dayTot.filter(x => x > 0).length;
  const prevTot = keys.map(k => (days.get(shiftDay(k, -n)) || {}).total || 0).reduce((t, x) => t + x, 0), diff = tot - prevTot;
  const W = 340, H = 180, L = 30, R = 6, T = 10, B = 24;
  const maxH = Math.max(1, Math.ceil(Math.max(...dayTot, goal) / 3600)), step = maxH > 8 ? 4 : maxH > 4 ? 2 : 1, yMax = Math.ceil(maxH / step) * step;
  const ys = sec => T + (H - T - B) * (1 - sec / (yMax * 3600));
  const bw = (W - L - R) / n, gap = n > 14 ? 1 : 3;
  let bars = ''; const used = new Set();
  keys.forEach((k, i) => {
    const m = (days.get(k) || {}).subj; if (!m) return;
    let acc = 0; const x = L + i * bw + gap / 2, w = bw - gap;
    const order = [...db.study.subjects.map(s => s.id), ...[...m.keys()].filter(id => !subj(id))];
    for (const id of order) {
      const v = m.get(id) || 0; if (!v) continue; used.add(id);
      const y1 = ys(acc), y2 = ys(acc + v); acc += v;
      bars += `<rect x="${x.toFixed(1)}" y="${y2.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, y1 - y2).toFixed(1)}" fill="${subjColor(id)}"><title>${k.slice(5)} ${esc(subjName(id, 'ほか'))} ${dur(v)}</title></rect>`;
    }
  });
  const grid = range0(yMax / step).map(i => { const h = i * step; return `<line x1="${L}" x2="${W - R}" y1="${ys(h * 3600)}" y2="${ys(h * 3600)}" class="g"/><text x="${L - 5}" y="${ys(h * 3600) + 3.5}" class="ax" text-anchor="end">${h}</text>`; }).join('');
  const lab = keys.map((k, i) => { const show = n <= 7 || i % 5 === (n - 1) % 5; return show ? `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - B + 14}" class="ax" text-anchor="middle">${n <= 7 ? weekday(k) : +k.slice(8)}</text>` : ''; }).join('');
  const gl = goal ? `<line x1="${L}" x2="${W - R}" y1="${ys(goal)}" y2="${ys(goal)}" class="tgt"/><text x="${W - R}" y="${ys(goal) - 4}" class="tgtl" text-anchor="end">目標 ${fmtH(goal)}時間</text>` : '';
  const legend = db.study.subjects.filter(s => used.has(s.id));
  return {tot, html: `<div class="kpis" style="grid-template-columns:repeat(3,1fr)"><div><b>${dur(tot)}</b><span>直近${n}日の合計</span></div><div><b>${dur(Math.round(tot / n))}</b><span>1日の平均</span></div><div><b>${goal ? hit : studied}<small>日</small></b><span>${goal ? `目標 ${dur(goal)} に届いた日` : '勉強した日'}</span></div></div>
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="直近${n}日の日ごとの勉強時間">${grid}${bars}${gl}${lab}</svg>
    ${legend.length ? `<div class="legend">${legend.map(s => `<span>${dotHTML(s.id)}${esc(s.name)}</span>`).join('')}</div>` : ''}
    <p class="note">縦軸は時間。${n <= 7 ? '横は曜日' : '横は日付'}で、右端が今日です。その前の${n}日（${dur(prevTot)}）より ${diff >= 0 ? dur(diff) + ' 多い' : dur(-diff) + ' 少ない'}。</p>`, keys};
}

function subjHTML(days, keys, n) {
  const per = new Map(); let tot = 0;
  for (const k of keys) { const m = (days.get(k) || {}).subj; if (!m) continue; for (const [id, sec] of m) { per.set(id, (per.get(id) || 0) + sec); tot += sec; } }
  const rows = [...per.entries()].sort((a, b) => b[1] - a[1]);
  return `<div class="chead"><span>科目ごと（直近${n}日）</span></div>` + (rows.length ? `<ul class="plist">${rows.map(([id, sec]) =>
    `<li><span class="pn">${dotHTML(id)}${esc(subjName(id, (db.study.sessions.find(x => x.subjectId === id) || {}).subjectName))}</span><span class="pt"><i style="--r:${sec * 100 / tot}%;background:${subjColor(id)}"></i></span><span class="pv">${dur(sec)}<small>${Math.round(sec * 100 / tot)}%</small></span></li>`).join('')}</ul>` : '<p class="note">この期間の記録はありません。</p>');
}

// 時間割のでき具合：直近7日、1日ごとにコマの帯を並べる
function slotsHTML() {
  if (!liveTables(db.tt).length) return '';
  const now = Date.now(), today = todayKey(); let rows = '', done = 0, ended = 0;
  for (let i = 6; i >= 0; i--) {
    const d = shiftDay(today, -i), slots = slotsFor(db.tt, d);
    if (!slots.length) { rows += `<li><span class="pn">${md(d)}<small style="margin-left:4px;color:var(--muted)">${weekday(d)}</small></span><span class="note">コマなし</span><span class="pv"></span></li>`; continue; }
    const xs = slots.map(s => ({s, x: slotState(db.tt, db.study.sessions, d, s, now)}));
    const ok = xs.filter(r => r.x.st === 'done' || r.x.st === 'run').length, end = xs.filter(r => r.s.endMs <= now).length;
    done += xs.filter(r => (r.x.st === 'done' || r.x.st === 'run') && r.s.endMs <= now).length; ended += end;
    rows += `<li><span class="pn">${md(d)}<small style="margin-left:4px;color:var(--muted)">${weekday(d)}</small></span><span class="daystrip">${xs.map(r => `<i data-st="${r.x.st}" style="--w:${r.s.full}" title="${hm(r.s.startMs)}–${hm(r.s.endMs)} ${esc(subjName(r.s.subjectId))}"></i>`).join('')}</span><span class="pv">${ok}<small>/ ${slots.length}コマ</small></span></li>`;
  }
  return `<div class="chead"><span>時間割のでき具合（直近7日）</span><span class="num">${ended ? Math.round(done * 100 / ended) : 0}<small>%（終わった${ended}コマのうち）</small></span></div>
    <ul class="plist">${rows}</ul>
    <div class="legend"><span><i class="dot" style="--c:var(--accent)"></i>やった・計った</span><span><i class="dot" style="--c:#e3bcbc"></i>やってない</span><span><i class="dot" style="--c:var(--warn)"></i>答えていない</span><span><i class="dot" style="--c:var(--rule-soft)"></i>これから</span></div>`;
}

// ---------- 記録の一覧 ----------
let logDays = 14, editingId = null;
const KIND = {manual: 'あとから', timer: 'タイマー', slot: '時間割'};
function logHTML() {
  const today = todayKey(), from = shiftDay(today, -(logDays - 1));
  const groups = new Map();
  for (const s of liveSessions(db.study)) { const k = dayKey(Date.parse(s.start)); if (k < from) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const keys = [...groups.keys()].sort().reverse();
  $('moreBtn').hidden = !liveSessions(db.study).some(s => dayKey(Date.parse(s.start)) < from);
  if (!keys.length) return '<p class="empty">この期間の記録はありません。</p>';
  return keys.map(k => {
    const ss = groups.get(k).sort((a, b) => a.start < b.start ? -1 : 1), tot = ss.reduce((t, s) => t + s.sec, 0);
    return `<section class="ygroup"><h3>${md(k)}<small>（${weekday(k)}）</small><span class="dtot">${dur(tot)}</span></h3><ol class="atts">${ss.map(s => `<li class="att">
      <div class="atop"><span class="asub">${dotHTML(s.subjectId)}${esc(subjName(s.subjectId, s.subjectName))}${KIND[s.kind] ? `<span class="tag muted">${KIND[s.kind]}</span>` : ''}</span><span class="ascore">${dur(s.sec)}</span></div>
      <div class="ameta">${hm(Date.parse(s.start))}〜${hm(Date.parse(s.end))}</div>
      ${s.memo ? `<div class="amemo">${esc(s.memo)}</div>` : ''}
      <div class="tools"><button type="button" class="tool sm" data-edit="${esc(s.id)}">直す</button><button type="button" class="tool sm danger" data-del="${esc(s.id)}">消す</button></div></li>`).join('')}</ol></section>`;
  }).join('');
}
function resetManual() {
  editingId = null; $('mSave').textContent = '足す'; $('mCancel').hidden = true; $('manualTitle').textContent = 'あとから記録を足す';
  $('mDate').value = todayKey(); $('mTime').value = ''; $('mMin').value = ''; $('mMemo').value = '';
  $('mSubj').innerHTML = subjOptions(subj(ui.subj) ? ui.subj : db.study.subjects[0]?.id);
}
function startEdit(id) {
  const s = db.study.sessions.find(x => x.id === id); if (!s) return;
  editingId = id; $('manualBox').open = true; $('manualTitle').textContent = '記録を直す'; $('mSave').textContent = 'この記録を直す'; $('mCancel').hidden = false;
  $('mSubj').innerHTML = subjOptions(s.subjectId);
  const st = new Date(s.start); $('mDate').value = dayKey(st.getTime());
  $('mTime').value = `${pad(st.getHours())}:${pad(st.getMinutes())}`; $('mMin').value = Math.round(s.sec / 60); $('mMemo').value = s.memo || '';
  $('mMsg').textContent = '直してから「この記録を直す」を押してください。';
  $('manualBox').scrollIntoView({block: 'start'});
}

export function render() {
  const days = byDay(db.study), n = +ui.range === 30 ? 30 : 7;
  $$('#rangeTabs [data-range]').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.range === n)));
  $('stPlan').innerHTML = planHTML();
  $('stHeat').innerHTML = heatHTML(days);
  const c = chartHTML(days, n); $('stChart').innerHTML = c.html;
  $('stSubj').innerHTML = subjHTML(days, c.keys, n);
  const sh = slotsHTML(); $('stSlots').innerHTML = sh; $('stSlots').hidden = !sh;
  $('logBody').innerHTML = logHTML();
  if (!editingId && document.activeElement?.closest?.('#manualForm') == null) { const v = $('mSubj').value; $('mSubj').innerHTML = subjOptions(subj(v) ? v : (subj(ui.subj) ? ui.subj : db.study.subjects[0]?.id)); }
}
export function init() {
  $('rangeTabs').addEventListener('click', e => { const b = e.target.closest('[data-range]'); if (!b) return; ui.range = +b.dataset.range; saveUI(); render(); });
  $('manualForm').addEventListener('submit', e => {
    e.preventDefault();
    const sid = $('mSubj').value, min = +$('mMin').value, date = $('mDate').value;
    if (!subj(sid)) { $('mMsg').textContent = '科目を選んでください。'; return; }
    if (!date) { $('mMsg').textContent = '日付を入れてください。'; return; }
    if (!(min >= 1 && min <= 1440)) { $('mMsg').textContent = '分は1〜1440で入れてください。'; return; }
    // 時刻がなければ、その日の正午に始めたことにする。4時前は次の日の夜中
    const [y, mo, d] = date.split('-').map(Number); const [hh, mm] = ($('mTime').value || '12:00').split(':').map(Number);
    let startMs = new Date(y, mo - 1, d, hh, mm).getTime(); if (hh < DAY_START_H) startMs += 86400000;
    const old = editingId ? db.study.sessions.find(s => s.id === editingId) : null;
    const rec = {id: editingId || uid(), subjectId: sid, subjectName: subj(sid).name, start: new Date(startMs).toISOString(), end: new Date(startMs + min * 60000).toISOString(), sec: min * 60, kind: old ? old.kind : 'manual', memo: $('mMemo').value.trim(), updatedAt: nowISO()};
    if (old && old.slot) rec.slot = Object.assign({}, old.slot, {fixed: true}); // 手で直した時間割の記録は、あとから自動で縮めない
    const i = db.study.sessions.findIndex(s => s.id === rec.id); if (i >= 0) db.study.sessions[i] = rec; else db.study.sessions.push(rec);
    $('mMsg').textContent = `${rec.subjectName} ${dur(rec.sec)}を${editingId ? '直しました' : '足しました'}。`;
    resetManual(); changed('study'); render();
  });
  $('mCancel').addEventListener('click', () => { resetManual(); $('mMsg').textContent = ''; });
  $('logBody').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]'); if (ed) { startEdit(ed.dataset.edit); return; }
    const del = e.target.closest('[data-del]'); if (!del || !armed(del)) return;
    const s = db.study.sessions.find(x => x.id === del.dataset.del); if (!s) return;
    s.deleted = true; delete s.covered; s.updatedAt = nowISO(); changed('study'); render();
  });
  $('moreBtn').addEventListener('click', () => { logDays += 30; render(); });
  resetManual();
}
