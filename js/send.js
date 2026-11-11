// 「送る」の画面：間違えた問題を study-inbox の inbox/<id>/ に送る（受け箱アプリと同じ形）
import { $, $$ } from './dom.js';
import { api, ghReady, ui, saveUI } from './store.js';
import { esc, pad, enc } from './util.js';

const SUBJECTS = ['数学', '物理', '化学', '英語', '国語', 'その他'];
const REASONS = ['方針が立たない', '計算ミス', '条件の見落とし', '論証の不備', '知識不足', '問題の読み違い', '時間切れ'];
const SOURCES = ['河野塾 数A', '河野塾 数B', '河野塾 数C', '河野塾 数Ⅲ', 'ハイレベル物理', 'ハイレベル物理演習', 'ハイレベル化学', 'ハイレベル化学演習', '化学の新演習', '有機構造決定問題集', 'ハイレベル数学の完全攻略', '東大過去問', '共通テスト'];
const KINDS = ['problem', 'mine', 'answer'];

// ---------- 送る前の問題をためておく場所（この端末の IndexedDB。受け箱アプリとは別の名前） ----------
let dbp = null;
function idb() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('new-outbox', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('items', {keyPath: 'id'});
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction('items', mode); const st = t.objectStore('items');
    const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error);
  });
}
const putItem = it => tx('readwrite', s => s.put(it));
const allItems = () => tx('readonly', s => s.getAll());

// ---------- 写真を縮める（長い辺 1600px、JPEG） ----------
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = 1600, sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    const t = document.createElement('canvas'); const ts = 160 / Math.max(c.width, c.height); t.width = Math.round(c.width * ts); t.height = Math.round(c.height * ts);
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return {blob, thumb: t.toDataURL('image/jpeg', 0.7)};
  } finally { URL.revokeObjectURL(url); }
}
const b64blob = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

// ---------- フォーム ----------
const picked = {problem: [], mine: [], answer: []};
const reasons = new Set();
const setMsg = t => { $('sendMsg').textContent = t; };
function renderChips() {
  if (!SUBJECTS.includes(ui.sendSubject)) ui.sendSubject = '数学';
  $('sendSubj').innerHTML = SUBJECTS.map(s => `<button type="button" class="chip" role="radio" aria-checked="${s === ui.sendSubject}" data-s="${s}">${s}</button>`).join('');
  $('sendReasons').innerHTML = REASONS.map(s => `<button type="button" class="chip" aria-pressed="${reasons.has(s)}" data-r="${s}">${s}</button>`).join('');
  const recent = (ui.recentSources || []).filter(Boolean);
  $('sourceList').innerHTML = [...new Set([...recent, ...SOURCES])].map(s => `<option value="${esc(s)}"></option>`).join('');
}
function renderThumbs(kind) {
  $('th-' + kind).innerHTML = picked[kind].map((p, i) => `<span class="th"><img src="${p.thumb}" alt=""><button type="button" class="rm" data-kind="${kind}" data-i="${i}" aria-label="この写真を外す">×</button></span>`).join('');
}
// ほかの画面から、出典と科目を入れた状態で開く（過去問の「受け箱へ」）
export function prefill({subject, source}) {
  if (subject && SUBJECTS.includes(subject)) { ui.sendSubject = subject; saveUI(); }
  if (source != null) $('sendSource').value = source;
  renderChips(); setMsg('');
}

// ---------- GitHub へ ----------
async function putFile(path, content, message) {
  const r = await api(`/contents/${path}`, {method: 'PUT', body: JSON.stringify({message, content})});
  if (r.ok || r.status === 422) return true; // 422：前回の途中で同じファイルが送られている
  throw new Error('HTTP ' + r.status);
}
let sending = false;
async function sendAll() {
  if (!ghReady() || sending) return false;
  sending = true; let allOk = true;
  try {
    const items = (await allItems()).filter(i => i.status !== 'sent').sort((a, b) => a.id < b.id ? -1 : 1);
    for (const it of items) {
      try {
        const files = {};
        for (const k of KINDS) {
          files[k] = [];
          for (let i = 0; i < (it.photos[k] || []).length; i++) {
            const name = `${k}-${i + 1}.jpg`; files[k].push(name);
            const path = `inbox/${it.id}/${name}`;
            if (!it.sentFiles.includes(path)) { await putFile(path, await b64blob(it.photos[k][i]), `add ${it.id} ${name}`); it.sentFiles.push(path); await putItem(it); }
          }
        }
        const meta = {app: 'new', v: 1, id: it.id, createdAt: it.createdAt, subject: it.subject, source: it.source, reasons: it.reasons, memo: it.memo, files};
        await putFile(`inbox/${it.id}/meta.json`, enc(JSON.stringify(meta, null, 2)), `add ${it.id} meta`);
        it.status = 'sent'; it.sentAt = new Date().toISOString(); it.photos = {}; it.error = '';
        await putItem(it);
      } catch (err) {
        allOk = false; it.error = String(err.message || err); await putItem(it);
        if (/HTTP 40[13]/.test(it.error)) break;
      }
    }
  } finally { sending = false; await renderList(); refreshCount(); }
  return allOk;
}
let inboxN = null;
async function refreshCount() {
  if (!ghReady()) { inboxN = null; showCount(); return; }
  try {
    const r = await api('/contents/inbox', {cache: 'no-store'});
    if (r.status === 404) inboxN = 0;
    else if (r.ok) inboxN = (await r.json()).filter(x => x.type === 'dir').length;
  } catch (e) { /* 電波がないときはそのまま */ }
  showCount();
}
function showCount() { $('inboxCount').textContent = inboxN == null ? '' : ` いま受け箱で処理を待っているのは ${inboxN}件です。`; }

