// 「記録」→ 講座：全体の進み具合と、講座ごとのチェックリスト
import { $, $$ } from './dom.js';
import { db, ui, saveUI, changed } from './store.js';
import { esc, nowISO, pct } from './util.js';
import { COURSES, COURSE, STAGES, GROUPS, flatItems, countCourse, bitOf, setBit, marksInDays } from './calc.js';
import KOUZA from '../data/kouza-data.js';

const barsHTML = (r, total) => '<div class="sbars">' + STAGES.map((s, i) =>
  `<div class="sbar ${s.k}"><span>${s.name}</span><span class="track"><span class="fill" style="width:${pct(r[i], total)}%"></span></span><span class="val">${r[i]}/${total}</span></div>`).join('') + '</div>';
const remainHTML = left => `<div class="remain"><span>未視聴</span><b class="${left ? '' : 'zero'}">${left}</b><span>本</span></div>`;

function renderOverview() {
  const items = db.kouza.items, week = marksInDays(items, 7);
  $('kzOverview').innerHTML = GROUPS.map(g => {
    let r = [0, 0, 0], t = 0;
    g.ids.forEach(id => { const c = countCourse(items, COURSE[id]); r = r.map((v, i) => v + c[i]); t += flatItems(COURSE[id]).length; });
    return `<div class="ov"><div class="ovtop"><h3>${g.name}</h3>${remainHTML(t - r[0])}</div><div class="sub">${g.sub}（全${t}本）</div>${barsHTML(r, t)}</div>`;
  }).join('') + `<p class="note" style="grid-column:1 / -1">直近7日に付けた印：視聴 ${week[0]}・演習 ${week[1]}・復習 ${week[2]}</p>`;
}
function renderTabs() {
  if (!COURSE[ui.kouzaTab]) ui.kouzaTab = COURSES[0].id;
  const btn = c => `<button class="chip" role="tab" type="button" data-ktab="${c.id}" aria-checked="${c.id === ui.kouzaTab}" aria-selected="${c.id === ui.kouzaTab}">${esc(c.name)}</button>`;
  $('kzTabs').innerHTML = KOUZA.science.map(btn).join('') + '<span class="grp">河野塾</span>' + KOUZA.kono.map(btn).join('');
}
const secKey = (cid, s) => cid + ':' + s.start;
function renderCourse() {
  const c = COURSE[ui.kouzaTab], items = db.kouza.items, f = +ui.kouzaFilter || 0;
  const all = flatItems(c), total = countCourse(items, c);
  let html = `<div class="card"><div class="ovtop"><div class="chead"><span>${esc(c.full)}</span></div>${remainHTML(all.length - total[0])}</div><p class="note">全${all.length}本${c.num ? '・番号は動画の通し番号' : ''}</p>${barsHTML(total, all.length)}</div>`;
  let shown = 0;
  for (const ch of c.chapters) {
    let chHTML = '';
    for (const s of ch.sections) {
      const nums = s.items.map((_, i) => s.start + i), r = countCourse(items, c, nums), n = nums.length;
      const rows = s.items.map((label, i) => {
        const num = s.start + i, b = bitOf(items, c.id, num), hide = f && (b & f);
        return `<li class="krow${b === 7 ? ' all' : ''}" data-n="${num}"${hide ? ' hidden' : ''}><span class="knum">${c.num ? String(num).padStart(3, '0') : ''}</span><span class="klabel">${esc(label)}</span>` +
          `<span class="kchips">${STAGES.map(x => `<button type="button" class="kchip ${x.k}" data-bit="${x.bit}" aria-pressed="${!!(b & x.bit)}" aria-label="${esc(label)} ${x.name}">${x.name}</button>`).join('')}</span></li>`;
      });
      const visible = f ? nums.filter(k => !(bitOf(items, c.id, k) & f)).length : n;
      if (visible) shown++;
      const key = secKey(c.id, s), isOpen = ui.kouzaOpen[key] ?? !c.num, fin = r[0] === n && r[1] === n && r[2] === n;
      const rng = c.num ? `${String(s.start).padStart(3, '0')}–${String(s.start + n - 1).padStart(3, '0')}` : (s.sub || '');
      chHTML += `<details class="sec" data-key="${key}" data-start="${s.start}" data-len="${n}"${isOpen ? ' open' : ''}${visible ? '' : ' hidden'}>` +
        `<summary><span class="sname">${esc(s.name)}<span class="range">${esc(rng)}</span>${fin ? '<span class="tag fin">完了</span>' : ''}</span>` +
        `<span class="scount">${STAGES.map((x, i) => `<span class="${x.k}">${x.name[0]} <i>${r[i]}</i>/${n}</span>`).join('')}</span>` +
        `<span class="stripe">${STAGES.map((x, i) => `<span class="${x.k}" style="--p:${pct(r[i], n)}%"></span>`).join('')}</span></summary>` +
        `<div class="bulk">まとめて：${STAGES.map(x => `<button type="button" class="tool sm" data-bulk="${x.bit}">${x.name}</button>`).join('')}</div>` +
        `<ol class="rows">${rows.join('')}</ol></details>`;
    }
    html += `<div class="chapter">${ch.name ? `<h3>${esc(ch.name)}</h3>` : ''}${chHTML}</div>`;
  }
  if (!shown) html += '<p class="empty">この条件に当てはまる動画はありません。</p>';
  $('kzCourse').innerHTML = html;
}
export function render() { renderOverview(); renderTabs(); renderCourse(); $('kzFilter').value = String(+ui.kouzaFilter || 0); }
function afterChange() { changed('kouza'); const y = window.scrollY; renderOverview(); renderCourse(); window.scrollTo(0, y); }
export function init() {
  $('kzTabs').addEventListener('click', e => { const b = e.target.closest('[data-ktab]'); if (!b) return; ui.kouzaTab = b.dataset.ktab; saveUI(); renderTabs(); renderCourse(); });
  $('kzFilter').addEventListener('change', e => { ui.kouzaFilter = +e.target.value; saveUI(); renderCourse(); });
  const setAllOpen = v => { $$('#kzCourse details.sec').forEach(d => { d.open = v; ui.kouzaOpen[d.dataset.key] = v; }); saveUI(); };
  $('kzOpenAll').addEventListener('click', () => setAllOpen(true));
  $('kzCloseAll').addEventListener('click', () => setAllOpen(false));
  $('kzCourse').addEventListener('toggle', e => { const d = e.target; if (!d.matches || !d.matches('details.sec')) return; ui.kouzaOpen[d.dataset.key] = d.open; saveUI(); }, true);
  $('kzCourse').addEventListener('click', e => {
    const cid = ui.kouzaTab, items = db.kouza.items, stamp = nowISO();
    const chip = e.target.closest('.kchip');
    if (chip) {
      const n = +chip.closest('.krow').dataset.n, bit = +chip.dataset.bit;
      setBit(items, cid, n, bit, !(bitOf(items, cid, n) & bit), stamp); afterChange(); return;
    }
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) {
      const d = bulk.closest('details.sec'), start = +d.dataset.start, len = +d.dataset.len, bit = +bulk.dataset.bulk;
      let all = true; for (let i = 0; i < len; i++) if (!(bitOf(items, cid, start + i) & bit)) { all = false; break; }
      for (let i = 0; i < len; i++) setBit(items, cid, start + i, bit, !all, stamp);
      afterChange();
    }
  });
}
