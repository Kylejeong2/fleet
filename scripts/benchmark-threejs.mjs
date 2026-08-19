import { spawn } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const chromePath = process.env.FLEET_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const targetUrl = process.env.FLEET_BENCHMARK_URL ?? 'http://127.0.0.1:3000/'
const trials = Number(process.env.FLEET_BENCHMARK_TRIALS ?? 5)
const sampleMs = Number(process.env.FLEET_BENCHMARK_SAMPLE_MS ?? 5000)
const mode = process.env.FLEET_BENCHMARK_MODE ?? 'hero'
const screenshotPath = process.env.FLEET_BENCHMARK_SCREENSHOT
const port = 9300 + Math.floor(Math.random() * 500)
const profilePath = mkdtempSync(resolve(tmpdir(), 'fleet-threejs-benchmark-'))

const instrumentationSource = String.raw`
(() => {
  const state = { active: false, frames: [], drawCalls: 0, triangles: 0 };
  if (new URLSearchParams(location.search).get('benchmark') === 'fleet') {
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      if (typeof input === 'string' && input === '/api/v1/runs' && typeof init?.body === 'string') {
        const body = JSON.parse(init.body);
        init = { ...init, body: JSON.stringify({ ...body, profile: 'development' }) };
      }
      return originalFetch(input, init);
    };
  }
  const wrap = (prototype, method, triangleCount) => {
    const original = prototype?.[method];
    if (!original) return;
    prototype[method] = function (...args) {
      if (state.active) {
        state.drawCalls += 1;
        state.triangles += triangleCount(args);
      }
      return original.apply(this, args);
    };
  };
  for (const prototype of [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype]) {
    wrap(prototype, 'drawArrays', (args) => args[0] === 4 ? args[2] / 3 : 0);
    wrap(prototype, 'drawElements', (args) => args[0] === 4 ? args[1] / 3 : 0);
    wrap(prototype, 'drawArraysInstanced', (args) => args[0] === 4 ? args[2] * args[3] / 3 : 0);
    wrap(prototype, 'drawElementsInstanced', (args) => args[0] === 4 ? args[1] * args[4] / 3 : 0);
  }
  let frame = 0;
  const tick = (time) => {
    if (state.active) state.frames.push(time);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  window.__fleetBenchmark = {
    start() {
      state.active = true;
      state.frames = [];
      state.drawCalls = 0;
      state.triangles = 0;
    },
    finish() {
      state.active = false;
      const deltas = state.frames.slice(1).map((time, index) => time - state.frames[index]);
      const sorted = [...deltas].sort((a, b) => a - b);
      const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
      const duration = state.frames.at(-1) - state.frames[0];
      const canvas = document.querySelector('.ocean-canvas');
      return {
        fps: Math.round((deltas.length / duration) * 100000) / 100,
        p95FrameMs: Math.round(percentile(.95) * 100) / 100,
        p99FrameMs: Math.round(percentile(.99) * 100) / 100,
        longFrames: deltas.filter((delta) => delta > 20).length,
        drawCallsPerFrame: Math.round((state.drawCalls / Math.max(1, deltas.length)) * 100) / 100,
        trianglesPerFrame: Math.round(state.triangles / Math.max(1, deltas.length)),
        canvasPixels: canvas ? canvas.width * canvas.height : 0,
      };
    },
  };
})();
`

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--force-device-scale-factor=2',
  '--remote-debugging-port=' + port,
  `--user-data-dir=${profilePath}`,
  '--window-size=1440,1000',
  'about:blank',
], { stdio: 'ignore' })
const chromeExited = new Promise((resolveExit) => chrome.once('exit', resolveExit))

try {
  await waitForChrome()
  const results = []
  for (let trial = 0; trial < trials; trial += 1) results.push(await runTrial(trial))
  const assets = await measureAssets()
  await closeChrome()
  await Promise.race([chromeExited, wait(2000)])
  writeFileSync(process.stdout.fd, JSON.stringify({
    settings: { targetUrl, mode, trials, sampleMs, viewport: '1440x1000', deviceScaleFactor: 2 },
    summary: summarize(results),
    assets,
    trials: results,
  }, null, 2) + '\n')
} finally {
  if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL')
  await rm(profilePath, { recursive: true, force: true }).catch(() => {})
}

