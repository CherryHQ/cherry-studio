import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'

vi.unmock('@logger')

import { LoggerService } from '../LoggerService'

describe('LoggerService file logging initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defers file transports, binds Electron logs to userData, and replays preboot records', () => {
    const service = new LoggerService()
    const logger = vi.mocked(winston.createLogger).mock.results[0].value

    service.withContext('Preboot').info('preboot message')

    expect(DailyRotateFile).not.toHaveBeenCalled()
    expect(logger.log).toHaveBeenCalledTimes(1)

    service.initializeFileLogging('/custom/userData/logs')

    expect(app.setAppLogsPath).toHaveBeenCalledWith('/custom/userData/logs')
    expect(DailyRotateFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ filename: '/custom/userData/logs/app.%DATE%.log' })
    )
    expect(DailyRotateFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ filename: '/custom/userData/logs/app-error.%DATE%.log', level: 'warn' })
    )
    expect(logger.configure).toHaveBeenCalledOnce()
    expect(logger.log).toHaveBeenCalledTimes(2)
    expect(service.getLogsDir()).toBe('/custom/userData/logs')
  })

  it('does not replace active file transports on repeated initialization', () => {
    const service = new LoggerService()

    service.initializeFileLogging('/custom/userData/logs')
    service.initializeFileLogging('/other/logs')

    expect(app.setAppLogsPath).toHaveBeenCalledOnce()
    expect(DailyRotateFile).toHaveBeenCalledTimes(2)
    expect(service.getLogsDir()).toBe('/custom/userData/logs')
  })
})
