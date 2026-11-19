import { mkdtempSync, mkdirSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent'
import { createTestTerminalService } from '@test-helpers/terminal'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { loadPiSdk } from '../../pi/piSdk'
import { TerminalTools } from '../TerminalTools'

describe.skipIf(process.platform === 'win32')('native terminal tool adapters', () => {
  let root: string
  let service: Awaited<ReturnType<typeof createTestTerminalService>>
  let tools: TerminalTools
  let context: ExtensionToolContext
  beforeEach(async () => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'cherry-terminal-tools-')))
    vi.mocked(application.getPath).mockImplementation((key, file) => {
      const dir = path.join(root, key)
      mkdirSync(dir, { recursive: true })
      return file ? path.join(dir, file) : dir
    })
    service = await createTestTerminalService()
    tools = new TerminalTools('product-conversation', root, { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root })
    context = { cwd: root, sessionManager: { getSessionId: () => 'native-root' } } as ExtensionToolContext
  })
  afterEach(async () => {
    await tools.close()
    await service._doStop()
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })
  const bash = async () => {
    const sdk = await loadPiSdk()
    return tools.bindPi(
      sdk.createBashToolDefinition(root, {
        backgroundOperations: tools.piBashOperations(),
        exposeSessionEnvironment: false
      })
    )
  }
  it('keeps native Bash output, exit codes and fresh cwd/environment across calls', async () => {
    const tool = await bash()
    const first = await tool.execute(
      'first',
      { command: 'export CHERRY_TERMINAL_FRESH_TEST=leaked; cd /; printf "FIRST:中文\\n"; exit 17' },
      undefined,
      undefined,
      context
    )
    expect(first).toMatchObject({ isError: true, structuredContent: { exit_code: 17, output: 'FIRST:中文\n' } })
    const second = await tool.execute(
      'second',
      { command: 'printf "STATE:%s\\n" "${CHERRY_TERMINAL_FRESH_TEST:-absent}"; pwd' },
      undefined,
      undefined,
      context
    )
    expect(second).toMatchObject({ structuredContent: { exit_code: 0, output: `STATE:absent\n${root}\n` } })
    expect(service.list(tools.conversationId)).toHaveLength(2)
  })
  it('returns a typed running receipt and survives cancellation of its former foreground signal', async () => {
    const tool = await bash()
    const abort = new AbortController()
    const result = await tool.execute(
      'background',
      { command: 'printf BACKGROUND; sleep 1; printf FINISHED', run_in_background: true },
      abort.signal,
      undefined,
      context
    )
    expect(result).toMatchObject({ structuredContent: { status: 'running', execution_id: expect.any(String) } })
    expect(JSON.stringify(result)).not.toContain('exit_code')
    abort.abort()
    await vi.waitFor(() => expect(service.list(tools.conversationId)[0]?.process.kind).toBe('exited'), {
      timeout: 5000
    })
    const state = service.list(tools.conversationId)[0]
    expect(state.retention).toEqual({ kind: 'session' })
    expect(service.readText({ host: state.host, id: state.id }).output).toBe('BACKGROUNDFINISHED')
  })
  it('keeps argv literal and decodes split stdout separately from intervening stderr', async () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const literal = 'literal ; $(echo WRONG) "quoted"\nnext'
    const result = await tools.durableExec(
      [
        process.execPath,
        '-e',
        'const b=Buffer.from("中文");process.stdout.write(b.subarray(0,1));setTimeout(()=>{process.stderr.write("ERROR");setTimeout(()=>{process.stdout.write(b.subarray(1));process.stdout.write(process.argv[1])},20)},20)',
        literal
      ],
      {
        cwd: root,
        inheritEnv: false,
        env: { PATH: '/usr/bin:/bin' },
        onOutput: (text, _ctx, info) => (info.stream === 'stdout' ? stdout : stderr).push(text)
      },
      BACKGROUND_CONTEXT,
      { thread: 'durable-root', id: 'literal-argv' }
    )
    expect(result).toMatchObject({ ok: true, value: { exitCode: 0 } })
    expect(stdout.join('')).toBe('中文' + literal)
    expect(stderr.join('')).toBe('ERROR')
  })
  it('preserves full output diagnostics when the native Durable tool requests spilling', async () => {
    const output: string[] = []
    const result = await tools.durableExec(
      [process.execPath, '-e', 'process.stdout.write("FULL-OUTPUT-TAIL")'],
      { cwd: root, spill: { afterBytes: 4, afterLines: 2 }, onOutput: (text) => output.push(text) },
      BACKGROUND_CONTEXT,
      { thread: 'durable-root', id: 'spill' }
    )
    expect(result.ok).toBe(true)
    if (!result.ok || !('spillPath' in result.value) || !result.value.spillPath)
      throw new Error('Missing full-output diagnostic')
    expect(output.join('')).toBe('FULL-OUTPUT-TAIL')
    expect(readFileSync(result.value.spillPath, 'utf8')).toBe('FULL-OUTPUT-TAIL')
  })
  it('keeps a yielded persistent program alive and interrupts it without closing its shell', async () => {
    const call = { thread: 'native-root', id: 'open' }
    const opened = await tools.execute('terminal_open', {}, call)
    if (!('kind' in opened) || opened.kind !== 'resource') throw new Error('Terminal did not open')
    const terminal = opened.resource
    if (terminal.shellFacts?.kind !== 'prompt') throw new Error('No verified prompt')
    const sent = await tools.execute(
      'terminal_send',
      {
        terminal_id: terminal.id,
        control_revision: terminal.controlRevision,
        prompt_revision: terminal.shellFacts.revision,
        kind: 'command',
        data: 'sleep 30',
        yield_ms: 100
      },
      { thread: 'native-root', id: 'server' }
    )
    expect(sent).toMatchObject({ status: 'running', resource: { process: { kind: 'running' } } })
    await service.stopTurn({ conversationId: tools.conversationId, context: terminal.context }, 'server')
    await vi.waitFor(() => expect(service.list(tools.conversationId)[0]?.shellFacts?.kind).toBe('program'))
    const state = service.list(tools.conversationId)[0]
    const facts = state.shellFacts
    if (facts?.kind !== 'program') throw new Error('No foreground program')
    await tools.execute(
      'terminal_signal',
      {
        terminal_id: state.id,
        control_revision: state.controlRevision,
        command_id: facts.commandId,
        program_revision: facts.programRevision
      },
      { thread: 'native-root', id: 'interrupt' }
    )
    await vi.waitFor(() => expect(service.list(tools.conversationId)[0]?.shellFacts?.kind).toBe('prompt'))
    expect(service.list(tools.conversationId)[0]?.process.kind).toBe('running')
  })
})
