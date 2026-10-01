import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applicationGetExisting: vi.fn()
}))

vi.mock('@application', () => ({
  application: { getExisting: mocks.applicationGetExisting }
}))

const { prepareClaudeCodeSpawnCapacity } = await import('../claudeCodeSpawnCapacity')

type ManagerCounts = { active: number; capSlots: number }

function mockManagers(counts: ManagerCounts, evictOldestWarmQuery = vi.fn(() => false)) {
  mocks.applicationGetExisting.mockImplementation((name: string) => {
    if (name === 'ClaudeCodeProcessManager') {
      return {
        getActiveProcessCount: () => counts.active,
        getCapSlotProcessCount: () => counts.capSlots
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

  it('evicts a parked warm query so a live spawn can reuse the freed cap slot while evicted children still count as active', () => {
    const counts: ManagerCounts = { active: 6, capSlots: 6 }
    const evictOldestWarmQuery = vi.fn(() => {
      if (counts.capSlots === 0) return false
      counts.capSlots -= 1
      return true
    })
    mockManagers(counts, evictOldestWarmQuery)

    expect(prepareClaudeCodeSpawnCapacity('live')).toBe(true)
    expect(evictOldestWarmQuery).toHaveBeenCalledOnce()
    expect(counts.capSlots).toBe(5)
    expect(counts.active).toBe(6)
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
})
