import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import WebSocket from 'ws';

const args = new Map(process.argv.slice(2).map((part) => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
const port = Number(args.get('port'));
const state = args.get('state');
const output = args.get('output');
if (!Number.isInteger(port) || !['home', 'menu', 'wizard', 'navigator'].includes(state) || !output) {
  throw new Error('Usage: node scripts/capture-runtime.mjs --port=9339 --state=wizard --output=path.png');
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
if (targets.length !== 1 || targets[0].type !== 'page' || !targets[0].url.includes('/resources/app.asar/src/renderer/index.html') || !targets[0].webSocketDebuggerUrl) {
  throw new Error('Runtime isolation failed: expected exactly one packaged renderer page.');
}

const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let sequence = 0;
const pending = new Map();
socket.on('message', (data) => {
  const response = JSON.parse(data.toString());
  if (!response.id || !pending.has(response.id)) return;
  const { resolve, reject } = pending.get(response.id); pending.delete(response.id);
  if (response.error) reject(new Error(response.error.message)); else resolve(response.result);
});

function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

if (state === 'menu' || state === 'wizard') {
  const opened = await evaluate(`(() => {
    const target = [...document.querySelectorAll('h1,h2')].find((element) => element.textContent.trim() === 'Volumes');
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + 20 }));
    return Boolean(document.querySelector('.toy-menu'));
  })()`);
  if (!opened) throw new Error('The exact-element context menu did not open.');
}
if (state === 'wizard') {
  const opened = await evaluate(`(() => {
    const action = [...document.querySelectorAll('.toy-menu-action')].find((element) => element.textContent.includes('Lock this element'));
    if (!action) return false;
    action.click();
    return Boolean(document.querySelector('.toy-wizard'));
  })()`);
  if (!opened) throw new Error('The exact-element lock wizard did not open.');
}
if (state === 'navigator') {
  const opened = await evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'l', ctrlKey: true, altKey: true }));
    return Boolean(document.querySelector('[aria-label="Choose an element to lock"]'));
  })()`);
  if (!opened) throw new Error('The keyboard element navigator did not open.');
}

await new Promise((resolve) => setTimeout(resolve, 150));
const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile(output, Buffer.from(capture.data, 'base64'));
socket.close();
console.log(JSON.stringify({ state, output, target: targets[0].url }));
