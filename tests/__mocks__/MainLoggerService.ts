/* eslint-disable @typescript-eslint/no-empty-function */

// Simple mock LoggerService class for main process
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
  public error(...args: any[]): void {
    console.error(...args)
  }
  public warn(...args: any[]): void {
    console.warn(...args)
  }
  public info(...args: any[]): void {
    console.info(...args)
  }
  public verbose(...args: any[]): void {
    console.log(...args)
  }
  public debug(...args: any[]): void {
    console.debug(...args)
  }
  public silly(...args: any[]): void {
    console.log(...args)
  }
}

// Create and export the mock instance
export const mockMainLoggerService = MockMainLoggerService.getInstance()

// Mock the LoggerService module for main process
const MainLoggerServiceMock = {
  LoggerService: MockMainLoggerService,
  loggerService: mockMainLoggerService
}

export default MainLoggerServiceMock
