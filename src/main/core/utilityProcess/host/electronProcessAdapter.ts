/**
 * The production ProcessAdapter: `utilityProcess.fork` + a private `MessageChannelMain`.
 * Electron APIs are touched only inside `spawn()` so importing this module needs no Electron.
 */

import { MessageChannelMain, utilityProcess } from 'electron'

import type { ProcessAdapter, ProcessErrorInfo, ProcessHandle, ProcessSpawnOptions } from './processAdapter'
import { createLineDecoder } from './stdioRelay'

export const electronProcessAdapter: ProcessAdapter = {
  spawn({ entryPath, env, serviceName }: ProcessSpawnOptions): ProcessHandle {
    const child = utilityProcess.fork(entryPath, [], {
      env,
      execArgv: [],
      stdio: 'pipe',
      serviceName,
      allowLoadingUnsignedLibraries: false,
      disclaim: false,
      respondToAuthRequestsFromMainProcess: false
    })
    const { port1, port2 } = new MessageChannelMain()
    let spawnListener: (() => void) | null = null
    let messageListener: ((data: unknown) => void) | null = null
    let exitListener: ((code: number) => void) | null = null
    let stdoutListener: ((line: string, truncated: boolean) => void) | null = null
    let stderrListener: ((line: string, truncated: boolean) => void) | null = null
    let errorListener: ((info: ProcessErrorInfo) => void) | null = null
    let connected = false

    const stdout = createLineDecoder((line, truncated) => stdoutListener?.(line, truncated))
    const stderr = createLineDecoder((line, truncated) => stderrListener?.(line, truncated))
    child.stdout?.on('data', (chunk: Buffer | string) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer | string) => stderr.push(chunk))
    port2.on('message', (event) => messageListener?.(event.data))
    port2.start()
    child.on('spawn', () => spawnListener?.())
    child.on('exit', (code) => {
      stdout.end()
      stderr.end()
      port2.close()
      exitListener?.(code)
    })
    child.on('error', (type, location, report) => errorListener?.({ type, location, report }))

    return {
      get pid() {
        return child.pid
      },
      connect(frame) {
        if (connected) throw new Error('utility process already connected')
        connected = true
        child.postMessage(frame, [port1])
      },
      send(frame) {
        port2.postMessage(frame)
      },
      kill() {
        child.kill()
      },
      onSpawn(listener) {
        spawnListener = listener
      },
      onMessage(listener) {
        messageListener = listener
      },
      onExit(listener) {
        exitListener = listener
      },
      onStdoutLine(listener) {
        stdoutListener = listener
      },
      onStderrLine(listener) {
        stderrListener = listener
      },
      onError(listener) {
        errorListener = listener
      }
    }
  }
}
