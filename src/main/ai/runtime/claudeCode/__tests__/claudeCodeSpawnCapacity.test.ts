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
  preflightReservations = { value: 0 }
) {
  mocks.applicationGetExisting.mockImplementation((name: string) => {
    if (name === 'ClaudeCodeProcessManager') {
      const getActiveProcessCount = () => counts.active + preflightReservations.value
      return {
        getActiveProcessCount,
        getCapSlotProcessCount: () => counts.capSlots,
        tryReserveLiveSpawnPreflight: () => {
          if (getActiveProcessCount() >= 6) return false
          preflightReservations.value++
          return true
        },
        waitForActiveProcessBelowCap: vi.fn(async () => undefined)
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
})
