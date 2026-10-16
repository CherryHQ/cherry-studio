import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'web-search-package-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packageName = '@cherrystudio/web-search'
const entries = {
  '.': ['createWebSearchClient', 'WebSearchError', 'WebSearchTransportError'],
  './catalog': ['webSearchCatalog'],
  './providers/zhipu': ['zhipu'],
  './providers/tavily': ['tavily'],
  './providers/searxng': ['searxng'],
  './providers/exa': ['exa'],
  './providers/exa-mcp': ['exaMcp'],
  './providers/bocha': ['bocha'],
  './providers/querit': ['querit'],
  './providers/jina': ['jina', 'jinaMirrorCandidates'],
  './providers/firecrawl': ['firecrawl'],
  './providers/crawl4ai': ['crawl4ai'],
  './providers/parallel': ['parallel'],
  './providers/serply': ['serply'],
  './tools/config': ['resolveApiHost', 'mergeApiEndpoint'],
  './tools/url-filter': ['filterByUrlRules'],
  './tools/content': ['sliceContent']
}
function run(command, args) {
  return execFileSync(command, args, { cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
function write(name, content) {
  writeFileSync(join(scratch, name), content)
}
function specifier(key) {
  return packageName + (key === '.' ? '' : key.slice(1))
}

try {
  const [packed] = JSON.parse(
    execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], {
      cwd: packageRoot,
      encoding: 'utf8'
    })
  )
  const inventory = new Set(packed.files.map((file) => file.path))
  assert(inventory.has('LICENSE'), 'Archive must contain LICENSE')
  assert(
    [...inventory].every(
      (path) => path === 'package.json' || path === 'README.md' || path === 'LICENSE' || path.startsWith('dist/')
    ),
    'Archive exposes development files'
  )
  write('package.json', JSON.stringify({ private: true, type: 'module' }))
  const sourceManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  run(npm, [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    join(scratch, packed.filename),
    `typescript@${sourceManifest.devDependencies.typescript}`,
    `@types/node@${sourceManifest.devDependencies['@types/node']}`,
    'esbuild@0.25.12'
  ])
  const installed = join(scratch, 'node_modules', packageName)
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  assert.deepEqual(
    Object.keys(manifest.exports).sort(),
    Object.keys(entries).sort(),
    'Expected exactly 17 public entry keys'
  )
  for (const [key, conditions] of Object.entries(manifest.exports)) {
    assert.deepEqual(
      Object.keys(conditions),
      ['react-native', 'import', 'require', 'default'],
      `${key}: export conditions`
    )
    for (const condition of ['react-native', 'import', 'require']) {
      const branch = conditions[condition]
      assert.deepEqual(Object.keys(branch), ['types', 'default'], `${key}: ${condition} shape`)
      for (const field of ['types', 'default']) {
        const suffix =
          field === 'types'
            ? condition === 'require'
              ? '.d.cts'
              : '.d.mts'
            : condition === 'require'
              ? '.cjs'
              : '.mjs'
        assert(branch[field].endsWith(suffix), `${key}/${condition}/${field}: wrong extension`)
        assert(
          inventory.has(branch[field].slice(2)) && existsSync(join(installed, branch[field])),
          `${key}/${condition}/${field}: missing archive target`
        )
      }
    }
    assert(
      conditions.default.endsWith('.mjs') && inventory.has(conditions.default.slice(2)),
      `${key}: invalid default target`
    )
  }

  const runtimeAssertions = `
const entries = ${JSON.stringify(entries)}
const loaded = new Map()
for (const [key,names] of Object.entries(entries)) {
  const spec = '${packageName}' + (key === '.' ? '' : key.slice(1))
  const value = await load(spec)
  for (const name of names) assert(name in value, spec + ' missing ' + name)
  loaded.set(key,value)
  process.stdout.write(spec + ' => ' + resolve(spec) + '\\n')
}
const core = loaded.get('.')
assert.deepEqual(Object.keys(core).sort(), ['WebSearchError','WebSearchTransportError','createWebSearchClient'])
const catalog = loaded.get('./catalog').webSearchCatalog
assert.equal(catalog.length,12)
for (const [key,names] of Object.entries(entries).filter(([key]) => key.startsWith('./providers/'))) {
  const provider = loaded.get(key)[names[0]]
  assert.equal(provider.metadata.id, key.slice('./providers/'.length))
  assert.deepEqual(provider.metadata, catalog.find(item => item.id === provider.metadata.id))
  assert.deepEqual(provider.metadata.capabilities.map(item => item.capability), provider.metadata.id === 'crawl4ai' ? ['fetchUrls'] : ['querit','jina','firecrawl'].includes(provider.metadata.id) ? ['searchKeywords','fetchUrls'] : ['searchKeywords'])
}
const tavily = loaded.get('./providers/tavily').tavily
const client = core.createWebSearchClient({ providers: [{ provider: tavily, capabilities: ['searchKeywords'] }], transport: { async request(request) { assert.equal(request.body, '{"query":"hello","max_results":1}'); return { status: 200, headers: {}, bodyText: '{"query":"hello","request_id":"id","response_time":1,"results":[{"title":"Title","url":"https://result.test","content":"Content"}]}' } } } })
const result = await client.execute({ providerId: 'tavily', capability: 'searchKeywords', input: 'hello', config: { maxResults: 1 }, credentials: { apiKey: 'dummy' } })
assert.deepEqual(result.results,[{ title: 'Title', url: 'https://result.test', content: 'Content', sourceInput: 'hello' }])
await assert.rejects(client.execute({ providerId: 'tavily', capability: 'fetchUrls', input: 'url', config: {} }), error => error instanceof core.WebSearchError && error.code === 'capability_unsupported')
assert.equal(new core.WebSearchTransportError('network').kind,'network')
const config = loaded.get('./tools/config')
assert.equal(config.resolveApiHost(undefined,'https://example.test'),'https://example.test')
assert.equal(config.mergeApiEndpoint('https://example.test/','/search'),'https://example.test/search')
assert.deepEqual(loaded.get('./tools/url-filter').filterByUrlRules([{url:'https://example.test'}],['<all_urls>']),[])
assert.deepEqual(loaded.get('./tools/content').sliceContent('hello world',{maxCharacters:5}),{content:'hello',truncated:true})
for (const suffix of ['/src/index','/internal/protocol','/dist/index.mjs','/providers/duckduckgo']) {
  await assert.rejects(async () => load('${packageName}' + suffix), error => error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED')
}
`
  write(
    'consumer.mjs',
    `import assert from 'node:assert/strict'\nconst load = spec => import(spec)\nconst resolve = spec => import.meta.resolve(spec)\n${runtimeAssertions}`
  )
  write(
    'consumer.cjs',
    `const assert = require('node:assert/strict')\nconst load = spec => require(spec)\nconst resolve = spec => require.resolve(spec)\n;(async () => { ${runtimeAssertions} })().catch(error => { console.error(error); process.exitCode = 1 })`
  )
  const esm = run(process.execPath, ['consumer.mjs'])
  const cjs = run(process.execPath, ['consumer.cjs'])
  run(process.execPath, ['--conditions=react-native', 'consumer.mjs'])

  const consumerTypes = `
import { createWebSearchClient, type WebSearchProviderId } from '${packageName}'
${Object.entries(entries)
  .filter(([key]) => key !== '.')
  .map(([key, names]) => `import { ${names.join(', ')} } from '${specifier(key)}'\nvoid [${names.join(', ')}]`)
  .join('\n')}
const client = createWebSearchClient({ providers: [{ provider: tavily, capabilities: ['searchKeywords'] }], transport: { async request() { return { status: 200, headers: {}, bodyText: '' } } } })
void client.execute({ providerId: 'tavily', capability: 'searchKeywords', input: 'hello', config: { maxResults: 1 } })
// @ts-expect-error Desktop-only provider ids cannot cross the package boundary.
const local: WebSearchProviderId = 'duckduckgo'
// @ts-expect-error Search requires an explicit result count.
void client.execute({ providerId: 'tavily', capability: 'searchKeywords', input: 'hello', config: {} })
void local
`
  write('consumer.mts', consumerTypes)
  write('consumer.cts', consumerTypes)
  const tsc = ['tsc6', 'tsc']
    .map((binary) => join(scratch, 'node_modules/typescript/bin', binary))
    .find((binary) => existsSync(binary))
  assert(tsc, 'Installed TypeScript compiler binary is missing')
  const strict = ['--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'es2022', '--traceResolution']
  for (const [file, extension] of [
    ['consumer.mts', '.d.mts'],
    ['consumer.cts', '.d.cts']
  ]) {
    const trace = run(process.execPath, [
      tsc,
      ...strict,
      '--module',
      'nodenext',
      '--moduleResolution',
      'nodenext',
      file
    ])
    for (const [key, conditions] of Object.entries(manifest.exports)) {
      const target = conditions[file.endsWith('.mts') ? 'import' : 'require'].types.slice(2)
      assert(
        target.endsWith(extension) && trace.includes(join(installed, target)),
        `${key}: did not resolve packed ${extension}`
      )
    }
  }
  const nativeTrace = run(process.execPath, [
    tsc,
    ...strict,
    '--module',
    'esnext',
    '--moduleResolution',
    'bundler',
    '--customConditions',
    'react-native',
    'consumer.mts'
  ])
  assert(
    nativeTrace.includes("Matched 'exports' condition 'react-native'"),
    'Bundler did not select react-native condition'
  )
  for (const [key, conditions] of Object.entries(manifest.exports)) {
    assert(
      nativeTrace.includes(join(installed, conditions['react-native'].types.slice(2))),
      `${key}: missing packed React Native declaration resolution`
    )
  }

  write(
    'browser.mjs',
    `import { build } from 'esbuild'\nawait build({ entryPoints: ${JSON.stringify(Object.fromEntries(Object.keys(entries).map((key, index) => [String(index), specifier(key)])))}, bundle: true, platform: 'browser', format: 'esm', outdir: 'browser', treeShaking: false, metafile: true }).then(result => { if (Object.values(result.metafile.outputs).some(output => output.imports.some(item => item.external))) throw new Error('Browser bundle left external imports') })`
  )
  run(process.execPath, ['browser.mjs'])
  process.stdout.write(
    `Archive SHA256: ${createHash('sha256')
      .update(readFileSync(join(scratch, packed.filename)))
      .digest(
        'hex'
      )}\nFiles (${inventory.size}):\n${[...inventory].sort().join('\n')}\nESM resolutions:\n${esm}CJS resolutions:\n${cjs}Node: ${process.version}; npm: ${run(npm, ['--version']).trim()}; TypeScript: ${run(process.execPath, [tsc, '--version']).trim()}\nAll six package checks passed (17 entries).\n`
  )
} catch (error) {
  process.stderr.write(`Package check failed: ${error.message}\n`)
  if (error.stdout) process.stderr.write(error.stdout)
  if (error.stderr) process.stderr.write(error.stderr)
  process.exitCode = 1
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
