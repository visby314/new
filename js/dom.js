// 画面まわりの小道具
export const $ = id => document.getElementById(id);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// 消すボタンなど：1回目は確かめる文に変え、2回目で true を返す
export function armed(btn, text = 'もう一度押すと消します') {
  if (btn.dataset.armed === '1') { btn.dataset.armed = ''; return true; }
  btn.dataset.armed = '1'; btn.dataset.label = btn.textContent; btn.textContent = text;
  setTimeout(() => { if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = btn.dataset.label; } }, 4000);
  return false;
}

// 下に出る短い知らせ。undo を渡すと「取り消す」が出る
let toastTimer = 0, toastUndo = null;
export function toast(text, undo, ms = 5000) {
  $('toastText').textContent = text;
  toastUndo = undo || null;
  $('toastUndo').hidden = !undo;
  $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; toastUndo = null; }, ms);
}
export function initToast() {
  $('toastUndo').addEventListener('click', () => { const fn = toastUndo; toastUndo = null; $('toast').hidden = true; clearTimeout(toastTimer); if (fn) fn(); });
}

// 入力の途中かどうか（途中なら、その場所の描き直しを見送る）
export function typingIn(el) {
  const a = document.activeElement;
  return !!(a && el && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}

// 画面の移動（main.js が中身を入れる）
export const nav = {goto: () => {}};

// ---- 音・振動・画面を消さない ----
let actx = null;
export function unlockAudio() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) {} }
export function beep(times = 4) {
  try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) {}
  if (!actx) return;
  try {
    const t0 = actx.currentTime + 0.05;
    for (let i = 0; i < times; i++) {
      const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = i % 2 ? 660 : 880;
      o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, t0 + i * 0.35); g.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.35 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.28);
      o.start(t0 + i * 0.35); o.stop(t0 + i * 0.35 + 0.3);
    }
  } catch (e) {}
}
let wl = null;
export async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) { if (!wl) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); } }
    else if (!on && wl) { await wl.release(); wl = null; }
  } catch (e) { wl = null; }
}
