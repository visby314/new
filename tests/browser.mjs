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

export async function open({seed = seedFromInbox(), time = '2026-11-11T09:10:00+09:00', gh = true, viewport = {width: 390, height: 844}, storage = {}, hub = null, url = BASE, ready = true} = {}) {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']});
  const ctx = await browser.newContext({viewport, deviceScaleFactor: 2, timezoneId: 'Asia/Tokyo', locale: 'ja-JP', hasTouch: true});
  hub = hub || fakeGitHub(seed);
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
  await page.goto(url);
  if (ready) await page.waitForFunction(() => document.getElementById('tdSum') && document.getElementById('tdSum').children.length > 0);
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

// 普通に計る、ノルマ、講座、送る、過去問、設定、電波なし
scenes.flows = async () => {
  const t = await open(), {page, hub, errors} = t;
  await t.settle();
  // --- 普通に計る：物理をタイマー25分 ---
  await page.click('#tdMode [data-mode="free"]');
  await page.click('#subjChips [data-subj="butsuri"]');
  await page.click('#runModes [data-rmode="timer"]');
  await page.click('#presets [data-min="25"]');
  await page.fill('#runMemo', 'ハイレベル物理 3');
  await t.shot('20-free-timer');
  await page.click('#runBtns [data-act="start-free"]');
  await page.clock.fastForward(10 * 60000); await t.settle(600);
  await t.shot('21-free-running', false);
  await page.clock.fastForward(16 * 60000); await t.settle(2500);
  let log = hub.json('records/study-log.json');
  let R = log.sessions.find(s => s.kind === 'timer' && s.memo === 'ハイレベル物理 3');
  check(errors, R && R.sec === 1500 && R.subjectId === 'butsuri', 'タイマー25分が終わると自動で記録');
  // --- ノルマ ＋1 ---
  await page.click('#tdBooks [data-add="1"]'); await t.settle();
  log = hub.json('records/study-log.json');
  check(errors, log.books[0].log.some(x => x.d === '2026-11-11' && x.n === 1), 'ノルマ＋1 が books の log に入る');
  check(errors, /今日あと 1題/.test(await text(page, '#tdBooks')), '今日あと1題になる');
  // --- 講座：見た → 取り消す → もう一度 ---
  await page.locator('#tdKouza [data-kz="kagaku:1:1"]').click();
  check(errors, /ハイレベル化学2/.test(await text(page, '#tdKouza')), '見たを押すと次の1本に進む');
  await page.click('#toastUndo');
  check(errors, /ハイレベル化学1/.test(await text(page, '#tdKouza')), '取り消すと戻る');
  await page.locator('#tdKouza [data-kz="kagaku:1:1"]').click(); await t.settle();
  let kz = hub.json('records/kouza.json');
  check(errors, kz.items['kagaku:1'].b === 1 && kz.items['kagaku:1'].d['1'] === '2026-11-11' && kz.summary.find(x => x.id === 'kagaku').視聴 === 1 && kz.app === 'kouza-checklist', 'kouza.json が前のアプリと同じ形');
  await t.shot('22-today-free');
  // --- 送る ---
  await t.tab('send');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
  await page.setInputFiles('#ph-problem', {name: 'p.png', mimeType: 'image/png', buffer: png});
  await page.setInputFiles('#ph-answer', {name: 'a.png', mimeType: 'image/png', buffer: png});
  await page.waitForSelector('#th-answer img');
  await page.click('#sendSubj [data-s="物理"]');
  await page.fill('#sendSource', 'ハイレベル物理 3');
  await page.click('#sendReasons [data-r="計算ミス"]');
  await page.fill('#sendMemo', '符号を落とした');
  await t.shot('23-send-form');
  await page.click('#sendBtn');
  await page.waitForFunction(() => /送りました/.test(document.getElementById('sendMsg').textContent), null, {timeout: 8000}).catch(() => {});
  const metaPath = [...hub.files.keys()].find(k => /^inbox\/20261111-.*\/meta\.json$/.test(k));
  const meta = metaPath && hub.json(metaPath);
  check(errors, meta && meta.subject === '物理' && meta.source === 'ハイレベル物理 3' && meta.reasons[0] === '計算ミス' && meta.files.problem[0] === 'problem-1.jpg' && meta.files.answer[0] === 'answer-1.jpg' && meta.files.mine.length === 0, '受け箱に meta.json が前と同じ形で届く');
  check(errors, metaPath && hub.files.has(metaPath.replace('meta.json', 'problem-1.jpg')), '問題の写真が届く');
  await t.shot('24-send-done');
  // --- 過去問 ---
  await t.tab('record'); await page.click('#recTabs [data-rec="scores"]');
  await page.click('#scAddBox > summary');
  await page.click('#tmBar [data-tm="start"]');
  await page.clock.fastForward(20 * 60000);
  await page.click('#parts [data-go="1"]');
  await page.clock.fastForward(15 * 60000); await t.settle(600);
  await page.click('#tmBar [data-tm="finish"]');
  const ins = page.locator('#parts input');
  await ins.nth(0).fill('15'); await ins.nth(1).fill('8'); await ins.nth(2).fill('20');
  await page.fill('#scMemo', '第2問で計算が合わない');
  await t.shot('25-scores-form');
  await page.click('#scSave'); await t.settle();
  const sc = hub.json('records/scores.json');
  const A = sc.attempts.find(a => a.examId === 'todai' && a.subjectId === 'sugaku');
  check(errors, A && A.label === '2026年度' && A.scores[0] === 15 && A.ptimes[0] === 1200 && Math.abs(A.ptimes[1] - 900) <= 2 && A.minutes === 35 && A.parts.length === 6, '過去問の記録（大問ごとの時間つき）が scores.json に入る');
  await t.shot('26-scores-after');
  await page.locator('#scList .adetail summary').first().click();
  await page.locator('#scList [data-send][data-part="1"]').first().click();
  check(errors, (await page.inputValue('#sendSource')) === '東大2次 2026年度 数学 第2問', '「受け箱へ」で送る画面に出典が入る');
  // --- 講座の表 ---
  await t.tab('record'); await page.click('#recTabs [data-rec="kouza"]');
  await page.click('#kzTabs [data-ktab="butsuri"]');
  await page.locator('#kzCourse .krow[data-n="2"] .kchip[data-bit="1"]').click(); await t.settle();
  kz = hub.json('records/kouza.json');
  check(errors, kz.items['butsuri:2'].b === 1 && kz.items['butsuri:1'].b === 1, '講座の表で印を付けられる（前の印も残る）');
  await t.shot('27-kouza');
  // --- 設定：教材を足す、目標を変える ---
  await t.tab('settings');
  await page.click('#set-books > summary');
  await page.fill('#bName', '化学の新演習'); await page.selectOption('#bSubj', 'kagaku'); await page.fill('#bTotal', '100'); await page.fill('#bDone', '10'); await page.fill('#bDeadline', '2026-12-31');
  await page.click('#bSave'); await t.settle();
  log = hub.json('records/study-log.json');
  const B = log.books.find(b => b.name === '化学の新演習');
  check(errors, B && B.total === 100 && B.base === 10 && B.unit === '問' && B.deadline === '2026-12-31' && B.created === '2026-11-11', '教材を足せる');
  await t.shot('28-settings-books');
  await page.click('#set-goal > summary');
  await t.shot('29-settings-goal');
  // --- 電波なし → 戻ったら送る ---
  hub.handler.offline = true;
  await t.tab('today'); await page.click('#tdBooks [data-add="1"]'); await t.settle(2500);
  check(errors, /この端末に保存中/.test(await text(page, '#sync')), '電波がないときは端末に保存');
  hub.handler.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await t.settle(2500);
  check(errors, (await text(page, '#sync')) === '同期済み', '電波が戻ると送る');
  // --- 2台目で変わった分を取り込む（別の端末が記録を足した想定） ---
  const remote = hub.json('records/study-log.json');
  remote.sessions.push({id: 'other-device-1', subjectId: 'kagaku', subjectName: '化学', start: '2026-11-11T00:30:00.000Z', end: '2026-11-11T01:00:00.000Z', sec: 1800, kind: 'sw', memo: '別の端末', updatedAt: '2026-11-11T01:00:00.000Z'});
  hub.put('records/study-log.json', JSON.stringify(remote, null, 1));
  await page.click('#tdBooks [data-add="1"]'); await t.settle(2500);
  const fin = hub.json('records/study-log.json');
  check(errors, fin.sessions.some(s => s.id === 'other-device-1') && fin.books.some(b => b.log.some(x => x.d === '2026-11-11' && x.n >= 2)), '別の端末の記録と自分の変更が両方残る');
  check(errors, /化学 30分/.test(await text(page, '#tdSum')), '別の端末の記録が画面に出る');
  fs.mkdirSync(path.join(OUT, 'records2'), {recursive: true});
  for (const f of ['study-log.json', 'kouza.json', 'scores.json']) fs.writeFileSync(path.join(OUT, 'records2', f), hub.read('records/' + f));
  if (errors.length) console.log('ERRORS', errors);
  await t.close();
  return errors;
};

// 鍵なしで始めて、あとから鍵を入れる
scenes.nokey = async () => {
  const t = await open({gh: false}), {page, hub, errors} = t;
  await t.settle();
  check(errors, await page.isVisible('#setupBanner'), '鍵がないと案内が出る');
  await page.click('#tdMode [data-mode="free"]');
  await page.click('#runBtns [data-act="start-free"]');
  await page.clock.fastForward(5 * 60000); await t.settle(600);
  await page.click('#runBtns [data-act="finish"]'); await t.settle();
  check(errors, hub.log.length === 0 && /5分/.test(await text(page, '#tdSum')), '鍵がなくても端末に記録できる');
  await t.shot('30-nokey');
  await page.click('#setupBanner [data-goto]');
  await page.fill('#owner', 'visby314'); await page.fill('#repo', 'study-inbox'); await page.fill('#token', 'tok');
  await page.click('#ghForm button[type=submit]'); await t.settle(3000);
  const log = hub.json('records/study-log.json');
  check(errors, /つながりました/.test(await text(page, '#ghMsg')), '鍵を入れるとつながる');
  check(errors, log.sessions.some(s => s.sec >= 300 && s.sec <= 302) && log.sessions.length === 7 && log.goalH === 13, '端末の記録が、前からの記録に足される');
  if (errors.length) console.log('ERRORS', errors);
  await t.close();
  return errors;
};

// このアプリで付けた記録を、前のアプリで開いても消えないこと（OLD_BASE に前のアプリを置いたサーバー）
scenes.oldapps = async () => {
  const OLD = process.env.OLD_BASE; if (!OLD) { console.log('  (OLD_BASE がないので飛ばす)'); return []; }
  const seed = seedFromInbox();
  for (const f of ['study-log.json', 'kouza.json', 'scores.json', 'timetable.json']) { const p = path.join(OUT, 'records', f); if (fs.existsSync(p)) seed['records/' + f] = fs.readFileSync(p, 'utf8'); }
  const hub = fakeGitHub(seed), errors = [];
  const slotIds = () => hub.json('records/study-log.json').sessions.filter(s => s.kind === 'slot').map(s => s.id + ':' + s.sec + ':' + JSON.stringify(s.slot)).sort().join('|');
  const before = slotIds(), ttBefore = hub.read('records/timetable.json');
  check(errors, before.length > 0, '時間割の記録が入った状態から始める');
  for (const app of ['kirocker2', 'checkiiii', 'oresamatenbuyer']) {
    const t = await open({hub, url: OLD + app + '/', ready: false, time: '2026-11-11T12:00:00+09:00'});
    await t.page.waitForTimeout(600); await t.settle(3000); await t.settle(1500);
    await t.shot('40-old-' + app, false);
    check(errors, slotIds() === before, `${app} を開いても時間割の記録が残る`);
    check(errors, hub.read('records/timetable.json') === ttBefore, `${app} は timetable.json に触らない`);
    if (t.errors.length) console.log('  (前のアプリのコンソール)', t.errors.slice(0, 2));
    await t.close();
  }
  console.log('  前のアプリが書いたもの:', JSON.stringify(hub.log));
  const n0 = hub.log.length;
  const t = await open({hub, time: '2026-11-11T12:05:00+09:00'});
  await t.settle(2500);
  check(errors, (await t.page.locator('#tdSlots li.slot[data-st="done"]').count()) === 2, 'このアプリに戻っても「やった」が残っている');
  check(errors, hub.log.length === n0, '戻ってきても書き換えが起きない');
  errors.push(...t.errors);
  for (const f of ['study-log.json', 'kouza.json', 'scores.json', 'timetable.json']) fs.writeFileSync(path.join(OUT, 'records', f), hub.read('records/' + f));
  await t.close();
  if (errors.length) console.log('ERRORS', errors);
  return errors;
};

// 知らせとカレンダー用ファイル（timetable の場面のあとに動かす）
scenes.alerts = async () => {
  const seed = seedFromInbox(); const p = path.join(OUT, 'records', 'timetable.json');
  if (!fs.existsSync(p)) { console.log('  (先に timetable の場面を動かす)'); return []; }
  seed['records/timetable.json'] = fs.readFileSync(p, 'utf8');
  const t = await open({seed, time: '2026-11-12T09:09:30+09:00'}), {page, errors} = t;
  await t.settle(2500);
  await page.clock.runFor(32000); await page.waitForTimeout(100);
  check(errors, /物理のコマが終わりました/.test(await text(page, '#toast')) && await page.isVisible('#toast'), '9:10 にコマの終わりを知らせる');
  await page.clock.fastForward(19 * 60000); await page.clock.runFor(60000); await page.waitForTimeout(100);
  check(errors, /数学の時間です/.test(await text(page, '#toast')), '9:30 にコマの始まりを知らせる');
  await t.shot('50-alert', false);
  const ics = await page.evaluate(async () => (await import('./js/notify.js')).buildICS());
  const n = (ics.match(/BEGIN:VEVENT/g) || []).length;
  check(errors, n === 63 && /DTSTART:20261112T060000\r\n/.test(ics) && /RRULE:FREQ=WEEKLY;UNTIL=20270224T/.test(ics) && /TRIGGER:PT0S/.test(ics) && /SUMMARY:物理 ハイレベル物理/.test(ics), 'カレンダー用ファイルに 7曜日×9コマ が入る');
  // 12月からの時間割を足すと、そこで切り替わる
  await t.tab('settings'); await page.click('#set-tt > summary');
  await page.click('#ttEditor [data-tt="new-toggle"]'); await page.fill('#ttNewFrom', '2026-12-01'); await page.click('#ttEditor [data-tt="new-ok"]');
  await page.locator('#ttEditor .ttrow').first().locator('select').selectOption('kyote'); await t.settle();
  const r = await page.evaluate(async () => { const tt = await import('./js/tt.js'), st = await import('./js/store.js'); return [tt.slotsFor(st.db.tt, '2026-11-26')[0].subjectId, tt.slotsFor(st.db.tt, '2026-12-03')[0].subjectId]; });
  check(errors, r[0] === 'sugaku' && r[1] === 'kyote', '切り替え日から新しい時間割になる');
  await t.shot('51-tt-two');
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
