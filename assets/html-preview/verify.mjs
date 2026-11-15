import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'));
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(path.join(tmpdir(), 'manli-preview-test-'));
const server = spawn(process.execPath, ['server.mjs', '--port', '7199'], { cwd: root, stdio: 'pipe' });
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9223', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
const errors = [];
const failedRequests = [];
const checks = [];
function check(condition, label) {
  checks.push({ label, passed: Boolean(condition) });
  if (!condition) errors.push(label);
}
async function waitFor(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    await sleep(150);
  }
  throw new Error(`Timed out: ${url}`);
}
try {
  await waitFor('http://127.0.0.1:7199/');
  const targets = await (await waitFor('http://127.0.0.1:9223/json/list')).json();
  const target = targets.find(item => item.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      const handler = pending.get(msg.id);
      if (handler) { pending.delete(msg.id); msg.error ? handler.reject(msg.error) : handler.resolve(msg.result); }
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    if (msg.method === 'Network.loadingFailed') failedRequests.push(msg.params.errorText);
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) failedRequests.push(`${msg.params.response.status} ${msg.params.response.url}`);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:7199/' });
  await sleep(800);
  check(await evaluate(`document.readyState === 'complete' && document.querySelectorAll('.version').length === 3 && document.querySelectorAll('.page-btn').length === 25`), '桌面页面加载，包含三版和 25 页目录');
  check(await evaluate(`document.getElementById('preview').complete && document.getElementById('preview').naturalWidth > 0 && location.hash === '#a/1' && document.getElementById('prevTop').disabled`), 'A 版首页图片正常，上一页按钮禁用');
  await evaluate(`document.getElementById('nextTop').click()`);
  check(await evaluate(`location.hash === '#a/2' && document.getElementById('pageTitle').textContent === '首页'`), '下一页按钮翻页正常');
  await evaluate(`document.querySelector('[data-variant="b"]').click()`);
  check(await evaluate(`location.hash === '#b/1' && document.getElementById('preview').src.includes('/previews/b/page-1.png') && document.getElementById('metaVariant').textContent.includes('B 版')`), '切换 B 版后内容与图片同步');
  await evaluate(`document.querySelector('.page-btn[data-page="16"]').click()`);
  check(await evaluate(`location.hash === '#b/16' && document.getElementById('pageTitle').textContent === '个人中心'`), '目录跳转指定页面正常');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))`);
  check(await evaluate(`location.hash === '#b/17'`), '键盘右方向键翻页正常');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft'}))`);
  check(await evaluate(`location.hash === '#b/16'`), '键盘左方向键翻页正常');
  await evaluate(`document.querySelector('.page-btn[data-page="25"]').click()`);
  check(await evaluate(`document.getElementById('nextBtn').disabled && document.getElementById('nextTop').disabled`), '第 25 页禁用下一页按钮');
  await evaluate(`document.querySelector('[data-variant="c"]').click()`);
  check(await evaluate(`location.hash === '#c/1' && document.getElementById('preview').src.includes('/previews/c/page-1.png')`), '切换 C 版后回到首页');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:7199/#c/1' });
  await sleep(500);
  check(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), '手机端无横向溢出');
  await evaluate(`document.getElementById('menuBtn').click()`);
  check(await evaluate(`document.getElementById('sidebar').classList.contains('open') && document.getElementById('menuBtn').getAttribute('aria-expanded') === 'true'`), '手机端目录可以展开');
  await evaluate(`document.querySelector('.page-btn[data-page="2"]').click()`);
  check(await evaluate(`location.hash === '#c/2' && !document.getElementById('sidebar').classList.contains('open')`), '手机端选页后目录自动收起');
  for (const variant of ['a', 'b', 'c']) {
    for (let page = 1; page <= 25; page++) {
      const response = await fetch(`http://127.0.0.1:7199/previews/${variant}/page-${page}.png`);
      const image = await response.arrayBuffer();
      check(response.ok && image.byteLength > 0, `${variant.toUpperCase()} 第 ${page} 页图片可访问`);
    }
  }
  check(failedRequests.length === 0, `无页面脚本异常或资源请求失败${failedRequests.length ? '：' + failedRequests.join('；') : ''}`);
  const failed = checks.filter(item => !item.passed);
  console.log(JSON.stringify({ total: checks.length, passed: checks.length - failed.length, failed, runtimeErrors: errors, requestErrors: failedRequests }, null, 2));
  if (failed.length || errors.length || failedRequests.length) process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  spawnSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  server.kill();
  await rm(profile, { recursive: true, force: true });
}
