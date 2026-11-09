import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'tsdown'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const directory = mkdtempSync(join(tmpdir(), 'web-search-package-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const entries = Object.keys(manifest.exports).map((key) =>
  key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`
)

function run(command, args, cwd = directory) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

try {
  const [packed] = JSON.parse(
    run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], packageRoot)
  )
  const files = new Set(packed.files.map((entry) => entry.path))
  for (const required of [
    'LICENSE',
    'README.md',
    ...Object.values(manifest.exports).flatMap((entry) => [
      entry.import.default.slice(2),
      entry.import.types.slice(2),
      entry.require.default.slice(2),
      entry.require.types.slice(2)
    ])
  ])
    assert(files.has(required), `Missing published file: ${required}`)
  assert(
    ![...files].some((file) => file.startsWith('src/') || file.includes('__tests__')),
    'Source/tests must not enter the tarball'
  )
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, packed.filename)])

  const assertions = `
    assert.equal(catalog.WEB_SEARCH_PROVIDER_CATALOG.tavily.capabilities[0].defaultApiHost, 'https://api.tavily.com')
    const requests = []
    const client = core.createWebSearchClient({
      providers: [{ provider: provider.tavily, capabilities: ['searchKeywords'] }],
      transport: { async request(request) {
        requests.push(request)
        return { status: 200, headers: {}, bodyText: JSON.stringify({
          query: 'package', request_id: 'req', response_time: 1,
          results: [{ title: 'Result', url: 'https://example.com', content: 'Content' }]
        }) }
      } }
    })
    const result = await client.execute({ providerId: 'tavily', capability: 'searchKeywords', input: 'package',
      config: { maxResults: 1 }, credentials: { apiKey: 'test-key' } })
    assert.equal(requests[0].url, 'https://api.tavily.com/search')
    assert.equal(JSON.parse(requests[0].body).max_results, 1)
    assert.equal(result.results[0].sourceInput, 'package')
    assert.equal(result.results[0].content, 'Content')
  `
  const imports = `
    import assert from 'node:assert/strict'
    import * as core from '@cherrystudio/web-search'
    import * as catalog from '@cherrystudio/web-search/catalog'
    import * as provider from '@cherrystudio/web-search/providers/tavily'
  `
  writeFileSync(
    join(directory, 'consumer.mjs'),
    `${imports}
    for (const entry of ${JSON.stringify(entries)}) assert(Object.keys(await import(entry)).length)
    ${assertions}
  `
  )
  writeFileSync(
    join(directory, 'consumer.cjs'),
    `
    const assert = require('node:assert/strict')
    const core = require('@cherrystudio/web-search')
    const catalog = require('@cherrystudio/web-search/catalog')
    const provider = require('@cherrystudio/web-search/providers/tavily')
    for (const entry of ${JSON.stringify(entries)}) assert(Object.keys(require(entry)).length)
    ;(async () => { ${assertions} })().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1 })
  `
  )
  run(process.execPath, ['consumer.mjs'])
  run(process.execPath, ['consumer.cjs'])

  const types = `
    import { createWebSearchClient, type WebSearchCall, type WebSearchResult } from '@cherrystudio/web-search'
    import { tavily } from '@cherrystudio/web-search/providers/tavily'
    ${entries.map((entry, index) => `import * as entry${index} from '${entry}'\nvoid entry${index}`).join('\n')}
    const client = createWebSearchClient({ providers: [{ provider: tavily, capabilities: ['searchKeywords'] }],
      transport: { async request(request) {
        request.body satisfies string | undefined
        return { status: 200, headers: {}, bodyText: '{}' }
      } } })
    const call: WebSearchCall = { providerId: 'tavily', capability: 'searchKeywords', input: 'package', config: { maxResults: 1 } }
    void client.execute(call).then((response) => { response.results satisfies readonly WebSearchResult[] })
    // @ts-expect-error Search calls require a result limit.
    const invalid: WebSearchCall = { providerId: 'tavily', capability: 'searchKeywords', input: 'package', config: {} }
    void invalid
  `
  writeFileSync(join(directory, 'consumer.mts'), types)
  writeFileSync(join(directory, 'consumer.cts'), types)
  run(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    '--noEmit',
    '--strict',
    '--module',
    'nodenext',
    '--target',
    'es2020',
    'consumer.mts',
    'consumer.cts'
  ])

  // Retain every entry's exports so tree shaking cannot hide host-only imports.
  writeFileSync(
    join(directory, 'portable.ts'),
    entries.map((entry, index) => `export * as entry${index} from '${entry}'`).join('\n')
  )
  await build({
    cwd: directory,
    config: false,
    entry: ['portable.ts'],
    outDir: 'browser',
    platform: 'browser',
    format: 'esm',
    dts: false,
    deps: { alwaysBundle: [/./] },
    logLevel: 'silent'
  })
  run(process.execPath, ['--conditions=react-native', 'consumer.mjs'])
  process.stdout.write(
    'Package checks passed: tarball, all ESM/CJS exports, declarations, browser bundle and React Native conditions.\n'
  )
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout)
  if (error.stderr) process.stderr.write(error.stderr)
  throw error
} finally {
  rmSync(directory, { recursive: true, force: true })
}
