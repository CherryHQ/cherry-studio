import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

import { chromium } from '@playwright/test'
import { build, preview } from 'vite'

const root = resolve('src/renderer')
const output = await mkdtemp(join(tmpdir(), 'agent-python-acceptance-'))
const entryName = `.agent-python-check-${process.pid}`
const html = join(root, `${entryName}.html`)
const entry = join(root, `${entryName}.ts`)
const workbookCode = `
import openpyxl, io
workbook = openpyxl.Workbook()
workbook.active['A1'] = 'original'
source = io.BytesIO()
workbook.save(source)
source.seek(0)
loaded = openpyxl.load_workbook(source)
loaded.active['A1'] = 'offline updated'
result = io.BytesIO()
loaded.save(result)
result.seek(0)
assert openpyxl.load_workbook(result).active['A1'].value == 'offline updated'
print('Offline XLSX read, edit and save passed:', openpyxl.__version__)
`
let server
let browser
try {
  await writeFile(html, `<html><body><script type="module" src="/${entryName}.ts"></script></body></html>`)
  await writeFile(
    entry,
    `
import Worker from '/workers/pyodide.worker.ts?worker'
const worker = new Worker()
window.results = []
worker.onmessage = (event) => {
  window.results.push(event.data)
  if (event.data.type === 'initialized') worker.postMessage({ id: 'xlsx', python: ${JSON.stringify(workbookCode)}, context: {} })
}
`
  )
  await build({
    configFile: false,
    root,
    base: './',
    publicDir: join(root, 'public'),
    resolve: { alias: { '@shared': resolve('src/shared') } },
    worker: { format: 'es' },
    build: { target: 'esnext', outDir: output, rollupOptions: { input: html } }
  })
  server = await preview({
    configFile: false,
    root,
    build: { outDir: output },
    preview: { host: '127.0.0.1', port: 0 }
  })
  const port = server.httpServer.address().port
  const origin = `http://127.0.0.1:${port}`
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, headless: true })
  for (const corrupt of [false, true]) {
    const context = await browser.newContext()
    const external = []
    await context.route('**/*', (route) => {
      const url = route.request().url()
      if (!url.startsWith(`${origin}/`)) {
        external.push(url)
        return route.abort()
      }
      if (corrupt && url.endsWith('openpyxl-3.1.5-py2.py3-none-any.whl')) {
        return route.fulfill({ status: 200, body: 'corrupt wheel' })
      }
      return route.continue()
    })
    const page = await context.newPage()
    await page.goto(`${origin}/${entryName}.html`)
    await page.waitForFunction(
      () => window.results?.some((item) => item.id === 'xlsx' || item.type === 'init-error'),
      {},
      { timeout: 60000 }
    )
    const results = await page.evaluate(() => window.results)
    const passed = corrupt
      ? results.some((item) => item.type === 'init-error' && item.error.includes('Repair the application')) &&
        !results.some((item) => item.id === 'xlsx')
      : results.some(
          (item) =>
            item.id === 'xlsx' &&
            !item.output.error &&
            item.output.text.includes('Offline XLSX read, edit and save passed')
        )
    if (!passed || external.length)
      throw new Error(
        `${corrupt ? 'Corrupt wheel' : 'Offline workbook'} acceptance failed: ${JSON.stringify({ results, external })}`
      )
    console.log(
      corrupt
        ? 'Corrupt managed wheel rejected without external requests.'
        : 'Offline managed workbook round trip passed.',
      results
    )
    await context.close()
  }
  const manifest = JSON.parse(await readFile(resolve('src/shared/data/presets/agentPythonRuntime.json'), 'utf8'))
  console.log('Verified managed image:', manifest.imageVersion)
} finally {
  await browser?.close()
  if (server) await new Promise((done) => server.httpServer.close(done))
  await Promise.all([
    rm(html, { force: true }),
    rm(entry, { force: true }),
    rm(output, { recursive: true, force: true })
  ])
}
