import { vi } from 'vitest'

vi.mock('electron-log/renderer', () => {
  return {
    default: {
      info: console.log,
      error: console.error,
      warn: console.warn,
      debug: console.debug,
      verbose: console.log,
      silly: console.log,
      log: console.log,
      transports: {
        console: {
          level: 'info'
        }
      }
    }
  }
})
