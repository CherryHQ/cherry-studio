import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applicationGet: vi.fn()
}))

vi.mock('@application', () => ({
  application: { getOptional: mocks.applicationGet }
}))

const { prepareClaudeCodeSpawnCapacity } = await import('../claudeCodeSpawnCapacity')

describe('claudeCodeSpawnCapacity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('evicts parked warm queries until the CLI cap allows another spawn', () => {
    const evictOldestWarmQuery = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'ClaudeCodeProcessManager') return { getActiveProcessCount: () => 6 }
      if (name === 'ClaudeCodeWarmQueryManager') return { evictOldestWarmQuery }
      throw new Error(`unexpected service ${name}`)
    })

    prepareClaudeCodeSpawnCapacity()

    expect(evictOldestWarmQuery).toHaveBeenCalledTimes(2)
  })
})
