import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { terminalResourceId, type TerminalCleanup, type TerminalLaunch } from '../../contracts'
import { ManagedProcess } from '../ManagedProcess'

const root = process.cwd()
const helperFile = path.join(
  root,
  'resources/binaries',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'terminal-scope.exe' : 'terminal-scope'
)
const launch = (script: string): Extract<TerminalLaunch, { kind: 'pipe' }> => ({
  kind: 'pipe',
  shell: 'bash',
  file: '/bin/bash',
  args: ['--noprofile', '--norc', '-c', script],
  cwd: root,
  env: { PATH: '/usr/bin:/bin' },
  stdin: ''
})

function resource(spec: TerminalLaunch) {
  const output: Buffer[] = []
  const exited = Promise.withResolvers<{ exitCode: number | null; signal: number | null }>()
  const closed = Promise.withResolvers<TerminalCleanup>()
  const faults: Error[] = []
  const process = new ManagedProcess({
    id: terminalResourceId.parse(randomUUID()),
    helperFile,
    launch: spec,
    onOutput: (data) => output.push(Buffer.from(data)),
    onExit: (exitCode, signal) => exited.resolve({ exitCode, signal }),
    onClosed: closed.resolve,
    onFault: (error) => faults.push(error)
  })
  return {
    process,
    exited: exited.promise,
    closed: closed.promise,
    output: () => Buffer.concat(output).toString(),
    faults
  }
}

describe.skipIf(process.platform === 'win32')('ManagedProcess real POSIX scopes', () => {
  beforeAll(() => execFileSync('node', ['native/terminal-scope/build.cjs'], { cwd: root }))

  it('captures both pipes, supplies EOF, and preserves a nonzero root status', async () => {
    const item = resource({
      ...launch('read value; printf "out:%s" "$value"; printf err >&2; exit 17'),
      stdin: 'input\n'
    })
    await item.process.start()
    expect(await item.exited).toEqual({ exitCode: 17, signal: null })
    expect(await item.closed).toBe('confirmed')
    expect(item.output()).toContain('out:input')
    expect(item.output()).toContain('err')
    expect(item.faults).toEqual([])
  })

  it('terminates descendants in one scope while a sibling remains usable', async () => {
    const first = resource(launch('sleep 60 & wait'))
    const sibling = resource(launch('sleep 0.3; printf SIBLING_ALIVE'))
    await first.process.start()
    await sibling.process.start()
    expect(await first.process.close()).toBe('confirmed')
    expect(await sibling.closed).toBe('confirmed')
    expect(sibling.output()).toBe('SIBLING_ALIVE')
    expect((await first.exited).signal).toBe(15)
  })

  it('supports a persistent PTY and acknowledges input writes', async () => {
    const item = resource({
      kind: 'pty',
      shell: 'bash',
      file: '/bin/bash',
      args: ['--noprofile', '--norc', '-i'],
      cwd: root,
      env: { PATH: '/usr/bin:/bin', PS1: '' },
      cols: 80,
      rows: 24
    })
    try {
      await item.process.start()
      await item.process.write('printf "PTY_%s\\n" "READY"\n')
      await expect.poll(item.output).toContain('PTY_READY')
      await item.process.write('cd /; TOKEN=persistent; fn(){ printf "STATE_%s\\n" "$TOKEN"; }\n')
      await item.process.write('fn; pwd\n')
      await expect.poll(item.output).toContain('STATE_persistent')
      await item.process.write('exit 9\n')
      expect(await item.exited).toEqual({ exitCode: 9, signal: null })
      expect(await item.closed).toBe('confirmed')
      await expect(item.process.write('late')).rejects.toThrow('not writable')
    } finally {
      await item.process.close()
    }
  })

  it('cancels before startup without launching the command', async () => {
    const item = resource(launch('printf SHOULD_NOT_RUN'))
    const starting = item.process.start()
    const closing = item.process.close()
    await expect(starting).rejects.toThrow('closing')
    expect(await closing).toBe('confirmed')
    expect(item.output()).toBe('')
  })
})
