import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WASI } from 'node:wasi'
import { parentPort, workerData } from 'node:worker_threads'

import loadWasm from '../../../../resources/wasm/qjs-wasi.wasm?loader'

interface WorkerPayload {
  code: string
}

export interface JsExecutionResult {
  stdout: string
  stderr: string
  error?: string
  exitCode: number
}

if (!parentPort) {
  throw new Error('JsWorker requires a parent port')
}

async function runQuickJsInSandbox(jsCode: string): Promise<JsExecutionResult> {
  let tempDir: string | undefined
  let stdoutHandle: Awaited<ReturnType<typeof open>> | undefined
  let stderrHandle: Awaited<ReturnType<typeof open>> | undefined
  let stdoutPath: string | undefined
  let stderrPath: string | undefined

  try {
    tempDir = await mkdtemp(join(tmpdir(), 'quickjs-wasi-'))
    stdoutPath = join(tempDir, 'stdout.log')
    stderrPath = join(tempDir, 'stderr.log')

    stdoutHandle = await open(stdoutPath, 'w')
    stderrHandle = await open(stderrPath, 'w')

    const wasi = new WASI({
      version: 'preview1',
      args: ['qjs', '-e', jsCode],
      env: {}, // Empty environment for security - don't expose host env vars
      stdin: 0,
      stdout: stdoutHandle.fd,
      stderr: stderrHandle.fd,
      returnOnExit: true
    })
    const instance = await loadWasm(wasi.getImportObject() as WebAssembly.Imports)

    let exitCode = 0
    try {
      exitCode = wasi.start(instance)
    } catch (wasiError: any) {
      return {
        stdout: '',
        stderr: `WASI start error: ${wasiError?.message ?? String(wasiError)}`,
        error: `Sandbox execution failed during start: ${wasiError?.message ?? String(wasiError)}`,
        exitCode: -1
      }
    }

    // Close handles before reading files to prevent descriptor leak
    const _stdoutHandle = stdoutHandle
    stdoutHandle = undefined
    await _stdoutHandle.close()

    const _stderrHandle = stderrHandle
    stderrHandle = undefined
    await _stderrHandle.close()

    const capturedStdout = await readFile(stdoutPath, 'utf8')
    const capturedStderr = await readFile(stderrPath, 'utf8')

    let executionError: string | undefined
    if (exitCode !== 0) {
      executionError = `QuickJS process exited with code ${exitCode}. Check stderr for details.`
    }

    return {
      stdout: capturedStdout,
      stderr: capturedStderr,
      error: executionError,
      exitCode
    }
  } catch (error: any) {
    return {
      stdout: '',
      stderr: '',
      error: `Sandbox setup or execution failed: ${error?.message ?? String(error)}`,
      exitCode: -1
    }
  } finally {
    if (stdoutHandle) await stdoutHandle.close()
    if (stderrHandle) await stderrHandle.close()
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  }
}

async function execute(code: string) {
  return runQuickJsInSandbox(code)
}

const payload = workerData as WorkerPayload | undefined

if (!payload?.code || typeof payload.code !== 'string') {
  parentPort.postMessage({ success: false, error: 'JavaScript code must be provided to the worker' })
} else {
  execute(payload.code)
    .then((result) => {
      parentPort?.postMessage({ success: true, result })
    })
    .catch((error: any) => {
      const errorMessage = error instanceof Error ? error.message : String(error)
      parentPort?.postMessage({ success: false, error: errorMessage })
    })
}
