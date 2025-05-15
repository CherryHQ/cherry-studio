import '@testing-library/jest-dom/vitest'

import { styleSheetSerializer } from 'jest-styled-components/serializer'
import { expect, vi } from 'vitest'

expect.addSnapshotSerializer(styleSheetSerializer)

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
