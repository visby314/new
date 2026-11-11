// コマの始まりと終わりを知らせる。アプリを開いている間だけ動く。閉じている間のために、カレンダー用のファイルも作れる
import { db, ui } from './store.js';
import { slotsFor, liveTables } from './tt.js';
import { todayKey, hm, pad, shiftDay, weekdayIdx, slotRange } from './util.js';
import { subjName } from './shared.js';
import { beep, toast } from './dom.js';

const LS = 'new-alert-fired-v1';
let fired = [];
try { fired = JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) {}
let lastCheck = Date.now();

export const canNotify = () => 'Notification' in window;
export const permission = () => canNotify() ? Notification.permission : 'unsupported';
export async function askPermission() {
  if (!canNotify()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch (e) { return Notification.permission; }
}
export async function fire(title, body, tag) {
  toast(body ? `${title}　${body}` : title, null, 9000);
  if (ui.alertSound) beep(2);
  if (permission() !== 'granted') return;
  const opt = {body, tag, icon: 'icon-192.png'};
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg && reg.showNotification) await reg.showNotification(title, opt); else new Notification(title, opt);
  } catch (e) { try { new Notification(title, opt); } catch (e2) {} }
}
// 10秒おきくらいに呼ぶ。前に見た時刻から今までに、コマの始まり・終わりをまたいだら知らせる
export function checkAlerts() {
  const now = Date.now(), from = Math.max(lastCheck, now - 120000); // 2分より前の分は、いまさら出さない
  lastCheck = now;
  if ((!ui.alertStart && !ui.alertEnd) || !liveTables(db.tt).length) return;
  const day = todayKey(), slots = slotsFor(db.tt, day);
  let ended = null, started = null;
  for (const s of slots) {
    if (ui.alertEnd && s.endMs > from && s.endMs <= now && !fired.includes(`${day}|e|${s.id}`)) { ended = s; fired.push(`${day}|e|${s.id}`); }
    if (ui.alertStart && s.startMs > from && s.startMs <= now && !fired.includes(`${day}|s|${s.id}`)) { started = s; fired.push(`${day}|s|${s.id}`); }
  }
  if (!ended && !started) return;
  fired = fired.slice(-40); try { localStorage.setItem(LS, JSON.stringify(fired)); } catch (e) {}
  const nm = s => subjName(s.subjectId), span = s => `${hm(s.startMs)}〜${hm(s.endMs)}`;
  if (ended && started) fire(`${nm(ended)}のコマが終わりました`, `次は${nm(started)}（${span(started)}）です。`, 'koma');
  else if (started) fire(`${nm(started)}の時間です`, `${span(started)}${started.memo ? ' ' + started.memo : ''}`, 'koma');
  else fire(`${nm(ended)}のコマが終わりました`, 'やったかどうかを「今日」で答えてください。', 'koma');
}

// ---------- 時間割をカレンダーに入れるためのファイル（.ics） ----------
const icsText = t => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = ms => { const d = new Date(ms); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`; };
export function buildICS() {
  const today = todayKey();
  const tables = liveTables(db.tt).filter(t => t.from).sort((a, b) => a.from < b.from ? -1 : 1);
  const lastDay = shiftDay((db.study.plan && db.study.plan.end) || '2027-02-25', -1);
  const ev = [];
  tables.forEach((t, i) => {
    const next = tables[i + 1];
    const start = t.from > today ? t.from : today, until = next ? shiftDay(next.from, -1) : lastDay;
    if (until < start) return;
    for (let w = 0; w < 7; w++) {
      const first = shiftDay(start, (w - weekdayIdx(start) + 7) % 7);
      if (first > until) continue;
      for (const s of (t.days[w] || [])) {
        if (!s.s || !s.e) continue;
        const [a, b] = slotRange(first, s.s, s.e), [ua] = slotRange(until, s.s, s.e);
        const name = subjName(s.subjectId) + (s.memo ? ' ' + s.memo : '');
        ev.push(['BEGIN:VEVENT', `UID:${t.id}-${s.id}-${w}@new.study`, `DTSTAMP:${icsTime(Date.now())}`, `DTSTART:${icsTime(a)}`, `DTEND:${icsTime(b)}`,
          `RRULE:FREQ=WEEKLY;UNTIL=${icsTime(ua)}`, `SUMMARY:${icsText(name)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(name)}`, 'TRIGGER:PT0S', 'END:VALARM', 'END:VEVENT'].join('\r\n'));
      }
    }
  });
  if (!ev.length) return '';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//new//jikanwari//JA', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:時間割', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
export async function shareICS() {
  const text = buildICS();
  if (!text) return '時間割にコマがありません。先に時間割を入れてください。';
  const file = new File([text], 'jikanwari.ics', {type: 'text/calendar'});
  try {
    if (navigator.canShare && navigator.canShare({files: [file]})) { await navigator.share({files: [file], title: '時間割'}); return '共有の画面で「カレンダー」を選ぶと入ります。時間割を変えたときは、カレンダーの前の予定を消してから入れ直してください。'; }
  } catch (e) { if (e && e.name === 'AbortError') return ''; }
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = 'jikanwari.ics'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
  return 'jikanwari.ics を保存しました。開くとカレンダーに入れられます。時間割を変えたときは、カレンダーの前の予定を消してから入れ直してください。';
}
