import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { chromium } from '@playwright/test'

// Run only against the verified, isolated development instance recorded by cherry-electron-dev.
const workspace = process.cwd()
const output = path.resolve('.context/cherry-electron-dev/file-line-performance')
const record = JSON.parse(await readFile('.context/cherry-electron-dev/instance.json', 'utf8'))
const baselineRef = process.argv[2]
if (!baselineRef) throw new Error('Usage: node scripts/e2e/file-line-performance.mjs <pre-feature-ref>')
if (record.workspace !== workspace) throw new Error('Instance belongs to another workspace')
process.kill(record.electron_pid, 0)
const cwd = execFileSync('lsof', ['-a', '-p', String(record.electron_pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
if (!cwd.split('\n').includes(`n${workspace}`)) throw new Error('Electron cwd does not match')
execFileSync('lsof', ['-nP', '-a', '-p', String(record.electron_pid), `-iTCP:${record.cdp_port}`, '-sTCP:LISTEN'])
const baselineSha = execFileSync('git', ['rev-parse', '--verify', `${baselineRef}^{commit}`], {
  encoding: 'utf8'
}).trim()
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
await mkdir(output, { recursive: true })
const baselinePath = path.join(output, 'BaselineFileEditor.tsx')
const baselineSource = execFileSync('git', ['show', `${baselineSha}:src/renderer/components/FileEditor.tsx`], {
  encoding: 'utf8'
})
await writeFile(
  baselinePath,
  baselineSource.replace("'../workers/fileEditor.worker.ts'", "'/workers/fileEditor.worker.ts'")
)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${record.cdp_port}`)
const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((candidate) => candidate.url() === record.target_url)
if (!page || (await page.title()) !== 'Cherry Studio') throw new Error('Recorded main window not found')
await page.bringToFront()
page.on('pageerror', (error) => process.stderr.write(`${error.message}\n`))
const cdp = await page.context().newCDPSession(page)
const samples = []
const checkpoints = []
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    count: values.length,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]
  }
}
try {
  await page.evaluate(async (baselinePath) => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const React = (await import(resources.find((url) => /\/react.js\?/.test(url)))).default
    const { createRoot } = (await import(resources.find((url) => /\/react-dom_client.js\?/.test(url)))).default
    const { CodeStyleProvider } = await import('/components/CodeStyleProvider.tsx')
    const { default: FileEditor } = await import(`/components/FileEditor.tsx?performance=${Date.now()}`)
    const { default: BaselineFileEditor } = await import(`/@fs${baselinePath}`)
    const host = document.createElement('div')
    host.id = 'file-line-performance'
    Object.assign(host.style, {
      position: 'fixed',
      left: '20px',
      top: '20px',
      width: '900px',
      height: '560px',
      zIndex: '999999',
      background: 'white'
    })
    document.body.append(host)
    const root = createRoot(host)
    const h = React.createElement
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const longTasks = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration })
    })
    observer.observe({ type: 'longtask' })
    let render
    let mounted = false
    function Harness() {
      const [state, setState] = React.useState(null)
      render = setState
      return h(
        CodeStyleProvider,
        null,
        state &&
          h(state.baseline ? BaselineFileEditor : FileEditor, {
            key: state.key,
            fileName: 'fixture.ts',
            value: state.value,
            readOnly: true,
            wrapLines: state.wrap,
            location: state.location,
            className: 'h-full'
          })
      )
    }
    root.render(h(Harness))
    while (!render) await nextFrame()
    const visible = (line, selected) => {
      const container = host.querySelector('diffs-container')
      const row = container?.shadowRoot?.querySelector(`[data-line="${line}"]`)
      if (!row || (selected && !row.hasAttribute('data-selected-line'))) return false
      const rect = row.getBoundingClientRect()
      const viewport = container.parentElement.getBoundingClientRect()
      return rect.bottom > viewport.top && rect.top < viewport.bottom && rect.top >= viewport.top - 1
    }
    let state
    window.__fileLinePerf = {
      async mount(config) {
        render(null)
        await nextFrame()
        await nextFrame()
        state = { ...config, key: Math.random() }
        const start = performance.now()
        render(state)
        while (!visible(1, false)) {
          if (performance.now() - start > 15000)
            throw new Error(
              `Plain mount timed out: baseline=${config.baseline}, lines=${config.lines}, wrap=${config.wrap}`
            )
          await nextFrame()
        }
        await nextFrame()
        mounted = true
        return performance.now() - start
      },
      async jump(line) {
        if (!mounted) throw new Error('No mounted editor')
        const start = performance.now()
        state = { ...state, location: { line } }
        render(state)
        await nextFrame()
        while (!visible(line, true)) {
          if (performance.now() - start > 15000) throw new Error(`Line ${line} not revealed`)
          await nextFrame()
        }
        await nextFrame()
        return performance.now() - start
      },
      async burst(lines) {
        for (const line of lines.slice(0, -1)) {
          state = { ...state, location: { line } }
          render(state)
          await nextFrame()
        }
        const elapsed = await this.jump(lines.at(-1))
        await new Promise((resolve) => setTimeout(resolve, 300))
        if (!visible(lines.at(-1), true)) throw new Error('Stale navigation replaced final location')
        return elapsed
      },
      dom() {
        return host.querySelector('diffs-container')?.shadowRoot?.querySelectorAll('*').length ?? 0
      },
      async quiet(unmount) {
        if (unmount) render(null)
        await new Promise((resolve) => setTimeout(resolve, 500))
        return { nodes: this.dom(), lineVisible: unmount ? !host.querySelector('diffs-container') : true }
      },
      async frames() {
        const request = window.requestAnimationFrame
        const cancel = window.cancelAnimationFrame
        const pending = new Set()
        let fired = 0
        window.requestAnimationFrame = (callback) => {
          const tracked = new Error().stack.includes('/components/FileEditor.tsx')
          const id = request((time) => {
            pending.delete(id)
            if (tracked) fired++
            callback(time)
          })
          if (tracked) pending.add(id)
          return id
        }
        window.cancelAnimationFrame = (id) => {
          pending.delete(id)
          cancel(id)
        }
        try {
          await this.jump(3000)
          await this.quiet(false)
          const settled = { fired, pending: pending.size }
          await this.quiet(false)
          const idle = { fired, pending: pending.size }
          state = { ...state, location: { line: 42 } }
          render(state)
          await nextFrame()
          await this.quiet(true)
          const unmounted = { fired, pending: pending.size }
          await this.quiet(true)
          if (idle.pending || idle.fired !== settled.fired || pending.size || fired !== unmounted.fired) {
            throw new Error('Navigation animation frames continue after settling or unmount')
          }
          return { settled, idle, unmounted }
        } finally {
          window.requestAnimationFrame = request
          window.cancelAnimationFrame = cancel
        }
      },
      longTasks,
      cleanup() {
        observer.disconnect()
        root.unmount()
        host.remove()
        delete window.__fileLinePerf
      }
    }
  }, baselinePath)
  await cdp.send('Performance.enable')
  for (const fixture of [
    { lines: 4000, wrap: false },
    { lines: 50000, wrap: false },
    { lines: 4000, wrap: true }
  ]) {
    const value = Array.from(
      { length: fixture.lines },
      (_, i) => `// line ${i + 1}: ${'content '.repeat(fixture.wrap && i % 7 === 0 ? 40 : 1)}`
    ).join('\n')
    const config = { ...fixture, value }
    const name = `${fixture.lines}-${fixture.wrap ? 'wrapped' : 'plain'}`
    process.stdout.write(`Starting ${name}\n`)
    // Alternate order to reduce warm-cache and thermal bias; discard two warmups for each variant.
    for (let i = 0; i < 22; i++) {
      for (const baseline of i % 2 ? [true, false] : [false, true]) {
        const ms = await page.evaluate((config) => window.__fileLinePerf.mount(config), { ...config, baseline })
        if (i >= 2)
          samples.push({
            fixture: name,
            kind: baseline ? 'baseline-mount' : 'current-mount',
            ms,
            bytes: Buffer.byteLength(value)
          })
      }
    }
    await page.evaluate((config) => window.__fileLinePerf.mount(config), { ...config, baseline: false })
    process.stdout.write(`Jumping ${name}\n`)
    for (let i = 0; i < 102; i++) {
      const line = i % 2 ? 42 : fixture.lines - 10
      const ms = await page.evaluate((line) => window.__fileLinePerf.jump(line), line)
      if (i >= 2) samples.push({ fixture: name, kind: 'jump', ms, bytes: Buffer.byteLength(value) })
      if (i === 1 || i === 51 || i === 101) {
        const dom = await page.evaluate(() => window.__fileLinePerf.dom())
        const { metrics } = await cdp.send('Performance.getMetrics')
        checkpoints.push({
          fixture: name,
          jumps: i - 1,
          dom,
          metrics: Object.fromEntries(metrics.map(({ name, value }) => [name, value]))
        })
      }
    }
    const ms = await page.evaluate(
      (lines) => window.__fileLinePerf.burst(lines),
      [100, fixture.lines - 50, 42, fixture.lines - 10, 75]
    )
    samples.push({ fixture: name, kind: 'burst-final', ms, bytes: Buffer.byteLength(value) })
  }
  const quiet = await page.evaluate(() => window.__fileLinePerf.quiet(false))
  const frames = await page.evaluate(() => window.__fileLinePerf.frames())
  const unmounted = await page.evaluate(() => window.__fileLinePerf.quiet(true))
  const longTasks = await page.evaluate(() => window.__fileLinePerf.longTasks)
  const groups = [...new Set(samples.map((sample) => `${sample.fixture}/${sample.kind}`))]
  const result = {
    head,
    measuredAt: new Date().toISOString(),
    editorSha256: createHash('sha256')
      .update(await readFile('src/renderer/components/FileEditor.tsx'))
      .digest('hex'),
    baselineSha,
    mode: 'Electron development component harness; preloaded source, excludes filesystem and agent pane',
    platform: `${os.platform()} ${os.arch()}`,
    cpu: os.cpus()[0].model,
    electronPid: record.electron_pid,
    target: record.target_url,
    viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })),
    summaries: groups.map((group) => ({
      group,
      ...summary(samples.filter((sample) => `${sample.fixture}/${sample.kind}` === group).map((sample) => sample.ms))
    })),
    samples,
    checkpoints,
    frames,
    quiet,
    unmounted,
    longTasks
  }
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2))
  process.stdout.write(`${JSON.stringify(result.summaries, null, 2)}\n`)
} catch (error) {
  await writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ head, baselineSha, error: String(error), samples, checkpoints }, null, 2)
  )
  throw error
} finally {
  await page.evaluate(() => window.__fileLinePerf?.cleanup())
  await cdp.detach()
  await unlink(baselinePath)
}
// Disconnect the controller without closing the borrowed Electron browser.
process.exit(0)
