import '@testing-library/jest-dom/vitest'
import { createRequire } from 'node:module'

import { beforeEach, vi } from 'vitest'

const require = createRequire(import.meta.url)
const bufferModule = require('buffer')
if (!bufferModule.SlowBuffer) {
  bufferModule.SlowBuffer = bufferModule.Buffer
}

// jsdom has no layout engine; tests of resize behavior provide their own observer.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
