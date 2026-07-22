import { describe, expect, it, vi } from 'vitest'

const createLoggerMock = vi.hoisted(() =>
  vi.fn(() => ({
    log: vi.fn(),
    level: 'info',
    on: vi.fn(),
    end: vi.fn()
  }))
)

vi.unmock('@logger')
vi.mock('winston', () => {
  const mock = {
    createLogger: createLoggerMock,
    format: {
      combine: vi.fn(),
      timestamp: vi.fn(),
      errors: vi.fn(),
      json: vi.fn()
    }
  }
  return { ...mock, default: mock }
})
vi.mock('winston-daily-rotate-file', () => ({
  default: vi.fn(() => ({ on: vi.fn(), log: vi.fn() }))
}))

import { LoggerService } from '../LoggerService'

describe('LoggerService process identity', () => {
  it('keeps a stable identity and writes the process id through Winston defaultMeta', () => {
    const logger = new LoggerService()

    try {
      const identity = logger.getProcessIdentity()

      expect(identity).toEqual({
        processId: process.pid,
        processStartedAt: expect.any(String)
      })
      expect(Number.isNaN(Date.parse(identity.processStartedAt))).toBe(false)
      expect(logger.getProcessIdentity()).toBe(identity)
      expect(logger.withContext('test').getProcessIdentity()).toBe(identity)
      expect((createLoggerMock.mock.calls.at(-1) as unknown[] | undefined)?.[0]).toMatchObject({
        defaultMeta: { processId: process.pid }
      })
    } finally {
      logger.finish()
    }
  })
})
