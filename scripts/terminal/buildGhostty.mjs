import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const assetDir = path.resolve(scriptDir, '../../resources/terminal/ghostty')
const manifest = JSON.parse(readFileSync(path.join(assetDir, 'manifest.json'), 'utf8'))
const [sourceDir, zig] = process.argv.slice(2)
if (!sourceDir || !zig)
  throw new Error('Usage: node scripts/terminal/buildGhostty.mjs <ghostty-checkout> <zig-executable>')

function run(command, args, cwd = sourceDir) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

if (run('git', ['rev-parse', 'HEAD']) !== manifest.ghosttyRevision)
  throw new Error('Ghostty checkout revision does not match manifest')
if (run('git', ['status', '--porcelain'])) throw new Error('Ghostty checkout must be clean')
if (run(zig, ['version']) !== manifest.zigVersion) throw new Error('Zig version does not match manifest')

const buildDir = mkdtempSync(path.join(tmpdir(), 'cherry-ghostty-build-'))
try {
  run(zig, [
    'build',
    '-Demit-lib-vt',
    '-Dtarget=wasm32-freestanding',
    '-Doptimize=ReleaseSmall',
    '-Dstrip=true',
    `-Dlib-version-string=0.1.0-dev+${manifest.ghosttyRevision}`,
    '-p',
    buildDir
  ])
  const trampoline = path.join(buildDir, 'bin', 'ghostty-write-pty.wasm')
  run(zig, [
    'build-exe',
    path.join(scriptDir, 'ghosttyWritePty.zig'),
    '-target',
    'wasm32-freestanding',
    '-O',
    'ReleaseSmall',
    '-fno-entry',
    '-rdynamic',
    `-femit-bin=${trampoline}`
  ])
  for (const [file, expected] of Object.entries(manifest.sha256)) {
    const actual = createHash('sha256')
      .update(readFileSync(path.join(buildDir, 'bin', file)))
      .digest('hex')
    if (actual !== expected) throw new Error(`${file} hash mismatch: expected ${expected}, got ${actual}`)
  }
  for (const file of Object.keys(manifest.sha256))
    copyFileSync(path.join(buildDir, 'bin', file), path.join(assetDir, file))
} finally {
  rmSync(buildDir, { recursive: true, force: true })
}
