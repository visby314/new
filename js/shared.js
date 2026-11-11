// いくつかの画面で使う、科目まわりの小道具
import { db } from './store.js';
import { esc } from './util.js';

export const subj = id => db.study.subjects.find(s => s.id === id);
export const subjName = (id, fallback) => (subj(id) || {}).name || fallback || '？';
export const subjColor = id => (subj(id) || {}).color || '#6b7280';
export const dotHTML = id => `<i class="dot" style="--c:${subjColor(id)}"></i>`;
export const subjOptions = sel => db.study.subjects.map(s => `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
export const subjChips = (cur, attr = 'data-subj', disabled = false) => db.study.subjects.map(s =>
  `<button type="button" class="chip" role="radio" aria-checked="${s.id === cur}" ${attr}="${s.id}"${disabled ? ' disabled' : ''}>${dotHTML(s.id)}${esc(s.name)}</button>`).join('');
