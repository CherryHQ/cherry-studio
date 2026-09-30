import { vi } from 'vitest'

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync }))

import { terminateOwnedMacProcessGroup, waitForMacProcessGroupExit } from '../process'

const owner = {
  mode: 'branch' as const,
  platform: 'macos' as const,
  runnerPid: 42000,
  targetRoot: '/tmp/regression-target',
  cdpPort: 9222
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  execFileSync.mockReset()
})

it('treats only zombies as exited, but still waits for live members of the owned group', async () => {
  execFileSync.mockReturnValue('42000 Z\n99000 S')
  await expect(waitForMacProcessGroupExit(42000, 0)).resolves.toBe(true)
  execFileSync.mockReturnValue('42000 Z\n42000 S\n99000 S')
  await expect(waitForMacProcessGroupExit(42000, 0)).resolves.toBe(false)
})

it('rechecks ownership before escalating to SIGKILL', () => {
  execFileSync.mockReturnValue('42001 42000 unrelated-app')
  const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (signal === 0) throw new Error('ESRCH')
    return true
  })
  expect(() => terminateOwnedMacProcessGroup(owner, 'SIGKILL')).toThrow('Refusing cleanup')
  expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true)
})

it.each([true, false])(
  'terminates owned descendants without touching another process group (runner alive: %s)',
  (runnerAlive) => {
    const alive = new Set([42001, 99000, ...(runnerAlive ? [42000] : [])])
    execFileSync.mockImplementation((_file, args) =>
      args.includes('-axo')
        ? `${runnerAlive ? '42000 42000 pnpm debug\n' : ''}42001 42000 electron /tmp/regression-target\n99000 99000 TextEdit`
        : 'pnpm debug'
    )
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 'SIGTERM' && pid === -42000) {
        alive.delete(42000)
        alive.delete(42001)
        return true
      }
      if (!alive.has(pid)) throw new Error('ESRCH')
      return true
    })
    terminateOwnedMacProcessGroup(owner)
    expect([...alive]).toEqual([99000])
  }
)

it.each([
  ['42001 42000 unrelated-app', false],
  ['42000 99000 pnpm debug\n42001 42000 electron /tmp/regression-target', true]
] as const)('refuses an unowned or reused group: %s', (processes, runnerAlive) => {
  execFileSync.mockReturnValue(processes)
  const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (signal !== 0) throw new Error('Must not terminate an unverified group')
    if (!runnerAlive) throw new Error('ESRCH')
    return true
  })
  expect(() => terminateOwnedMacProcessGroup(owner)).toThrow('Refusing cleanup')
  expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true)
})
