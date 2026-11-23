// Development helper: drives the running app over the Chrome DevTools Protocol.
// Start the app with `npx electron . --remote-debugging-port=9333`, then:
//   node tools/cdp.mjs shot <route> <out.png>     screenshot of the window whose URL ends in #<route>
//   node tools/cdp.mjs eval <route> "<js expr>"    evaluate an expression in that window and print the result
const PORT = process.env.CDP_PORT ?? '9333';
const [command, route, arg] = process.argv.slice(2);
if (!command || !route || !arg) throw new Error('usage: cdp.mjs shot|eval <route> <out.png|expression>');

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = targets.find((t) => t.type === 'page' && t.url.endsWith(`#${route}`));
if (!target) throw new Error(`no window for #${route}; found: ${targets.map((t) => t.url).join(', ')}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 0;
function call(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    ws.addEventListener('message', function onMessage(event) {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    });
  });
}

if (command === 'shot') {
  const { writeFileSync } = await import('node:fs');
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg, Buffer.from(data, 'base64'));
  console.log(`wrote ${arg}`);
} else if (command === 'eval') {
  const { result, exceptionDetails } = await call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  console.log(typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2));
} else {
  throw new Error(`unknown command ${command}`);
}
ws.close();
