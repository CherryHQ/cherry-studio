import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('shutdown watchdog', () => {
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'shutdown-watchdog-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function run(body: string): Promise<{ code: number | null; signal: string | null }> {
    const modulePath = path.join(directory, 'watchdog.cjs')
    const source = await readFile(path.resolve('src/main/core/application/shutdownWatchdog.ts'), 'utf8')
    await writeFile(
      modulePath,
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText
    )
    const script = path.join(directory, 'child.cjs')
    await writeFile(script, `const { startShutdownWatchdog } = require('./watchdog.cjs');\n${body}`)
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], { stdio: 'ignore' })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('Watchdog failed to terminate blocked child'))
      }, 5000)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        resolve({ code, signal })
      })
    })
  }

  it('terminates its own process while the main thread is synchronously blocked', async () => {
    const result = await run(`startShutdownWatchdog(100, () => process.exit(2)); while (true) {}`)
    expect(result.signal === 'SIGKILL' || (process.platform === 'win32' && result.code !== 0)).toBe(true)
  })

  it('does not terminate a process after successful shutdown cancels the deadline', async () => {
    const result = await run(
      `const stop = startShutdownWatchdog(100, () => process.exit(2)); stop(); setTimeout(() => process.exit(0), 300);`
    )
    expect(result).toEqual({ code: 0, signal: null })
  })
})