async function runTrial(trial) {
  const page = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json())
  const cdp = await connectCdp(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Performance.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: instrumentationSource })
  await cdp.send('Page.navigate', { url: `${targetUrl}?benchmark=${mode}&trial=${trial}` })
  await cdp.waitFor('Page.loadEventFired')
  if (mode === 'fleet') {
    await cdp.send('Runtime.evaluate', { expression: `
      (() => {
        const input = document.querySelector('#research-question');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, 'Benchmark the 50 agent research ocean');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.form.requestSubmit();
      })()
    ` })
    await waitForExpression(cdp, "document.querySelectorAll('.ocean-agent-target').length === 50")
    await waitForExpression(cdp, "document.querySelector('.conversation')?.classList.contains('has-run')")
  }
  await wait(1500)
  await cdp.send('Runtime.evaluate', { expression: 'window.__fleetBenchmark.start()' })
  await wait(sampleMs)
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: 'window.__fleetBenchmark.finish()',
    returnByValue: true,
  })
  const performance = await cdp.send('Performance.getMetrics')
  const metrics = Object.fromEntries(performance.metrics.map(({ name, value }) => [name, value]))
  if (screenshotPath && trial === 0) {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(screenshotPath, screenshot.data, 'base64')
  }
  const interactionOpened = mode === 'fleet'
    ? (await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          document.querySelector('.ocean-agent-target')?.click();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return Boolean(document.querySelector('[role="dialog"]'));
        })()`,
        awaitPromise: true,
        returnByValue: true,
      })).result.value
    : null
  await cdp.close()
  await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`)
  return {
    ...evaluated.result.value,
    jsHeapUsedMb: round(metrics.JSHeapUsedSize / 1024 / 1024),
    domNodes: metrics.Nodes,
    interactionOpened,
  }
}

async function measureAssets() {
  const assetsDir = resolve('.output/public/assets')
  const entries = await readdir(assetsDir)
  const javascript = []
  for (const name of entries.filter((entry) => entry.endsWith('.js'))) {
    const source = await readFile(resolve(assetsDir, name))
    javascript.push({ name, bytes: source.byteLength, gzipBytes: gzipSync(source).byteLength })
  }
  javascript.sort((a, b) => b.bytes - a.bytes)
  return {
    totalJavascriptBytes: javascript.reduce((total, asset) => total + asset.bytes, 0),
    totalJavascriptGzipBytes: javascript.reduce((total, asset) => total + asset.gzipBytes, 0),
    largestJavascript: javascript.slice(0, 4),
  }
}

function summarize(results) {
  const fields = ['fps', 'p95FrameMs', 'p99FrameMs', 'longFrames', 'drawCallsPerFrame', 'trianglesPerFrame', 'jsHeapUsedMb', 'domNodes']
  return Object.fromEntries(fields.map((field) => [field, median(results.map((result) => result[field]))]))
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : round((sorted[middle - 1] + sorted[middle]) / 2)
}

function round(value) {
  return Math.round(value * 100) / 100
}

async function waitForChrome() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {}
    await wait(100)
  }
  throw new Error('Chrome DevTools endpoint did not start')
}

async function waitForExpression(cdp, expression) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
    if (result.result.value) return
    await wait(100)
  }
  throw new Error(`Timed out waiting for: ${expression}`)
}

async function closeChrome() {
  try {
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json())
    const browser = await connectCdp(version.webSocketDebuggerUrl)
    await browser.send('Browser.close')
  } catch {}
}

function connectCdp(url) {
  return new Promise((resolveConnection, reject) => {
    const socket = new WebSocket(url)
    let id = 0
    const pending = new Map()
    const listeners = new Map()
    socket.addEventListener('open', () => resolveConnection({
      send(method, params = {}) {
        return new Promise((resolve, rejectRequest) => {
          const requestId = ++id
          pending.set(requestId, { resolve, reject: rejectRequest })
          socket.send(JSON.stringify({ id: requestId, method, params }))
        })
      },
      waitFor(method) {
        return new Promise((resolve) => listeners.set(method, resolve))
      },
      close() {
        socket.close()
      },
    }))
    socket.addEventListener('error', reject)
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (message.id) {
        const request = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) request?.reject(new Error(message.error.message))
        else request?.resolve(message.result)
      } else if (message.method && listeners.has(message.method)) {
        listeners.get(message.method)(message.params)
        listeners.delete(message.method)
      }
    })
  })
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
