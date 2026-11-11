// 起動、画面の切り替え、同期の合図
import { $, $$, initToast, nav, unlockAudio } from './dom.js';
import { ui, saveUI, onData, onStatus, sync, syncAll, ghReady, lastSyncAge, status } from './store.js';
import * as today from './today.js';
import * as send from './send.js';
import * as recTime from './rec-time.js';
import * as recScores from './rec-scores.js';
import * as recKouza from './rec-kouza.js';
import * as settings from './settings.js';
import { checkAlerts } from './notify.js';

const TITLES = {today: ['TODAY', '今日'], send: ['SEND', '送る'], record: ['RECORDS', '記録'], settings: ['SETTINGS', '設定']};
const REC = {time: recTime, scores: recScores, kouza: recKouza};

function renderRecord() {
  if (!REC[ui.recTab]) ui.recTab = 'time';
  $$('#recTabs [data-rec]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.rec === ui.recTab)));
  for (const k of Object.keys(REC)) $('rec-' + k).hidden = k !== ui.recTab;
  REC[ui.recTab].render();
}
function renderTab() {
  if (ui.tab === 'today') today.render();
  else if (ui.tab === 'send') send.render();
  else if (ui.tab === 'record') renderRecord();
  else if (ui.tab === 'settings') settings.render();
}
function badges() {
  const n = today.pendingCount(); $('badgeToday').hidden = !n; $('badgeToday').textContent = n > 99 ? '99+' : String(n);
  const w = send.waitingCount(); $('badgeSend').hidden = !w; $('badgeSend').textContent = String(w);
  $('setupBanner').hidden = ghReady() || ui.tab === 'settings';
}
function show(tab, section) {
  if (!TITLES[tab]) tab = 'today';
  ui.tab = tab; saveUI();
  $$('#tabbar [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('.wrap > .view').forEach(v => { v.hidden = v.id !== 'view-' + tab; });
  $('title').dataset.en = TITLES[tab][0]; $('title').textContent = TITLES[tab][1];
  if (tab === 'record' && section && REC[section]) ui.recTab = section;
  renderTab(); badges();
  if (tab === 'settings' && section) settings.open(section);
  else window.scrollTo(0, 0);
}
nav.goto = show;

function boot() {
  initToast();
  today.init(); send.init(badges); recTime.init(); recScores.init(); recKouza.init();
  settings.init(ok => { badges(); if (ok) { syncAll(); send.flush(); } });
  $('tabbar').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  $('recTabs').addEventListener('click', e => { const b = e.target.closest('[data-rec]'); if (!b) return; ui.recTab = b.dataset.rec; saveUI(); renderRecord(); });
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]'); if (!g) return;
    const [tab, section] = g.dataset.goto.split(':'); show(tab, section);
  });
  document.addEventListener('pointerdown', unlockAudio, {once: true});
  onStatus(s => { $('sync').textContent = s.text; $('sync').dataset.kind = s.kind; });
  onData(src => { badges(); if (src === 'remote') renderTab(); });

  show(ui.tab);
  $('sync').textContent = status.text;
  syncAll();
  window.addEventListener('online', () => sync(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    renderTab(); badges();
    if (lastSyncAge() > 60000) syncAll(); // ほかの端末や前のアプリで付けた記録を取りに行く
  });
  setInterval(() => { if (ui.tab === 'today') today.tick(); else if (ui.tab === 'record') recScores.tick(); }, 500);
  setInterval(() => { checkAlerts(); badges(); }, 10000);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
