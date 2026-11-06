import { vi } from 'vitest'

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync }))

import { assertOwnedProcess, terminateOwnedMacProcessGroup, waitForMacProcessGroupExit } from '../process'

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

it.each([false, true])('leaves an already exited zombie-only group alone (runner retained: %s)', (runnerRetained) => {
  execFileSync.mockReturnValue(`${runnerRetained ? '42000 42000 Z <defunct>\n' : ''}42001 42000 Z <defunct>`)
  const signals: Array<[number, unknown]> = []
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (signal === 0) {
      if (pid === 42000 && !runnerRetained) throw new Error('ESRCH')
      return true
    }
    signals.push([pid, signal])
    return true
  })
  expect(() => terminateOwnedMacProcessGroup(owner)).not.toThrow()
  expect(signals).toEqual([])
})

it('rechecks ownership before escalating to SIGKILL', () => {
  execFileSync.mockReturnValue('42001 42000 S unrelated-app')
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
        ? `${runnerAlive ? '42000 42000 S node /tmp/regression-target/node_modules/dotenv-cli/cli.js\n' : ''}42001 42000 S electron /tmp/regression-target\n99000 99000 S TextEdit`
        : 'node /tmp/regression-target/node_modules/dotenv-cli/cli.js'
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
  ['42001 42000 S unrelated-app', false],
  [
    '42000 99000 S node /tmp/regression-target/node_modules/dotenv-cli/cli.js\n42001 42000 S electron /tmp/regression-target',
    true
  ]
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

it('checks the exact signed development executable and its CDP ownership', () => {
  const executablePath = '/tmp/owned-run/installed/signed-runtime/Electron.app/Contents/MacOS/Electron'
  const signedOwner = { ...owner, executablePath }
  let command = `${executablePath} . --remote-debugging-port=9222`
  let listener = '42001'
  execFileSync.mockImplementation((file: string) => (file === 'ps' ? command : listener))
  expect(() => assertOwnedProcess(signedOwner, 42001, 'electron')).not.toThrow()
  command = '/tmp/foreign-run/Electron.app/Contents/MacOS/Electron .'
  expect(() => assertOwnedProcess(signedOwner, 42001, 'electron')).toThrow('command no longer matches')
  command = `${executablePath} .`
  listener = '99000'
  expect(() => assertOwnedProcess(signedOwner, 42001, 'electron')).toThrow('no longer owns CDP')
})

it('cleans only the isolated signed runtime helpers after their development runner has exited', () => {
  const executablePath = '/tmp/owned-run/installed/signed-runtime/Electron.app/Contents/MacOS/Electron'
  const signedOwner = { ...owner, executablePath }
  const helpers = new Set([42001, 99000])
  execFileSync.mockReturnValue(
    '42001 42000 S /tmp/owned-run/installed/signed-runtime/Electron.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper\n99000 99000 S /Applications/Other.app/Contents/MacOS/Other'
  )
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (signal === 0) {
      if (!helpers.has(pid)) throw new Error('ESRCH')
      return true
    }
    if (pid === -42000) helpers.delete(42001)
    return true
  })
  terminateOwnedMacProcessGroup(signedOwner)
  expect([...helpers]).toEqual([99000])
  execFileSync.mockReturnValue('99000 42000 S /Applications/Other.app/Contents/MacOS/Other')
  expect(() => terminateOwnedMacProcessGroup(signedOwner)).toThrow('Refusing cleanup')
  expect([...helpers]).toEqual([99000])
})

it('refuses a runner launched from a different checkout even when it also uses dotenv', () => {
  execFileSync.mockReturnValue('node /tmp/other-checkout/node_modules/dotenv-cli/cli.js')
  expect(() => assertOwnedProcess(owner, owner.runnerPid, 'runner')).toThrow('Refusing to terminate stale runner')
})

it('takes the CDP and inspector ports from the environment when given', async () => {
  vi.resetModules()
  process.env.CHERRY_CDP_PORT = '19333'
  process.env.CHERRY_INSPECTOR_PORT = '19334'
  try {
    const mod = await import('../process')
    expect(mod.CDP_PORT).toBe(19333)
    expect(mod.MAIN_INSPECTOR_PORT).toBe(19334)
  } finally {
    delete process.env.CHERRY_CDP_PORT
    delete process.env.CHERRY_INSPECTOR_PORT
    vi.resetModules()
  }
})

it('falls back to the default ports when the environment value is not a usable port', async () => {
  vi.resetModules()
  process.env.CHERRY_CDP_PORT = 'not-a-port'
  process.env.CHERRY_INSPECTOR_PORT = '0'
  try {
    const mod = await import('../process')
    expect(mod.CDP_PORT).toBe(9222)
    expect(mod.MAIN_INSPECTOR_PORT).toBe(9229)
  } finally {
    delete process.env.CHERRY_CDP_PORT
    delete process.env.CHERRY_INSPECTOR_PORT
    vi.resetModules()
  }
})
