import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applicationGetExisting: vi.fn()
}))

vi.mock('@application', () => ({
  application: { getExisting: mocks.applicationGetExisting }
}))

const { prepareClaudeCodeSpawnCapacity } = await import('../claudeCodeSpawnCapacity')

describe('claudeCodeSpawnCapacity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('evicts parked warm queries until the CLI cap allows another spawn', () => {
    let activeCount = 6
    const evictOldestWarmQuery = vi.fn(() => {
      if (activeCount < 6) return false
      activeCount -= 1
      return true
    })
    mocks.applicationGetExisting.mockImplementation((name: string) => {
      if (name === 'ClaudeCodeProcessManager') return { getActiveProcessCount: () => activeCount }
      if (name === 'ClaudeCodeWarmQueryManager') return { evictOldestWarmQuery }
      throw new Error(`unexpected service ${name}`)
    })

    expect(prepareClaudeCodeSpawnCapacity()).toBe(true)
    expect(evictOldestWarmQuery).toHaveBeenCalledOnce()
    expect(activeCount).toBe(5)
  })

  it('refuses another spawn while the cap is saturated and nothing warm remains to evict', () => {
    const evictOldestWarmQuery = vi.fn().mockReturnValue(false)
    mocks.applicationGetExisting.mockImplementation((name: string) => {
      if (name === 'ClaudeCodeProcessManager') return { getActiveProcessCount: () => 6 }
      if (name === 'ClaudeCodeWarmQueryManager') return { evictOldestWarmQuery }
      throw new Error(`unexpected service ${name}`)
    })

    expect(prepareClaudeCodeSpawnCapacity()).toBe(false)
    expect(evictOldestWarmQuery).toHaveBeenCalledOnce()
  })
})
