import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const snapshot = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'migration-diagnostics.json'), 'utf8'))
const result = spawnSync(
  path.join(repoRoot, 'node_modules/.bin/oxlint'),
  ['-c', 'oxlint.config.ts', '--format', 'json', '--threads=1'],
  { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
)

if (result.error) throw result.error
if (!result.stdout) {
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const diagnostics = JSON.parse(result.stdout).diagnostics
const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
if (errors.length) {
  for (const diagnostic of errors) {
    process.stderr.write(`${diagnostic.filename}: ${diagnostic.code}: ${diagnostic.message}\n`)
  }
  process.exit(1)
}

function normalizeDiagnostic(diagnostic) {
  const span = diagnostic.labels[0]?.span
  return [
    path.relative(repoRoot, path.resolve(repoRoot, diagnostic.filename)).split(path.sep).join('/'),
    span?.line ?? null,
    span?.column ?? null,
    diagnostic.code,
    diagnostic.message
  ]
}

function compareDiagnostics(left, right) {
  return (
    left[0].localeCompare(right[0]) ||
    (left[1] ?? -1) - (right[1] ?? -1) ||
    (left[2] ?? -1) - (right[2] ?? -1) ||
    left[3].localeCompare(right[3]) ||
    left[4].localeCompare(right[4])
  )
}

let failed = false
for (const group of snapshot.groups) {
  const actual = diagnostics
    .filter((diagnostic) => group.after.rules.includes(diagnostic.code) && diagnostic.severity === group.after.severity)
    .map(normalizeDiagnostic)
    .sort(compareDiagnostics)
  const expected = [...group.after.diagnostics].sort(compareDiagnostics)

  if (actual.length !== group.after.count) {
    process.stderr.write(
      `${group.name}: expected ${group.after.count} ${group.after.severity} diagnostics, got ${actual.length}\n`
    )
    failed = true
  }

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    process.stderr.write(`${group.name}: diagnostic snapshot changed\n`)
    process.stderr.write(`  expected: ${JSON.stringify(expected)}\n`)
    process.stderr.write(`  actual:   ${JSON.stringify(actual)}\n`)
    failed = true
  }
}

if (failed) process.exit(1)
process.stdout.write(`Verified ${snapshot.groups.length} ESLint-to-Oxlint diagnostic groups.\n`)
