import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { app } from 'electron'

import { defineUtilityProcess } from '../../../src/main/core/utilityProcess/defineUtilityProcess'
import { electronProcessAdapter } from '../../../src/main/core/utilityProcess/host/electronProcessAdapter'
import { ProcessHost } from '../../../src/main/core/utilityProcess/host/ProcessHost'
import {
  terminalConversationId,
  terminalGeneration,
  terminalOperationId,
  terminalResourceId,
  type TerminalCommand,
  type TerminalHostContract,
  type TerminalHostInit,
  type TerminalResourceState
} from '../../../src/main/services/terminal/contracts'
import { createEvidenceLogger, record } from './evidence'

export async function checkTerminalHost(): Promise<void> {
  const identity = {
    conversationId: terminalConversationId.parse('smoke-terminal'),
    generation: terminalGeneration.parse(randomUUID())
  }
  const context = { contextId: 'runtime', bindingId: 'connection', revision: 0 }
  const appDirectory = app.getAppPath()
  const definition = defineUtilityProcess<TerminalHostContract, TerminalHostInit>({
    id: 'terminal.host',
    entry: 'terminal-host',
    cancellation: 'cooperative',
    createInitData: () => ({
      host: identity,
      helperFile: path.join(
        appDirectory.replace(/app\.asar$/, 'app.asar.unpacked'),
        'resources/binaries',
        process.platform === 'win32' ? 'terminal-scope.exe' : 'terminal-scope'
      ),
      ghosttyDirectory: path.join(appDirectory, 'resources/terminal/ghostty')
    })
  })
  const host = new ProcessHost(
    definition,
    {
      adapter: electronProcessAdapter,
      logger: createEvidenceLogger(),
      resolveEntry: (entry) => path.join(appDirectory, 'out/utility-process', `${entry}.js`),
      getTempDir: () => app.getPath('temp')
    },
    'terminal-smoke',
    'never'
  )
  let sequence = 0
  const run = (command: TerminalCommand) => {
    sequence++
    return host.request('mutate', {
      host: identity,
      admissionRevision: 0,
      operation: { id: terminalOperationId.parse(`${identity.generation}:${sequence}`), sequence },
      command
    })
  }
  const controller = new AbortController()
  const states = new Map<string, TerminalResourceState>()
  const stream = await host.openStream('observe', identity, {
    signal: controller.signal,
    input: { maxFrameBytes: 65536, maxBufferedBytes: 262144, maxBufferedFrames: 8, maxPendingWrites: 2 },
    output: { maxFrameBytes: 65536, maxBufferedBytes: 262144, maxBufferedFrames: 8, maxPendingWrites: 2 }
  })
  void stream.completed.catch(() => {})
  const observing = (async () => {
    for await (const frame of stream.output)
      if (frame.metadata.kind === 'state' && frame.payload) {
        const state = JSON.parse(Buffer.from(frame.payload).toString()) as TerminalResourceState
        states.set(state.id, state)
      }
  })()
  const wait = async (predicate: () => boolean) => {
    const deadline = Date.now() + 8000
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Terminal scope confirmation timed out')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  try {
    await run({ kind: 'bind', context })
    const pipe = terminalResourceId.parse(randomUUID())
    const pty = terminalResourceId.parse(randomUUID())
    const file =
      process.platform === 'win32' ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' : '/bin/bash'
    const env = Object.fromEntries(
      Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined)
    )
    const command =
      process.platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output PIPE_OK; exit 31']
        : ['--noprofile', '--norc', '-c', 'printf PIPE_OK; exit 31']
    await run({
      kind: 'start',
      id: pipe,
      context,
      retention: { kind: 'turn', turnId: 'turn' },
      launch: {
        kind: 'pipe',
        shell: process.platform === 'win32' ? 'powershell' : 'bash',
        file,
        args: command,
        cwd: appDirectory.replace(/app\.asar$/, ''),
        env,
        stdin: ''
      }
    })
    await wait(() => states.get(pipe)?.cleanup === 'confirmed')
    const processState = states.get(pipe)?.process
    if (processState?.kind !== 'exited' || processState.exitCode !== 31)
      throw new Error(`Actual pipe exit code was lost: ${JSON.stringify(states.get(pipe))}`)
    const output = await host.request('read', { host: identity, id: pipe, cursor: 0, limit: 1024 })
    if (!Buffer.from(output.data).toString().includes('PIPE_OK')) throw new Error('Pipe output missing')
    if (process.platform !== 'win32') {
      const script =
        "stty -echo; printf '\\033[6n'; if IFS= read -r -s -d R -t 3 response && [[ \"$response\" == $'\\e['* ]]; then printf HEADLESS_OK; fi; exit 19"
      await run({
        kind: 'start',
        id: pty,
        context,
        retention: { kind: 'session' },
        launch: {
          kind: 'pty',
          shell: 'bash',
          file,
          args: ['--noprofile', '--norc', '-c', script],
          cwd: path.dirname(appDirectory),
          env,
          cols: 80,
          rows: 24
        }
      })
      await wait(() => states.get(pty)?.cleanup === 'confirmed')
      const terminal = await host.request('read', { host: identity, id: pty, cursor: 0, limit: 2048 })
      if (!Buffer.from(terminal.data).toString().includes('HEADLESS_OK'))
        throw new Error('Headless VT reply did not reach the PTY')
    }
    record({ event: 'terminal-execution', node: process.version, pipe: states.get(pipe), pty: states.get(pty) })
  } finally {
    await host.request('seal', { host: identity, admissionRevision: 1 })
    controller.abort()
    await observing.catch(() => {})
    await host.stop()
    await host.dispose()
  }
}
