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
const powershell = process.env.CHERRY_TEST_PWSH
const waitForHost = (check: () => unknown) => vi.waitFor(check, { timeout: 5000 })
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
  { shell: 'zsh', customZdotdir: true },
  { shell: 'powershell', customZdotdir: false }
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
  it.skipIf(shell === 'powershell' && !powershell)(
    'preserves shell state, records real command failure, refuses busy commands and admits fenced REPL stdin',
    async () => {
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
            file: shell === 'powershell' ? powershell! : `/bin/${shell}`,
            args: [],
            cwd: root,
            env: {
              PATH: '/usr/bin:/bin',
              HOME: home,
              ...(shell === 'bash' ? { LC_ALL: 'C' } : {}),
              ...(customZdotdir ? { ZDOTDIR: profiles } : {})
            },
            cols: 80,
            rows: 24
          }
        })
        const state = () => item.states.get(id)!
        const output = () => Buffer.from(item.host.read(item.host.init.host, id, 0, 60 * 1024).data).toString()
        await vi.waitFor(() => expect(state()?.shellFacts?.kind).toBe('prompt'), { timeout: 10_000 })
        const initial = item.host.view({
          host: item.host.init.host,
          id,
          viewId: 'initial',
          rowStart: 0,
          offset: 0,
          revision: null
        })
        expect(initial.sourceContentEnd).toBeLessThan(initial.sourceTotal!)
        item.host.detachView(item.host.init.host, id, 'initial')
        const command = async (data: string, commandId: string) => {
          await waitForHost(() => expect(state().editor?.kind).toBe('empty'))
          const facts = state().shellFacts
          if (facts?.kind !== 'prompt') throw new Error('Shell did not reach its prompt')
          return item.run({
            kind: 'shell-command',
            id,
            actor,
            controlRevision: state().controlRevision,
            promptRevision: facts.revision,
            draftRevision: state().editor!.revision,
            commandId,
            data
          })
        }
        await command(
          shell === 'powershell'
            ? "$env:CHERRY_TERMINAL_TEST='persisted'; Set-Location /; & /usr/bin/false"
            : 'export CHERRY_TERMINAL_TEST=persisted; cd /; false',
          'first'
        )
        await waitForHost(() =>
          expect(state().command, output()).toMatchObject({ id: 'first', status: 'completed', exitCode: 1 })
        )
        expect(state().shellFacts).toMatchObject({ kind: 'prompt', cwd: '/' })
        await command(
          shell === 'powershell'
            ? '[Console]::WriteLine("STATE:$env:CHERRY_TERMINAL_TEST")'
            : 'printf "STATE:%s\\n" "$CHERRY_TERMINAL_TEST"',
          'second'
        )
        await waitForHost(() =>
          expect(state().command).toMatchObject({ id: 'second', status: 'completed', exitCode: 0 })
        )
        if (shell === 'powershell') {
          await command('& /usr/bin/true; Write-Error failed', 'cmdlet-failure')
          await waitForHost(() =>
            expect(state().command).toMatchObject({ id: 'cmdlet-failure', status: 'completed', exitCode: 1 })
          )
        }
        expect(output()).toContain('STATE:persisted')
        if (shell === 'bash') {
          const multiline = ["printf '%s\\n' '中文🙂' \"quote'kept\" 'back\\slash'", 'false', '', ''].join('\n')
          await command(multiline, 'multiline-unicode')
          await waitForHost(() =>
            expect(state().command, output()).toMatchObject({
              id: 'multiline-unicode',
              status: 'completed',
              exitCode: 1
            })
          )
          expect(output()).toContain("中文🙂\r\nquote'kept\r\nback\\slash\r\n")
          expect(await command(`printf '%s' '${'🙂'.repeat(5000)}'`, 'encoded-capacity')).toEqual({
            kind: 'rejected',
            reason: 'capacity_exceeded'
          })
          expect(state().editor?.kind).toBe('empty')
          expect(state().command?.id).toBe('multiline-unicode')
        }
        if (shell === 'zsh') {
          await command('printf "PROFILE:%s:%s\\n" "$CHERRY_PROFILE_ORDER" "${ZDOTDIR-unset}"', 'profile')
          await waitForHost(() =>
            expect(state().command).toMatchObject({ id: 'profile', status: 'completed', exitCode: 0 })
          )
          expect(output()).toContain(
            `PROFILE:.zshenv,.zprofile,.zshrc,.zlogin,:${customZdotdir ? profiles : 'unset'}\r\n`
          )
        }
        expect(output()).not.toContain(']633;Cherry;')
        await command(
          `${shell === 'powershell' ? '& ' : ''}${JSON.stringify(process.execPath)} -e 'process.stdout.write("REPL_READY"); process.stdin.once("data",d=>{process.stdout.write("RECEIVED:"+d);process.exit(0)})'`,
          'repl'
        )
        await waitForHost(() => expect(state().shellFacts?.kind).toBe('program'))
        await waitForHost(() => expect(output()).toContain('REPL_READY'))
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
            draftRevision: 0,
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
        await waitForHost(() => expect(state().command).toMatchObject({ id: 'repl', status: 'completed', exitCode: 0 }))
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
        const lastCommand =
          shell === 'powershell'
            ? "[Console]::WriteLine('REOPENED 中文🙂')\n[Console]::WriteLine('SECOND')"
            : 'printf REOPENED'
        await command(lastCommand, 'last')
        await waitForHost(() =>
          expect(state().command, output()).toMatchObject({ id: 'last', status: 'completed', exitCode: 0 })
        )
        expect(
          item.host.view({ host: item.host.init.host, id, viewId: 'new-view', rowStart: 0, offset: 0, revision: null })
            .resource.id
        ).toBe(id)
        const ref = { host: item.host.init.host, id, viewId: 'new-view' }
        const list = item.host.listBlocks({ ...ref, cursor: null, expectedIndexRevision: null, limit: 32 })
        expect(list.kind).toBe('blocks')
        if (list.kind !== 'blocks') throw new Error('No blocks')
        const previous = list.blocks.at(-1)!
        expect(
          item.host.readBlock({ ...ref, blockId: previous.id, part: 'command', consistency: { kind: 'latest' } })
        ).toMatchObject({ kind: 'content', text: lastCommand })
        const firstQuery = item.host.setSearch({
          ...ref,
          queryRevision: 1,
          scope: { kind: 'terminal' },
          needle: 'REOPENED'
        })
        await waitForHost(() => {
          const frame = item.host.view({ ...ref, rowStart: 0, offset: 0, revision: null })
          expect(frame.search?.count).toBeGreaterThan(0)
        })
        item.host.setSearch({
          ...ref,
          queryRevision: 2,
          scope: { kind: 'block', blockId: previous.id },
          needle: 'printf'
        })
        item.host.closeSearch({ ...ref, queryRevision: firstQuery.queryRevision })
        await waitForHost(() =>
          expect(item.host.view({ ...ref, rowStart: 0, offset: 0, revision: null }).search?.queryRevision).toBe(2)
        )
        const emptyQuery = { ...ref, queryRevision: 3, scope: { kind: 'terminal' as const }, needle: '' }
        expect(item.host.setSearch(emptyQuery).status).toBe('unavailable')
        expect(item.host.setSearch(emptyQuery).status).toBe('unavailable')
        item.host.closeSearch({ ...ref, queryRevision: 4 })
        expect(() => item.host.setSearch({ ...emptyQuery, queryRevision: 4, needle: 'REOPENED' })).toThrow(
          'Stale terminal search'
        )
        const currentQuery = { ...emptyQuery, queryRevision: 5, needle: 'REOPENED' }
        item.host.setSearch(currentQuery)
        item.host.closeSearch({ ...ref, queryRevision: 5 })
        expect(item.host.setSearch(currentQuery)).toMatchObject({
          status: 'unavailable',
          count: 0,
          selected: null,
          matches: []
        })
        await item.run({
          kind: 'control',
          id,
          actor: { kind: 'user' },
          controlRevision: state().controlRevision,
          target: { kind: 'user' }
        })
        await waitForHost(() => expect(state().editor?.kind).toBe('empty'))
        const prompt = state().shellFacts
        if (prompt?.kind !== 'prompt' || !state().editor) throw new Error('No empty prompt')
        const repeat = item.mutation({
          kind: 'rerun',
          id,
          actor: { kind: 'user' },
          controlRevision: state().controlRevision,
          blockId: previous.id,
          contentRevision: previous.contentRevision,
          promptRevision: prompt.revision,
          draftRevision: state().editor!.revision
        })
        await Promise.all([item.host.mutate(repeat), item.host.mutate(repeat)])
        await waitForHost(() =>
          expect(state().command).toMatchObject({ id: `repeat:${repeat.operation.id}`, status: 'completed' })
        )
        const after = item.host.listBlocks({ ...ref, cursor: null, expectedIndexRevision: null, limit: 32 })
        expect(after.kind === 'blocks' && after.blocks.length).toBe(list.blocks.length + 1)
        if (shell === 'powershell') {
          const interactive = "[Console]::WriteLine('INTERACTIVE 中文🙂')"
          await item.run({
            kind: 'input',
            id,
            actor: { kind: 'user' },
            controlRevision: state().controlRevision,
            data: `${interactive}\r`
          })
          await waitForHost(() => {
            const blocks = item.host.listBlocks({ ...ref, cursor: null, expectedIndexRevision: null, limit: 32 })
            expect(blocks.kind === 'blocks' && blocks.blocks.at(-1)).toMatchObject({
              command: interactive,
              status: 'completed',
              exitCode: 0
            })
          })
        }
        await item.run({
          kind: 'paste',
          id,
          actor: { kind: 'user' },
          controlRevision: state().controlRevision,
          geometryEpoch: state().geometryEpoch!,
          data: 'unfinished'
        })
        expect(state().editor?.kind).toBe('dirty')
        if (repeat.command.kind !== 'rerun') throw new Error('No repeat command')
        expect(await item.run({ ...repeat.command, controlRevision: state().controlRevision })).toEqual({
          kind: 'rejected',
          reason: 'busy'
        })
      } finally {
        await item.dispose()
      }
    }
  )
})
