// Test helper: talks to the running app (started with `npm run dev`) over the Chrome DevTools
// Protocol.
//   node tools/cdp.mjs eval "<javascript>"   evaluate in the window and print the result
//   node tools/cdp.mjs run <file.js> "<js>"  load a script into the window, then evaluate <js>
//   node tools/cdp.mjs shot <file.png>       save a screenshot of the window
//   node tools/cdp.mjs console               print console messages for 3 seconds
//   node tools/cdp.mjs profile <seconds>     CPU-profile the page and list the costliest functions
import { readFileSync, writeFileSync } from 'node:fs';

const port = process.env.NC_PORT || 9333;
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === 'page' && p.url.includes('index.html')) || pages.find((p) => p.type === 'page');
if (!page) throw new Error('No app window found on port ' + port);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg);
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const res = r.result;
  if (res?.exceptionDetails) console.log('EXCEPTION', JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails, null, 2));
  else return res?.result?.value ?? res?.result;
};

const [cmd, arg, arg2] = process.argv.slice(2);
if (cmd === 'eval') {
  console.log(JSON.stringify(await evaluate(arg), null, 2));
} else if (cmd === 'run') {
  await evaluate(readFileSync(arg, 'utf8'));
  console.log(JSON.stringify(await evaluate(arg2), null, 2));
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
  console.log('saved', arg);
} else if (cmd === 'profile') {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 200 });
  await send('Profiler.start');
  await new Promise((r) => setTimeout(r, (+arg || 5) * 1000));
  const { result } = await send('Profiler.stop');
  const { nodes, samples, timeDeltas } = result.profile;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const self = new Map();
  let total = 0;
  samples.forEach((id, i) => {
    const n = byId.get(id), dt = timeDeltas[i] || 0;
    total += dt;
    const f = n.callFrame;
    const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + dt);
  });
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  for (const [k, v] of rows) console.log(`${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
} else if (cmd === 'console') {
  await send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 3000));
  for (const e of events) {
    if (e.method === 'Runtime.consoleAPICalled') console.log(e.params.type, e.params.args.map((a) => a.value ?? a.description).join(' '));
    if (e.method === 'Runtime.exceptionThrown') console.log('EXCEPTION', e.params.exceptionDetails.exception?.description);
  }
}
ws.close();
