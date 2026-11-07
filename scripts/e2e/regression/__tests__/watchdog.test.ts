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
  let alive = true
  const kills: WatchdogTarget[] = []
  const deps: WatchdogDeps = {
    readTarget: () => target,
    probe: async () => undefined,
    kill: (killed) => {
      kills.push(killed)
      alive = false
    },
    isAlive: () => alive,
    now: () => clock,
    ...overrides
  }
  const watchdog = new ApplicationWatchdog(deps, { intervalMs: 1_000, stallTimeoutMs: 5_000, exitConfirmMs: 0 })
  return {
    watchdog,
    kills,
    advance: (ms: number) => {
      clock += ms
    },
    die: () => {
      alive = false
    },
    revive: () => {
      alive = true
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
  expect(watchdog.killedApplication).toBe(true)

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
  const { watchdog, kills, advance, die, revive } = harness({ probe: () => Promise.reject(new Error('timeout')) })

  die()
  advance(60_000)
  await watchdog.check()
  expect(kills).toHaveLength(0)
  expect(watchdog.reason).toBeUndefined()

  revive()
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

it('ignores a probe failure that lands after the recorded pids changed', async () => {
  let current = target
  let mode: 'fail' | 'pending' = 'fail'
  let settle: ((error: Error) => void) | undefined
  const { watchdog, kills, advance } = harness({
    readTarget: () => current,
    probe: () => {
      if (mode === 'fail') return Promise.reject(new Error('timeout'))
      return new Promise<void>((_resolve, reject) => {
        settle = reject
      })
    }
  })

  await watchdog.check()
  advance(4_999)
  mode = 'pending'
  const checking = watchdog.check()
  current = { ...target, runnerPid: 43_000, electronPid: 43_001 }
  advance(1_000)
  settle?.(new Error('timeout'))
  await checking
  expect(kills).toHaveLength(0)
  expect(watchdog.reason).toBeUndefined()
})

it('gives a recovered identity a fresh kill budget after its attempts were exhausted', async () => {
  let healthy = false
  let attempts = 0
  const { watchdog, advance, revive } = harness({
    probe: () => (healthy ? Promise.resolve(undefined) : Promise.reject(new Error('timeout'))),
    kill: () => {
      attempts += 1
    }
  })

  for (let round = 0; round < 6; round += 1) {
    advance(5_000)
    await watchdog.check()
  }
  expect(attempts).toBe(5)
  expect(watchdog.reason).toContain('stopped retrying')

  healthy = true
  await watchdog.check()
  healthy = false
  revive()
  advance(5_000)
  await watchdog.check()
  advance(5_000)
  await watchdog.check()
  expect(attempts).toBe(6)
})

it('keeps watching when the Electron process is alive after its process-group leader exited', async () => {
  const { watchdog, kills, advance } = harness({
    probe: () => Promise.reject(new Error('timeout')),
    isAlive: (pid) => pid === target.electronPid
  })

  await watchdog.check()
  advance(5_000)
  await watchdog.check()
  expect(kills).toEqual([target])
})

it('cannot kill the application after it was stopped, even with an accrued stall and a probe in flight', async () => {
  let mode: 'fail' | 'pending' = 'fail'
  let settle: ((error: Error) => void) | undefined
  const { watchdog, kills, advance } = harness({
    probe: () => {
      if (mode === 'fail') return Promise.reject(new Error('timeout'))
      return new Promise<void>((_resolve, reject) => {
        settle = reject
      })
    }
  })

  await watchdog.check()
  advance(4_000)
  await watchdog.check()
  expect(kills).toHaveLength(0)

  mode = 'pending'
  const checking = watchdog.check()
  watchdog.stop()
  advance(1_000)
  settle?.(new Error('timeout'))
  await checking
  expect(kills).toHaveLength(0)
  expect(watchdog.reason).toBeUndefined()
})

it('reports a failed kill instead of claiming success, and retries on the next check', async () => {
  let attempt = 0
  const { watchdog, kills, advance, die } = harness({
    probe: () => Promise.reject(new Error('timeout')),
    kill: (killed) => {
      attempt += 1
      if (attempt === 1) throw new Error('Refusing to terminate stale electron PID')
      kills.push(killed)
      die()
    }
  })

  await watchdog.check()
  advance(5_000)
  await watchdog.check()
  expect(kills).toHaveLength(0)
  expect(watchdog.reason).toContain('killing it failed')
  expect(watchdog.killedApplication).toBe(false)

  advance(5_000)
  await watchdog.check()
  expect(kills).toHaveLength(1)
  expect(watchdog.reason).toContain('killed it')
})

it('does not accept a kill signal that leaves the recorded process alive', async () => {
  let attempts = 0
  const { watchdog, advance } = harness({
    probe: () => Promise.reject(new Error('timeout')),
    kill: () => {
      attempts += 1
    }
  })

  await watchdog.check()
  advance(5_000)
  await watchdog.check()
  expect(attempts).toBe(1)
  expect(watchdog.killedApplication).toBe(false)
  expect(watchdog.reason).toContain('still alive')
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
