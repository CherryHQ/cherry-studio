import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

// Serve the built package and test harness without the library build's declaration/output hooks.
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: { dedupe: ['react', 'react-dom'] },
  // The harness imports dynamically; prebundle its CJS peers before the first page can be reloaded.
  optimizeDeps: {
    noDiscovery: true,
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'zod']
  }
})
