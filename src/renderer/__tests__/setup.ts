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

vi.stubGlobal('window', {
  electron: {
    ipcRenderer: {
      on: vi.fn(), // Mocking ipcRenderer.on
      send: vi.fn() // Mocking ipcRenderer.send
    }
  },
  api: {
    file: {
      read: vi.fn().mockResolvedValue('[]'), // Mock file.read to return an empty array (you can customize this)
      writeWithId: vi.fn().mockResolvedValue(undefined) // Mock file.writeWithId to do nothing
    }
  }
})

vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }), // Mocking axios GET request
    post: vi.fn().mockResolvedValue({ data: {} }) // Mocking axios POST request
    // You can add other axios methods like put, delete etc. as needed
  }
}))

vi.stubGlobal('window', {
  ...global.window, // Copy other global properties
  addEventListener: vi.fn(), // Mock addEventListener
  removeEventListener: vi.fn() // You can also mock removeEventListener if needed
})
