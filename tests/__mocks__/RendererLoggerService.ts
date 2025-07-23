/* eslint-disable @typescript-eslint/no-empty-function */

// Simple mock LoggerService class for renderer process
export class MockRendererLoggerService {
  private static instance: MockRendererLoggerService

  public static getInstance(): MockRendererLoggerService {
    if (!MockRendererLoggerService.instance) {
      MockRendererLoggerService.instance = new MockRendererLoggerService()
    }
    return MockRendererLoggerService.instance
  }

  public static resetInstance(): void {
    MockRendererLoggerService.instance = new MockRendererLoggerService()
  }

  public initWindowSource(): void {}
  public withContext(): MockRendererLoggerService {
    return this
  }
  public setLevel(): void {}
  public getLevel(): string {
    return 'silly'
  }
  public resetLevel(): void {}
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
export const mockRendererLoggerService = MockRendererLoggerService.getInstance()

// Mock the LoggerService module
const RendererLoggerServiceMock = {
  LoggerService: MockRendererLoggerService,
  loggerService: mockRendererLoggerService
}

export default RendererLoggerServiceMock
