import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applicationGetExisting: vi.fn()
}))

vi.mock('@application', () => ({
  application: { getExisting: mocks.applicationGetExisting }
}))

const { ensureClaudeCodeSpawnCapacity, prepareClaudeCodeSpawnCapacity } = await import('../claudeCodeSpawnCapacity')

type ManagerCounts = { active: number; capSlots: number }

function mockManagers(
  counts: ManagerCounts,
  evictOldestWarmQuery = vi.fn(() => false),
  preflightReservations = { value: 0 },
  waitForActiveProcessBelowCap: (max: number, timeoutMs: number) => Promise<void> = vi.fn(async () => undefined)
) {
  mocks.applicationGetExisting.mockImplementation((name: string) => {
    if (name === 'ClaudeCodeProcessManager') {
      const getActiveProcessCount = () => counts.active + preflightReservations.value
      return {
        getActiveProcessCount,
        getCapSlotProcessCount: () => counts.capSlots + preflightReservations.value,
        tryReserveLiveSpawnPreflight: () => {
          if (getActiveProcessCount() >= 6) return false
          preflightReservations.value++
          return true
        },
        releaseLiveSpawnPreflight: () => {
          preflightReservations.value = Math.max(0, preflightReservations.value - 1)
        },
        waitForActiveProcessBelowCap
      }
    }
    if (name === 'ClaudeCodeWarmQueryManager') return { evictOldestWarmQuery }
    throw new Error(`unexpected service ${name}`)
  })
  return evictOldestWarmQuery
}

