// 画面を実際に動かして確かめる。GitHub は偽物（メモリの中）を使う
// 使い方: python3 -m http.server 8765 を別で立ててから
//   NODE_PATH=/opt/npm-tools/node_modules TZ=Asia/Tokyo STUDY_INBOX=../study-inbox node tests/browser.mjs [場面...]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8765/';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(OUT, {recursive: true});
const INBOX = process.env.STUDY_INBOX;
const b64 = t => Buffer.from(t, 'utf8').toString('base64');
const unb64 = t => Buffer.from(t, 'base64').toString('utf8');

// ---------- 偽の GitHub ----------
export function fakeGitHub(seed = {}) {
  const files = new Map(); let n = 0; const log = [];
  const put = (p, text) => files.set(p, {sha: 'sha' + (++n), content: b64(text)});
  for (const [p, text] of Object.entries(seed)) put(p, text);
  const handler = async route => {
    const req = route.request(), url = new URL(req.url()), m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+(\/.*)?$/);
    const json = (status, body) => route.fulfill({status, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(body)});
    if (req.method() === 'OPTIONS') return route.fulfill({status: 204, headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}});
    if (!m) return json(404, {});
    const rest = m[1] || '';
    if (handler.offline) return route.abort('internetdisconnected');
    if (handler.status) return json(handler.status, {message: 'forced'});
    if (rest === '') return json(200, {private: true, name: 'study-inbox'});
    if (rest.startsWith('/contents/')) {
      const p = decodeURIComponent(rest.slice('/contents/'.length));
      if (req.method() === 'GET') {
        const f = files.get(p);
        if (f) return json(200, {sha: f.sha, content: f.content, encoding: 'base64', type: 'file'});
        const dirs = new Set(); for (const k of files.keys()) if (k.startsWith(p + '/')) dirs.add(k.slice(p.length + 1).split('/')[0]);
        if (dirs.size) return json(200, [...dirs].map(name => ({name, type: 'dir'})));
        return json(404, {message: 'Not Found'});
      }
      if (req.method() === 'PUT') {
        const body = JSON.parse(req.postData()), f = files.get(p);
        if (f && !body.sha) return json(422, {message: 'sha missing'});
        if (f && body.sha !== f.sha) return json(409, {message: 'conflict'});
        files.set(p, {sha: 'sha' + (++n), content: body.content}); log.push({path: p, message: body.message});
        return json(f ? 200 : 201, {content: {sha: 'sha' + n}});
      }
    }
    return json(404, {});
  };
  return {handler, files, log, put, read: p => files.has(p) ? unb64(files.get(p).content) : null, json: p => files.has(p) ? JSON.parse(unb64(files.get(p).content)) : null};
}
export const seedFromInbox = () => {
  const seed = {};
  if (!INBOX) return seed;
  for (const f of ['study-log.json', 'kouza.json', 'scores.json', 'listening.json']) { const p = path.join(INBOX, 'records', f); if (fs.existsSync(p)) seed['records/' + f] = fs.readFileSync(p, 'utf8'); }
  seed['inbox/20261107-155014-cssa/meta.json'] = '{}';
  return seed;
};

