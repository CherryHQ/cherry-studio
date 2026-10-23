import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cliPath = fileURLToPath(new URL('../dist/src/cli/lab.js', import.meta.url))
const exitTimeoutMs = 10000
const drainTimeoutMs = 500
const maxOutputBytes = 2 * 1024 * 1024

export interface CliResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

export function runCli(args: string[], input = ''): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }
    })
    const stdout: Buffer[] = [],
      stderr: Buffer[] = []
    let bytes = 0
    let code: number | null = null
    let signal: NodeJS.Signals | null = null
    let failure: Error | undefined
    let finished = false
    let drainTimer: ReturnType<typeof setTimeout> | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(exitTimer)
      clearTimeout(drainTimer)
      clearTimeout(killTimer)
      clearTimeout(cleanupTimer)
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      }
      if (failure) reject(new Error(`${failure.message}\n${JSON.stringify(result)}`))
      else resolve(result)
    }
    const fail = (message: string) => {
      if (failure || finished) return
      failure = new Error(message)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 100)
      cleanupTimer = setTimeout(() => {
        child.stdin.destroy()
        child.stdout.destroy()
        child.stderr.destroy()
        child.unref()
        finish()
      }, 1000)
    }
    const exitTimer = setTimeout(() => fail(`CLI did not exit within ${exitTimeoutMs}ms`), exitTimeoutMs)
    const collect = (chunks: Buffer[], chunk: Buffer) => {
      if (failure) return
      bytes += chunk.length
      if (bytes > maxOutputBytes) fail(`CLI output exceeded ${maxOutputBytes} bytes`)
      else chunks.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk))
    child.stdout.on('error', (error) => fail(`CLI stdout failed: ${error.message}`))
    child.stderr.on('error', (error) => fail(`CLI stderr failed: ${error.message}`))
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') fail(`CLI stdin failed: ${error.message}`)
    })
    child.on('error', (error) => fail(`CLI spawn failed: ${error.message}`))
    child.on('exit', (exitCode, exitSignal) => {
      code = exitCode
      signal = exitSignal
      clearTimeout(exitTimer)
      drainTimer = setTimeout(() => fail(`CLI exited but stdio stayed open for ${drainTimeoutMs}ms`), drainTimeoutMs)
    })
    // Exit precedes the last pipe data; assertions must wait for close.
    child.on('close', finish)
    child.stdin.end(input)
  })
}
