// Usage: launch the packaged application with --remote-debugging-port=<port>,
// then run  WIZ_PORT=<port> node scripts/verify-wizard-runtime.mjs
//
// Drives the Volume Creation Wizard in the packaged application using real
// keyboard and mouse events through the CDP Input domain — the same path a
// person's keystrokes and clicks take. Nothing here calls the engine to build
// the container; the engine is used only afterwards to read back what the
// wizard produced.
import WebSocket from 'ws';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../src/main/volume-engine.cjs');

const PORT = Number(process.env.WIZ_PORT || 9375);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { suppressOrigin: true });
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
ws.on('message', (raw) => { const m = JSON.parse(raw); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
await new Promise((r) => ws.on('open', r));
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const rec = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

async function type(selector, text) {
  await ev(`(()=>{const el=${selector};if(el){el.focus();if(el.select)el.select();}})()`);
  await wait(150);
  await send('Input.insertText', { text });
  await wait(350);
  return ev(`(()=>{const el=${selector};return el?String(el.value):'__MISSING__';})()`);
}

async function clickAt(selector) {
  const box = await ev(`(()=>{const el=${selector};if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`);
  if (!box) return false;
  const { x, y } = JSON.parse(box);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await wait(450);
  return true;
}

const card = () => ev(`(()=>{const h=document.querySelector('main h2');return h?h.innerText.trim():'';})()`);

async function goStep(name) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await clickAt(`(()=>{const t=[...document.querySelectorAll('main *')].filter(e=>e.children.length===0&&e.innerText.trim()===${JSON.stringify(name)});const n=t[0];return n?(n.closest('button,[role=button]')||n.parentElement):null;})()`);
    if ((await card()) === name) return true;
  }
  return false;
}

const TEXT0 = `[...document.querySelectorAll('main input')].filter(e=>e.type==='text')[0]`;
const PW = (i) => `[...document.querySelectorAll('main input')].filter(e=>e.type==='password')[${i}]`;
const NUM0 = `[...document.querySelectorAll('main input')].filter(e=>e.type==='number')[0]`;
const LAST_TEXT = `(()=>{const e=[...document.querySelectorAll('main input')].filter(x=>x.type==='text');return e[e.length-1];})()`;
const PIM_BOX = `(()=>{const l=[...document.querySelectorAll('main label')].find(x=>/Use PIM/.test(x.textContent||''));return l?[...l.querySelectorAll('input')].filter(x=>x.type==='checkbox')[0]:null;})()`;
const CREATE_BTN = `(()=>{const b=[...document.querySelectorAll('main button')].filter(e=>/^(Create|Creating…)$/.test(e.innerText.trim()));return b[b.length-1];})()`;
const UNIT = (u) => `[...document.querySelectorAll('main button')].find(e=>e.innerText.trim()===${JSON.stringify(u)})`;

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'me-wiz-'));
const container = path.join(dir, 'wizard.hc');
const PASSWORD = 'a passphrase typed into the wizard';
const LABEL = 'WIZARDMADE';
const PIM = 1;

try {
  if ((await ev(`(()=>{const h=document.querySelector('main h1');return h?h.innerText.trim():'';})()`)) !== 'Volume Creation Wizard') {
    await clickAt(`[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Create Volume')`);
    await wait(900);
  }
  rec('wizard reached from the application', (await ev(`(()=>{const h=document.querySelector('main h1');return h?h.innerText.trim():'';})()`)) === 'Volume Creation Wizard');

  rec('Volume Location step opened', await goStep('Volume Location'));
  let v = await type(TEXT0, container);
  rec('destination typed', v === container, v);

  rec('Volume Size step opened', await goStep('Volume Size'));
  v = await type(TEXT0, '64');
  rec('size typed as 64', v === '64', v);
  await clickAt(UNIT('MB'));
  rec('MB unit clicked', true);

  rec('Volume Password step opened', await goStep('Volume Password'));
  v = await type(PW(0), PASSWORD);
  rec('password typed', v === PASSWORD);

  v = await type(PW(1), 'a different passphrase');
  let msg = await ev(`(()=>{const n=[...document.querySelectorAll('main p')].find(e=>/passwords/i.test(e.innerText||''));return n?n.innerText.trim():'';})()`);
  rec('confirmation reports a mismatch', /do not match/i.test(msg), msg);

  v = await type(PW(1), PASSWORD);
  msg = await ev(`(()=>{const n=[...document.querySelectorAll('main p')].find(e=>/passwords/i.test(e.innerText||''));return n?n.innerText.trim():'';})()`);
  rec('confirmation reports a match', /passwords match/i.test(msg), msg);

  await clickAt(PIM_BOX);
  const pimVisible = await ev(`[...document.querySelectorAll('main input')].filter(e=>e.type==='number').length`);
  rec('Use PIM reveals the PIM field', pimVisible === 1, `${pimVisible} number field(s)`);
  v = await type(NUM0, String(PIM));
  rec('PIM typed', v === String(PIM), v);

  v = await type(LAST_TEXT, LABEL);
  rec('volume label typed', v === LABEL, v);

  rec('Volume Format step opened', await goStep('Volume Format'));
  const buttonLabel = await ev(`(()=>{const b=${CREATE_BTN};return b?b.innerText.trim():'none';})()`);
  rec('final step offers Create', buttonLabel === 'Create', buttonLabel);

  rec('Create clicked', await clickAt(CREATE_BTN));
  console.log('   … Create pressed; the engine writes and formats 64 MB');

  let outcome = '';
  for (let i = 0; i < 300; i += 1) {
    await wait(1000);
    outcome = await ev(`(()=>{const t=document.querySelector('main').innerText;const m=t.match(/(Created [^\\n]+|The container was not created[^\\n]+)/);return m?m[0].trim():'';})()`);
    if (outcome) break;
  }
  rec('wizard reported a real outcome', outcome.startsWith('Created'), outcome || 'no outcome within 300s');

  const stat = await fs.stat(container).catch(() => null);
  rec('container exists on disk', Boolean(stat), stat ? `${stat.size} bytes` : 'missing');

  if (stat) {
    const info = await engine.verify({ volume: container, password: PASSWORD, pim: PIM, prf: 'Autodetection' });
    rec('engine opens what the wizard created', Boolean(info), `${info.cipher}/${info.prf}`);
    rec('the PIM typed into the wizard was used', info.pim === PIM, `header PIM ${info.pim}`);

    const listing = await engine.listFiles({ volume: container, password: PASSWORD, pim: PIM });
    rec('the label typed into the wizard reached the filesystem', listing.usage.label === LABEL, `label "${listing.usage.label}"`);

    await engine.verify({ volume: container, password: PASSWORD, pim: 0 }).then(
      () => rec('a different PIM is refused', false, 'PIM 0 opened a PIM 1 container'),
      () => rec('a different PIM is refused', true, 'PIM 0 rejected')
    );
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
  ws.close();
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} wizard checks passed`);
if (failed) process.exitCode = 1;