// ---------- 送った問題 ----------
let pendingN = 0;
export const waitingCount = () => pendingN;
let onCount = () => {};
async function renderList() {
  let items = [];
  try { items = (await allItems()).sort((a, b) => a.id < b.id ? 1 : -1); } catch (e) {}
  const pending = items.filter(i => i.status !== 'sent');
  pendingN = pending.length; onCount();
  $('retryBtn').hidden = !pending.length || !ghReady();
  $('queueNote').textContent = pending.length ? `まだ送れていない問題が${pending.length}件あります。${ghReady() ? '' : '設定で鍵を入れると送られます。'}` : (items.length ? 'すべて受け箱に送ってあります。' : 'この端末から送った問題はまだありません。');
  $('sentItems').innerHTML = items.slice(0, 40).map(it => {
    const d = new Date(it.createdAt);
    const when = `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const st = it.status === 'sent' ? '<span class="tag">送信済み</span>' : `<span class="tag warn">${it.error ? '送れていません' : '送信待ち'}</span>`;
    return `<li class="item"><img src="${it.thumb}" alt=""><div><div class="t">${esc(it.source || '出典なし')}</div><div class="s">${esc(it.subject)}・${when}${it.reasons.length ? '・' + esc(it.reasons.join('、')) : ''}</div>${it.memo ? `<div class="m">${esc(it.memo)}</div>` : ''}</div>${st}</li>`;
  }).join('');
}

export function render() { renderChips(); renderList(); if (inboxN == null) refreshCount(); else showCount(); }
export function init(countChanged) {
  onCount = countChanged || onCount;
  $('sendSubj').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (!b) return; ui.sendSubject = b.dataset.s; saveUI(); renderChips(); });
  $('sendReasons').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; const r = b.dataset.r; reasons.has(r) ? reasons.delete(r) : reasons.add(r); b.setAttribute('aria-pressed', String(reasons.has(r))); });
  KINDS.forEach(k => $('ph-' + k).addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    setMsg('写真を読み込み中…'); let bad = false;
    for (const f of files) { try { picked[k].push(await shrink(f)); } catch (err) { bad = true; } }
    renderThumbs(k); setMsg(bad ? '読み込めない写真がありました。' : '');
  }));
  $('sendForm').addEventListener('click', e => { const b = e.target.closest('.rm'); if (!b) return; picked[b.dataset.kind].splice(+b.dataset.i, 1); renderThumbs(b.dataset.kind); });
  $('sendForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!picked.problem.length) { setMsg('問題の写真を1枚以上入れてください。'); return; }
    const now = new Date();
    const id = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
    const source = $('sendSource').value.trim();
    const item = {id, createdAt: now.toISOString(), subject: ui.sendSubject, source, reasons: [...reasons], memo: $('sendMemo').value.trim(),
      photos: Object.fromEntries(KINDS.map(k => [k, picked[k].map(p => p.blob)])), thumb: picked.problem[0].thumb, status: 'pending', sentFiles: []};
    $('sendBtn').disabled = true;
    try {
      await putItem(item);
      KINDS.forEach(k => { picked[k] = []; renderThumbs(k); });
      reasons.clear(); $('sendMemo').value = ''; $('sendSource').value = '';
      if (source) { ui.recentSources = [source, ...(ui.recentSources || []).filter(x => x !== source)].slice(0, 8); saveUI(); }
      renderChips();
      setMsg(ghReady() ? '保存しました。送っています…' : '保存しました。設定で鍵を入れると送ります。');
      await renderList();
      if (ghReady()) { const ok = await sendAll(); setMsg(ok ? '受け箱に送りました。' : 'この端末に保存しました。電波が戻ったら自動で送ります（下の「まだ送れていない分を送る」でも送れます）。'); }
    } catch (err) { setMsg('この端末に保存できませんでした。写真を減らして、もう一度試してください。'); }
    finally { $('sendBtn').disabled = false; }
  });
  $('retryBtn').addEventListener('click', async () => { $('queueNote').textContent = '送っています…'; await sendAll(); });
  window.addEventListener('online', () => sendAll());
  renderList().then(() => { if (ghReady()) sendAll(); });
}
export const flush = () => sendAll();