export async function open({seed = seedFromInbox(), time = '2026-11-11T09:10:00+09:00', gh = true, viewport = {width: 390, height: 844}, storage = {}} = {}) {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']});
  const ctx = await browser.newContext({viewport, deviceScaleFactor: 2, timezoneId: 'Asia/Tokyo', locale: 'ja-JP', hasTouch: true});
  const hub = fakeGitHub(seed);
  await ctx.route('https://api.github.com/**', hub.handler);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const init = Object.assign({}, storage);
  if (gh) init['study-inbox-settings-v1'] = JSON.stringify({owner: 'visby314', repo: 'study-inbox', token: 'test-token'});
  await ctx.addInitScript(v => { if (!sessionStorage.getItem('seeded')) { for (const [k, x] of Object.entries(v)) localStorage.setItem(k, x); sessionStorage.setItem('seeded', '1'); } }, init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install({time: new Date(time)});
  await page.goto(BASE);
  await page.waitForFunction(() => document.getElementById('tdSum') && document.getElementById('tdSum').children.length > 0);
  const settle = async (ms = 1500) => { await page.clock.runFor(ms); await page.waitForTimeout(150); };
  const shot = async (name, full = true) => { await page.screenshot({path: path.join(OUT, name + '.png'), fullPage: full}); };
  const tab = async t => { await page.click(`#tabbar [data-tab="${t}"]`); await page.waitForTimeout(50); };
  return {browser, ctx, page, hub, errors, settle, shot, tab, close: () => browser.close()};
}

// ---------- 場面 ----------
const scenes = {};
scenes.smoke = async () => {
  const t = await open();
  await t.settle();
  await t.shot('01-today-empty');
  for (const [name, tab] of [['02-send', 'send'], ['03-record', 'record'], ['04-settings', 'settings']]) { await t.tab(tab); await t.settle(300); await t.shot(name); }
  await t.tab('record'); await t.page.click('#recTabs [data-rec="scores"]'); await t.shot('05-scores');
  await t.page.click('#recTabs [data-rec="kouza"]'); await t.shot('06-kouza');
  console.log('status:', await t.page.textContent('#sync'), '| puts:', JSON.stringify(t.hub.log));
  if (t.errors.length) console.log('ERRORS', t.errors);
  await t.close();
  return t.errors;
};

const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const check = (errs, cond, msg) => { if (!cond) { errs.push('NG: ' + msg); console.log('  NG', msg); } else console.log('  ok', msg); };

// 時間割を作る → 今日のコマに答える → コマを計る → 古い形のまま GitHub に入っているか
scenes.timetable = async () => {
  const t = await open(), {page, hub, errors} = t;
  await t.settle();
  await page.click('#runBtns [data-act="make-tt"]');
  await page.click('#ttEditor [data-tt="create"]');
  await page.click('#ttEditor [data-tt="gen-toggle"]');
  await t.shot('10-tt-gen');
  await page.click('#ttEditor [data-tt="gen-ok"]');
  check(errors, (await page.locator('#ttEditor .ttrow').count()) === 9, '06:00〜21:30 を90分+10分で9コマ');
  // 2コマ目を物理にして、メモを入れる
  await page.locator('#ttEditor .ttrow').nth(1).locator('select').selectOption('butsuri');
  await page.locator('#ttEditor .ttrow').nth(1).locator('input.memo').fill('ハイレベル物理');
  await page.locator('#ttEditor .ttrow').nth(1).locator('input.memo').blur();
  // 3コマ目の時刻を 09:20〜10:50 → 09:30〜11:00 に
  await page.locator('#ttEditor .ttrow').nth(2).locator('input[data-f="s"]').fill('09:30');
  await page.locator('#ttEditor .ttrow').nth(2).locator('input[data-f="e"]').fill('11:00');
  await page.locator('#ttEditor .ttrow').nth(2).locator('input[data-f="e"]').blur();
  await page.click('#ttEditor [data-copy="all"]');
  await page.click('#ttEditor [data-tt="copy-ok"]'); await page.click('#ttEditor [data-tt="copy-ok"]');
  await t.settle();
  await t.shot('11-tt-editor');
  const tt = hub.json('records/timetable.json');
  check(errors, tt && tt.tables.length === 1 && [0, 1, 2, 3, 4, 5, 6].every(w => tt.tables[0].days[w].length === 9), 'timetable.json に7曜日×9コマ');
  await t.tab('today'); await t.settle(600);
  await t.shot('12-today-pending');
  check(errors, (await page.locator('#tdSlots li.slot[data-st="pending"]').count()) === 2, '9:10 の時点で、終わった2コマが「答えていない」');
  check(errors, (await text(page, '#badgeToday')) === '2', 'タブの数字が2');
  await page.locator('#tdSlots li.slot[data-st="pending"]').first().locator('[data-sact="done"]').click();
  await page.locator('#tdSlots li.slot[data-st="pending"]').first().locator('[data-sact="skip"]').click();
  await t.settle();
  check(errors, /1時間30分/.test(await text(page, '#tdSum')), '「やった」で今日の合計が1時間30分');
  let log = hub.json('records/study-log.json');
  const S = log.sessions.find(s => s.kind === 'slot');
  check(errors, S && S.id.startsWith('tt-2026-11-11-') && S.sec === 5400 && S.slot.full === 5400 && S.subjectName === '数学', 'study-log.json に kind:slot の記録');
  check(errors, Object.values(hub.json('records/timetable.json').marks['2026-11-11']).some(m => m.st === 'skip'), 'timetable.json に「やってない」の印');
  // 9:35、3コマ目の途中 → 始める → 30分後に終わる
  await page.clock.fastForward(25 * 60000); await t.settle(1200);
  check(errors, /いまのコマ 9:30–11:00/.test(await text(page, '#tdSlot')), '9:35 に「いまのコマ」が出る');
  await t.shot('13-today-now');
  await page.click('#runBtns [data-act="start-slot"]');
  await page.clock.fastForward(30 * 60000); await t.settle(600);
  await t.shot('14-today-running');
  await page.click('#runBtns [data-act="finish"]');
  await t.settle();
  log = hub.json('records/study-log.json');
  const R = log.sessions.find(s => s.kind === 'sw' && s.start.startsWith('2026-11-11'));
  check(errors, R && Math.abs(R.sec - 1800) < 5, 'コマを計った記録が30分');
  check(errors, (await page.locator('#tdSlots li.slot[data-st="run"]').count()) === 1, '計ったコマは「計った」になる');
  // 科目が違う：2コマ目（やってない）を直して、英語でやったことにする
  const row = page.locator('#tdSlots li.slot[data-st="skip"]');
  await row.locator('[data-sact="edit"]').click();
  await page.locator('#tdSlots li.slot[data-st="skip"] [data-sact="alt"]').click();
  await page.locator('#tdSlots li.slot[data-st="skip"] [data-alt="eigo"]').click();
  await t.settle();
  check(errors, /予定は物理/.test(await text(page, '#tdSlots')), '科目が違う → 英語でやった（予定は物理）');
  await t.shot('15-today-after');
  await t.tab('record'); await t.settle(300); await t.shot('16-record-time');
  // 同じ中身で、もう一度開いても書き換えが起きない
  const before = hub.log.length;
  await page.reload(); await t.settle(2500);
  check(errors, hub.log.length === before, '開き直しても GitHub を書き換えない');
  check(errors, (await text(page, '#sync')) === '同期済み', '同期済み');
  fs.mkdirSync(path.join(OUT, 'records'), {recursive: true});
  for (const f of ['study-log.json', 'kouza.json', 'scores.json', 'timetable.json', 'listening.json']) if (hub.read('records/' + f)) fs.writeFileSync(path.join(OUT, 'records', f), hub.read('records/' + f));
  if (errors.length) console.log('ERRORS', errors);
  await t.close();
  return errors;
};

const which = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0;
  for (const name of (which.length ? which : Object.keys(scenes))) {
    if (!scenes[name]) { console.log('no scene', name); continue; }
    console.log('== ' + name);
    const errs = await scenes[name]();
    if (errs && errs.length) bad++;
  }
  process.exit(bad ? 1 : 0);
}
export { scenes };
