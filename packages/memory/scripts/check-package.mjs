import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'tsdown'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = mkdtempSync(join(process.env.MEMORY_ARTIFACT_DIR ?? tmpdir(), 'memory-package-'))
const require = createRequire(import.meta.url)
function run(command, args, cwd = dir) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}
// Invoke npm's JS entry on Windows so paths with spaces never pass through a shell.
function npmRun(args, cwd = dir) {
  if (process.platform !== 'win32') return run('npm', args, cwd)
  const shim = run('where.exe', ['npm.cmd']).trim().split(/\r?\n/)[0]
  return run(process.execPath, [join(shim, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args], cwd)
}
const [packed] = JSON.parse(npmRun(['pack', '--ignore-scripts', '--json', '--pack-destination', dir], root))
for (const name of ['README.md', 'LICENSE', 'dist/index.cjs', 'dist/index.mjs', 'dist/index.d.cts', 'dist/index.d.mts'])
  assert(
    packed.files.some((f) => f.path === name),
    name
  )
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'memory-consumer', private: true, type: 'module' }))
npmRun(['install', '--ignore-scripts', '--no-audit', '--no-fund', packed.filename])
const installed = JSON.parse(readFileSync(join(dir, 'node_modules/@cherrystudio/memory/package.json'), 'utf8'))
assert.deepEqual(installed.exports['.']['react-native'], { types: './dist/index.d.mts', default: './dist/index.mjs' })
run(process.execPath, [
  '--conditions=react-native',
  '--input-type=module',
  '-e',
  "import assert from 'node:assert/strict';assert.equal(import.meta.resolve('@cherrystudio/memory'),new URL('./node_modules/@cherrystudio/memory/dist/index.mjs',import.meta.url).href)"
])
const manifestPath = join(dir, 'node_modules/@cherrystudio/memory/package.json')
const original = readFileSync(manifestPath, 'utf8')
try {
  installed.exports['.']['react-native'].default = './dist/index.cjs'
  writeFileSync(manifestPath, JSON.stringify(installed))
  run(process.execPath, [
    '--conditions=react-native',
    '--input-type=module',
    '-e',
    "import assert from 'node:assert/strict';assert(import.meta.resolve('@cherrystudio/memory').endsWith('/dist/index.cjs'))"
  ])
} finally {
  writeFileSync(manifestPath, original)
}
run(process.execPath, [
  '-e',
  "require('node:assert/strict').match(require.resolve('@cherrystudio/memory'),/index\\.cjs$/)"
])
for (const name of ['host.mjs', 'engine-host.mjs', 'workflow.test.mjs']) {
  const text = readFileSync(join(root, 'tests', name), 'utf8').replaceAll('../dist/index.mjs', '@cherrystudio/memory')
  writeFileSync(join(dir, name), text)
}
run(process.execPath, ['--conditions=react-native', '--test', 'workflow.test.mjs'])
run(process.execPath, [
  '-e',
  "if(typeof require('@cherrystudio/memory').createMemoryEngine !== 'function')process.exit(1)"
])
for (const ext of ['mts', 'cts'])
  writeFileSync(
    join(dir, 'consumer.' + ext),
    "import { createMemoryEngine, type MemoryEnginePorts } from '@cherrystudio/memory'; export const open = (ports: MemoryEnginePorts) => createMemoryEngine(ports).open;"
  )
run(process.execPath, [
  require.resolve('typescript/bin/tsc'),
  '--module',
  'nodenext',
  '--target',
  'es2023',
  '--strict',
  '--noEmit',
  'consumer.mts',
  'consumer.cts'
])
writeFileSync(join(dir, 'portable.ts'), "export * from '@cherrystudio/memory'")
await build({
  cwd: dir,
  config: false,
  entry: ['portable.ts'],
  outDir: 'consumer-build',
  platform: 'browser',
  format: 'esm',
  dts: false,
  deps: { alwaysBundle: [/./] },
  logLevel: 'silent'
})
process.stdout.write(
  'Verified installed consumer, declarations, conditional exports and neutral bundle.\n' +
    join(dir, packed.filename) +
    '\n'
)