describe('claudeCodeSpawnCapacity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('evicts a parked warm query but refuses a live spawn until the evicted child exits', () => {
    const counts: ManagerCounts = { active: 6, capSlots: 6 }
    const evictOldestWarmQuery = vi.fn(() => {
      if (counts.capSlots === 0) return false
      counts.capSlots -= 1
      return true
    })
    mockManagers(counts, evictOldestWarmQuery)

    expect(prepareClaudeCodeSpawnCapacity('live')).toBe(false)
    expect(evictOldestWarmQuery).toHaveBeenCalledOnce()
    expect(counts.capSlots).toBe(5)
    expect(counts.active).toBe(6)

    counts.active = 5
    expect(prepareClaudeCodeSpawnCapacity('live')).toBe(true)
  })

  it('admits a live spawn when the active count is under the cap', () => {
    const evictOldestWarmQuery = mockManagers({ active: 5, capSlots: 5 })

    expect(prepareClaudeCodeSpawnCapacity('live')).toBe(true)
    expect(evictOldestWarmQuery).not.toHaveBeenCalled()
  })

  it('refuses a live spawn when every cap slot is held by children that cannot be evicted', () => {
    const evictOldestWarmQuery = mockManagers({ active: 6, capSlots: 6 })

    expect(prepareClaudeCodeSpawnCapacity('live')).toBe(false)
    expect(evictOldestWarmQuery).toHaveBeenCalledOnce()
  })

  it('refuses a new warm park while an evicted child keeps the active count at the cap', () => {
    const evictOldestWarmQuery = mockManagers({ active: 6, capSlots: 5 })

    expect(prepareClaudeCodeSpawnCapacity('warm')).toBe(false)
    expect(evictOldestWarmQuery).not.toHaveBeenCalled()
  })

  it('admits a warm park while the active count is under the cap', () => {
    const evictOldestWarmQuery = mockManagers({ active: 5, capSlots: 5 })

    expect(prepareClaudeCodeSpawnCapacity('warm')).toBe(true)
    expect(evictOldestWarmQuery).not.toHaveBeenCalled()
  })

  it('evicts a parked warm query when a live preflight occupies the last cap slot', () => {
    const counts: ManagerCounts = { active: 6, capSlots: 5 }
    const preflightReservations = { value: 1 }
    const evictOldestWarmQuery = vi.fn(() => {
      counts.capSlots -= 1
      return true
    })
    mockManagers(counts, evictOldestWarmQuery, preflightReservations)

    expect(prepareClaudeCodeSpawnCapacity('live')).toBe(false)
    expect(evictOldestWarmQuery).toHaveBeenCalledOnce()
  })

  it('reserves a live preflight slot when ensure admits a cold start', async () => {
    const preflightReservations = { value: 0 }
    mockManagers(
      { active: 5, capSlots: 5 },
      vi.fn(() => false),
      preflightReservations
    )

    expect(await ensureClaudeCodeSpawnCapacity('live')).toBe(true)
    expect(preflightReservations.value).toBe(1)
  })

  it('re-evicts while waiting when a competing cold start takes the slot an eviction freed', async () => {
    vi.useFakeTimers()
    try {
      // Six CLI children (five parked warm + one live) fill the cap.
      const counts: ManagerCounts = { active: 6, capSlots: 6 }
      const preflightReservations = { value: 0 }
      let evictions = 0
      const evictOldestWarmQuery = vi.fn(() => {
        if (counts.capSlots === 0) return false
        counts.capSlots -= 1
        const first = evictions++ === 0
        setTimeout(() => {
          counts.active -= 1
          // Another waiter reserves the freed slot before this waiter's poll observes it.
          if (first) {
            preflightReservations.value += 1
          }
        }, 100)
        return true
      })
      const activeCount = () => counts.active + preflightReservations.value
      const waitBelowCap = (max: number, timeoutMs: number) =>
        new Promise<void>((resolve) => {
          const start = Date.now()
          const tick = () => {
            if (activeCount() < max || Date.now() - start >= timeoutMs) resolve()
            else setTimeout(tick, 50)
          }
          tick()
        })
      mockManagers(counts, evictOldestWarmQuery, preflightReservations, waitBelowCap)

      let admitted: boolean | undefined
      void ensureClaudeCodeSpawnCapacity('live').then((result) => {
        admitted = result
      })
      // Far below the 30 s deadline: the waiter must not idle until it expires.
      await vi.advanceTimersByTimeAsync(2_000)

      expect(admitted).toBe(true)
      expect(evictOldestWarmQuery).toHaveBeenCalledTimes(2)
      // Four children plus the competitor's and this waiter's reservations: cap never exceeded.
      expect(activeCount()).toBe(6)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops waiting without admitting when the connection attempt is cancelled at a full cap', async () => {
    const counts: ManagerCounts = { active: 6, capSlots: 6 }
    const reservations = { value: 0 }
    const controller = new AbortController()
    let waits = 0
    mockManagers(
      counts,
      vi.fn(() => false),
      reservations,
      async () => {
        waits++
        if (waits === 2) controller.abort('closed')
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
    )

    const startedAt = Date.now()
    await expect(ensureClaudeCodeSpawnCapacity('live', controller.signal)).resolves.toBe(false)
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(waits).toBe(2)
    expect(reservations.value).toBe(0)
  })

  it('releases a reservation acquired while the attempt was being cancelled', async () => {
    const counts: ManagerCounts = { active: 6, capSlots: 6 }
    const reservations = { value: 0 }
    const controller = new AbortController()
    mockManagers(
      counts,
      vi.fn(() => false),
      reservations,
      async () => {
        counts.active = 5
        counts.capSlots = 5
        await Promise.resolve()
      }
    )
    const reserve = vi.fn()
    const original = mocks.applicationGetExisting.getMockImplementation()!
    mocks.applicationGetExisting.mockImplementation((name: string) => {
      const service = original(name)
      if (name !== 'ClaudeCodeProcessManager') return service
      return {
        ...service,
        tryReserveLiveSpawnPreflight: () => {
          reserve()
          const reserved = service.tryReserveLiveSpawnPreflight()
          // The session closes in the same tick the freed slot is reserved.
          if (reserved) controller.abort('closed')
          return reserved
        }
      }
    })

    await expect(ensureClaudeCodeSpawnCapacity('live', controller.signal)).resolves.toBe(false)
    expect(reserve).toHaveBeenCalled()
    expect(reservations.value).toBe(0)
  })

  it('refuses immediately for an already-cancelled attempt', async () => {
    const reservations = { value: 0 }
    mockManagers(
      { active: 0, capSlots: 0 },
      vi.fn(() => false),
      reservations
    )
    const controller = new AbortController()
    controller.abort('closed')

    await expect(ensureClaudeCodeSpawnCapacity('live', controller.signal)).resolves.toBe(false)
    expect(reservations.value).toBe(0)
  })
})
