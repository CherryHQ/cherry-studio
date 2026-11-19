import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { decodeTerminalRows } from '@shared/utils/terminalFrame'

import {
  terminalConversationId,
  terminalGeneration,
  terminalOperationId,
  terminalResourceId,
  type TerminalCommand,
  type TerminalResourceState
} from '../../contracts'
import { TerminalHost } from '../TerminalHost'

const root = process.cwd()
const context = { contextId: 'native-root', bindingId: 'connection', revision: 0 }
function create() {
  const host = new TerminalHost(
    {
      host: {
        conversationId: terminalConversationId.parse(randomUUID()),
        generation: terminalGeneration.parse(randomUUID())
      },
      helperFile: path.join(root, 'resources/binaries', `${process.platform}-${process.arch}`, 'terminal-scope'),
      ghosttyDirectory: path.join(root, 'resources/terminal/ghostty'),
      integrationDirectory: path.join(root, 'resources/terminal/shellIntegration')
    },
    { debug() {}, info() {}, warn() {}, error() {} }
  )
  const states = new Map<string, TerminalResourceState>()
  const abort = new AbortController()
  const observing = host.observe(host.init.host, {
    signal: abort.signal,
    input: (async function* () {})(),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    write: async (frame) => {
      if (frame.metadata.kind === 'state' && frame.payload) {
        const state = JSON.parse(Buffer.from(frame.payload).toString()) as TerminalResourceState
        states.set(state.id, state)
      }
    }
  })
  let sequence = 0
  const mutation = (command: TerminalCommand) => {
    sequence++
    return {
      host: host.init.host,
      admissionRevision: 0,
      operation: { id: terminalOperationId.parse(`${host.init.host.generation}:${sequence}`), sequence },
      command
    }
  }
  const run = (command: TerminalCommand) => host.mutate(mutation(command))
  const dispose = async () => {
    await host.seal(host.init.host, 1)
    abort.abort()
    await observing
  }
  return { host, states, mutation, run, dispose }
}
describe.skipIf(process.platform === 'win32').each([
  { shell: 'bash', customZdotdir: false },
  { shell: 'zsh', customZdotdir: false },
  { shell: 'zsh', customZdotdir: true }
] as const)('managed $shell shell (custom ZDOTDIR: $customZdotdir)', ({ shell, customZdotdir }) => {
  let home: string
  let profiles: string
  beforeAll(async () => {
    execFileSync('node', ['native/terminal-scope/build.cjs'], { cwd: root })
    home = await mkdtemp(path.join(tmpdir(), 'cherry-terminal-home-'))
    profiles = customZdotdir ? await mkdtemp(path.join(tmpdir(), 'cherry-terminal-zdotdir-')) : home
    for (const name of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
      await writeFile(path.join(profiles, name), `export CHERRY_PROFILE_ORDER="\${CHERRY_PROFILE_ORDER}${name},"\n`)
    }
  })
  afterAll(async () => {
    await rm(home, { recursive: true, force: true })
    if (customZdotdir) await rm(profiles, { recursive: true, force: true })
  })
  it('preserves shell state, records real command failure, refuses busy commands and admits fenced REPL stdin', async () => {
    const item = create()
    const id = terminalResourceId.parse(randomUUID())
    const actor = { kind: 'agent' as const, context }
    try {
      await item.run({ kind: 'bind', context })
      await item.run({
        kind: 'start',
        id,
        context,
        retention: { kind: 'session' },
        launch: {
          kind: 'pty',
          shell,
          file: `/bin/${shell}`,
          args: [],
          cwd: root,
          env: { PATH: '/usr/bin:/bin', HOME: home, ...(customZdotdir ? { ZDOTDIR: profiles } : {}) },
          cols: 80,
          rows: 24
        }
      })
      const state = () => item.states.get(id)!
      await vi.waitFor(() => expect(state()?.shellFacts?.kind).toBe('prompt'))
      const command = async (data: string, commandId: string) => {
        const facts = state().shellFacts
        if (facts?.kind !== 'prompt') throw new Error('Shell did not reach its prompt')
        return item.run({
          kind: 'shell-command',
          id,
          actor,
          controlRevision: state().controlRevision,
          promptRevision: facts.revision,
          commandId,
          data
        })
      }
      await command('export CHERRY_TERMINAL_TEST=persisted; cd /; false', 'first')
      await vi.waitFor(() => expect(state().command).toMatchObject({ id: 'first', status: 'completed', exitCode: 1 }))
      expect(state().shellFacts).toMatchObject({ kind: 'prompt', cwd: '/' })
      await command('printf "STATE:%s\\n" "$CHERRY_TERMINAL_TEST"', 'second')
      await vi.waitFor(() => expect(state().command).toMatchObject({ id: 'second', status: 'completed', exitCode: 0 }))
      const output = () => Buffer.from(item.host.read(item.host.init.host, id, 0, 60 * 1024).data).toString()
      expect(output()).toContain('STATE:persisted')
      if (shell === 'zsh') {
        await command('printf "PROFILE:%s:%s\\n" "$CHERRY_PROFILE_ORDER" "${ZDOTDIR-unset}"', 'profile')
        await vi.waitFor(() =>
          expect(state().command).toMatchObject({ id: 'profile', status: 'completed', exitCode: 0 })
        )
        expect(output()).toContain(
          `PROFILE:.zshenv,.zprofile,.zshrc,.zlogin,:${customZdotdir ? profiles : 'unset'}\r\n`
        )
      }
      expect(output()).not.toContain(']633;Cherry;')
      await command(
        `${JSON.stringify(process.execPath)} -e 'process.stdout.write("REPL_READY"); process.stdin.once("data",d=>{process.stdout.write("RECEIVED:"+d);process.exit(0)})'`,
        'repl'
      )
      await vi.waitFor(() => expect(output()).toContain('REPL_READY'))
      const facts = state().shellFacts
      expect(facts?.kind).toBe('program')
      if (facts?.kind !== 'program') throw new Error('No program identity')
      expect(
        await item.run({
          kind: 'shell-command',
          id,
          actor,
          controlRevision: state().controlRevision,
          promptRevision: 0,
          commandId: 'busy',
          data: 'echo WRONG'
        })
      ).toEqual({ kind: 'rejected', reason: 'busy' })
      expect(
        await item.run({
          kind: 'input',
          id,
          actor,
          controlRevision: state().controlRevision,
          commandId: 'repl',
          programRevision: facts.programRevision - 1,
          data: 'WRONG\n'
        })
      ).toEqual({ kind: 'rejected', reason: 'stale_control' })
      const request = item.mutation({
        kind: 'input',
        id,
        actor,
        controlRevision: state().controlRevision,
        commandId: 'repl',
        programRevision: facts.programRevision,
        data: '你好\n'
      })
      await Promise.all([item.host.mutate(request), item.host.mutate(request)])
      await vi.waitFor(() => expect(state().command).toMatchObject({ id: 'repl', status: 'completed', exitCode: 0 }))
      expect(output()).toContain('RECEIVED:你好')
      expect(output()).not.toContain('RECEIVED:WRONG')
      const frame = item.host.view({
        host: item.host.init.host,
        id,
        viewId: 'viewer',
        rowStart: 0,
        offset: 0,
        revision: null
      })
      expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThan(64 * 1024)
      expect(
        decodeTerminalRows(frame.snapshot.rowData, frame.styles).some((row) => row.text.includes('RECEIVED:你好'))
      ).toBe(true)
      item.host.detachView(item.host.init.host, id, 'viewer')
      await command('printf REOPENED', 'last')
      await vi.waitFor(() => expect(state().command).toMatchObject({ id: 'last', status: 'completed', exitCode: 0 }))
      expect(
        item.host.view({ host: item.host.init.host, id, viewId: 'new-view', rowStart: 0, offset: 0, revision: null })
          .resource.id
      ).toBe(id)
    } finally {
      await item.dispose()
    }
  })
})
