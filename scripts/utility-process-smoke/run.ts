/**
 * Builds the throwaway harness app, runs it unpacked and from an app.asar, and turns both
 * NDJSON transcripts into `local/utility-process-smoke/evidence/summary.json`.
 * Manual gate — not part of `pnpm test`; see docs/references/utility-process/utility-process-testing.md.
 */

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { createPackage, listPackage } from '@electron/asar'

const REPO_ROOT = path.resolve(__dirname, '../..')
const OUT_ROOT = path.join(REPO_ROOT, 'local', 'utility-process-smoke')
const APP_DIR = path.join(OUT_ROOT, 'app')
const EVIDENCE_DIR = path.join(OUT_ROOT, 'evidence')
const ASAR_PATH = path.join(OUT_ROOT, 'app.asar')
const RUN_TIMEOUT_MS = 120_000
const ALLOWED_REQUIRES = /^(node:|\.{1,2}\/|electron$)/

type EvidenceRecord = Record<string, unknown> & { event: string }

function build(configName: string): void {
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
      'build',
      '--config',
      path.join(__dirname, configName),
      '--mode',
      'production'
    ],
    {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production', UTILITY_PROCESS_SMOKE_APP_DIR: APP_DIR }
    }
  )
  if (result.status !== 0) throw new Error(`${configName} build failed with status ${String(result.status)}`)
}

function listJsFiles(root: string): string[] {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(entry.parentPath, entry.name))
}

/** The child bundle must be self-contained: nothing but relative modules, `electron`, and Node builtins. */
function assertHermetic(): void {
  const mainEntry = path.join(APP_DIR, 'out', 'main', 'index.js')
  const entriesDir = path.join(APP_DIR, 'out', 'utility-process')
  for (const entry of ['smoke-echo.js', 'smoke-echo-terminate.js']) {
    const file = path.join(entriesDir, entry)
    if (!fs.existsSync(file)) throw new Error(`missing utility entry bundle: ${file}`)
  }
  if (!fs.existsSync(mainEntry)) throw new Error(`missing main bundle: ${mainEntry}`)

  for (const file of listJsFiles(entriesDir)) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/require\((['"])([^'"]+)\1\)/g)) {
      const target = match[2]
      if (!ALLOWED_REQUIRES.test(target)) {
        throw new Error(`${path.relative(APP_DIR, file)} requires a non-hermetic module: ${target}`)
      }
    }
  }
  for (const file of [mainEntry, ...listJsFiles(entriesDir)]) {
    const source = fs.readFileSync(file, 'utf8')
    const leaked = ['LoggerService', 'winston', 'ServiceContainer'].filter((symbol) => source.includes(symbol))
    if (leaked.length > 0) {
      throw new Error(`${path.relative(APP_DIR, file)} leaked main-only code: ${leaked.join(', ')}`)
    }
  }
}

function runVariant(variant: string, appTarget: string): Promise<EvidenceRecord[]> {
  const electronBinary = require('electron') as string
  const env: Record<string, string | undefined> = { ...process.env, SMOKE_VARIANT: variant }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  return new Promise((resolve, reject) => {
    const child = spawn(electronBinary, [appTarget], { cwd: REPO_ROOT, env })
    let stdout = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${variant} run exceeded ${RUN_TIMEOUT_MS} ms`))
    }, RUN_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk))
    child.on('exit', (code) => {
      clearTimeout(timer)
      fs.writeFileSync(path.join(EVIDENCE_DIR, `run-${variant}.log`), stdout)
      const records = stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as EvidenceRecord)
      if (code !== 0) reject(new Error(`${variant} exited with code ${String(code)}`))
      else resolve(records)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function summarize(variant: string, records: EvidenceRecord[]) {
  const checks = records.filter((entry) => entry.event === 'check')
  const complete = records.find((entry) => entry.event === 'complete')
  if (complete === undefined) throw new Error(`${variant} produced no completion record`)
  return {
    variant,
    result: complete.result,
    checks: checks.map((entry) => ({ name: entry.name, status: entry.status, message: entry.message }))
  }
}

async function main(): Promise<void> {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true })
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  build('electron.vite.main.config.ts')
  build('electron.vite.entries.config.ts')
  fs.writeFileSync(
    path.join(APP_DIR, 'package.json'),
    `${JSON.stringify({ name: 'utility-process-smoke', version: '0.0.0', main: 'out/main/index.js' }, null, 2)}\n`
  )
  assertHermetic()

  const variants = [summarize('production-unpacked', await runVariant('production-unpacked', APP_DIR))]
  await createPackage(APP_DIR, ASAR_PATH)
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'asar-files.txt'),
    `${listPackage(ASAR_PATH, { isPack: false }).join('\n')}\n`
  )
  variants.push(summarize('production-asar', await runVariant('production-asar', ASAR_PATH)))

  const failed = variants.filter((entry) => entry.result !== 'pass')
  const summary = { result: failed.length === 0 ? 'pass' : 'fail', variants }
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  if (failed.length > 0) throw new Error(`smoke failed: ${failed.map((entry) => entry.variant).join(', ')}`)
  process.stdout.write(`utility-process smoke passed; evidence in ${path.relative(REPO_ROOT, EVIDENCE_DIR)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
