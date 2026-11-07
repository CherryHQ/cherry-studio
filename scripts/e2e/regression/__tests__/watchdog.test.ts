import { ApplicationWatchdog, type WatchdogDeps, type WatchdogTarget } from '../watchdog'

const target: WatchdogTarget = {
  mode: 'branch',
  platform: 'macos',
  runnerPid: 42000,
  electronPid: 42001,
  cdpPort: 9222,
  targetRoot: '/tmp/regression-target'
}

function harness(overrides: Partial<WatchdogDeps> = {}) {
  let clock = 1_000
  const kills: WatchdogTarget[] = []
  const deps: WatchdogDeps = {
    readTarget: () => target,
    probe: async () => undefined,
    kill: (killed) => kills.push(killed),
    isAlive: () => true,
    now: () => clock,
    ...overrides
  }
  const watchdog = new ApplicationWatchdog(deps, { intervalMs: 1_000, stallTimeoutMs: 5_000 })
  return {
    watchdog,
    kills,
    advance: (ms: number) => {
      clock += ms
    }
  }
}

it('kills a live application whose CDP endpoint stops answering once the stall window elapses', async () => {
  const { watchdog, kills, advance } = harness({ probe: () => Promise.reject(new Error('timeout')) })

  await watchdog.check()
  advance(4_999)
  await watchdog.check()
  expect(kills).toHaveLength(0)
  expect(watchdog.reason).toBeUndefined()

  advance(1)
  await watchdog.check()
  expect(kills).toEqual([target])
  expect(watchdog.reason).toContain('unresponsive')

  advance(60_000)
  await watchdog.check()
  expect(kills).toHaveLength(1)
})

it('restarts the stall window when a probe recovers', async () => {
  let healthy = false
  const { watchdog, kills, advance } = harness({
    probe: () => (healthy ? Promise.resolve(undefined) : Promise.reject(new Error('timeout')))
  })

  await watchdog.check()
  advance(4_000)
  await watchdog.check()
  healthy = true
  advance(4_000)
  await watchdog.check()
  expect(kills).toHaveLength(0)

  healthy = false
  await watchdog.check()
  advance(4_999)
  await watchdog.check()
  expect(kills).toHaveLength(0)
  advance(1)
  await watchdog.check()
  expect(kills).toHaveLength(1)
})

it('ignores an application that exited on purpose, and starts a fresh window when it comes back', async () => {
  let alive = false
  const { watchdog, kills, advance } = harness({
    isAlive: () => alive,
    probe: () => Promise.reject(new Error('timeout'))
  })

  advance(60_000)
  await watchdog.check()
  expect(kills).toHaveLength(0)
  expect(watchdog.reason).toBeUndefined()

  alive = true
  await watchdog.check()
  advance(4_999)
  await watchdog.check()
  expect(kills).toHaveLength(0)
  advance(1)
  await watchdog.check()
  expect(kills).toHaveLength(1)
})

it('does not carry the stall window across a restart that replaces the recorded pids', async () => {
  let current = target
  const { watchdog, kills, advance } = harness({
    readTarget: () => current,
    probe: () => Promise.reject(new Error('timeout'))
  })

  await watchdog.check()
  advance(4_000)
  await watchdog.check()
  expect(kills).toHaveLength(0)

  current = { ...target, runnerPid: 43000, electronPid: 43001 }
  await watchdog.check()
  advance(4_999)
  await watchdog.check()
  expect(kills).toHaveLength(0)
  advance(1)
  await watchdog.check()
  expect(kills).toEqual([current])
})

it('cannot kill the application after it was stopped, even with a probe still in flight', async () => {
  let settle: (() => void) | undefined
  const { watchdog, kills } = harness({
    probe: () =>
      new Promise<void>((_resolve, reject) => {
        settle = () => reject(new Error('timeout'))
      })
  })

  const checking = watchdog.check()
  watchdog.stop()
  settle?.()
  await checking
  expect(kills).toHaveLength(0)
  expect(watchdog.reason).toBeUndefined()
})

it('reports a failed kill instead of claiming success, and retries on the next check', async () => {
  let attempt = 0
  const { watchdog, kills, advance } = harness({
    probe: () => Promise.reject(new Error('timeout')),
    kill: (killed) => {
      attempt += 1
      if (attempt === 1) throw new Error('Refusing to terminate stale electron PID')
      kills.push(killed)
    }
  })

  await watchdog.check()
  advance(5_000)
  await watchdog.check()
  expect(kills).toHaveLength(0)
  expect(watchdog.reason).toContain('killing it failed')

  advance(5_000)
  await watchdog.check()
  expect(kills).toHaveLength(1)
  expect(watchdog.reason).toContain('killed it')
})

it('does nothing when the watchdog is disabled', async () => {
  const kills: WatchdogTarget[] = []
  const watchdog = new ApplicationWatchdog(
    {
      readTarget: () => target,
      probe: () => Promise.reject(new Error('timeout')),
      kill: (killed) => kills.push(killed),
      isAlive: () => true,
      now: () => 1_000
    },
    { stallTimeoutMs: 0 }
  )
  watchdog.start()
  await watchdog.check()
  watchdog.stop()
  expect(kills).toHaveLength(0)
})
