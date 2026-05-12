/* oxlint-disable @typescript-eslint/no-empty-function */
import { vi } from 'vitest'

/**
 * Unified mock LoggerService for main-process tests.
 *
 * Log methods (`error` / `warn` / `info` / `verbose` / `debug` / `silly`) are
 * `vi.fn()` so tests can assert call shapes directly:
 *
 *     import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
 *     // ...
 *     mockMainLoggerService.warn.mockClear() // in beforeEach
 *     expect(mockMainLoggerService.warn).toHaveBeenCalledWith(...)
 *
 * Per `tests/__mocks__/README.md`, do NOT create ad-hoc `vi.mock('@logger',
 * …)` blocks in individual test files — use this singleton instead so logger
 * assertions stay consistent across the suite.
 *
 * `withContext()` returns the same singleton so any caller of
 * `loggerService.withContext(name).warn(...)` writes into the same vi.fn —
 * tests don't need to know which context was used.
 */
export class MockMainLoggerService {
  private static instance: MockMainLoggerService

  public static getInstance(): MockMainLoggerService {
    if (!MockMainLoggerService.instance) {
      MockMainLoggerService.instance = new MockMainLoggerService()
    }
    return MockMainLoggerService.instance
  }

  public static resetInstance(): void {
    MockMainLoggerService.instance = new MockMainLoggerService()
  }

  public withContext(): MockMainLoggerService {
    return this
  }
  public finish(): void {}
  public setLevel(): void {}
  public getLevel(): string {
    return 'silly'
  }
  public resetLevel(): void {}
  public getLogsDir(): string {
    return '/mock/logs'
  }
  public getBaseLogger(): any {
    return {}
  }

  public error = vi.fn()
  public warn = vi.fn()
  public info = vi.fn()
  public verbose = vi.fn()
  public debug = vi.fn()
  public silly = vi.fn()
}

// Create and export the mock instance
export const mockMainLoggerService = MockMainLoggerService.getInstance()

// Mock the LoggerService module for main process
const MainLoggerServiceMock = {
  LoggerService: MockMainLoggerService,
  loggerService: mockMainLoggerService
}

export default MainLoggerServiceMock
