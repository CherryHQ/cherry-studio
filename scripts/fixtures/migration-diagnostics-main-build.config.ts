import { defineConfig } from 'electron-vite'

import electronViteConfig from '../../electron.vite.config'

if (electronViteConfig.main === undefined) {
  throw new Error('Migration diagnostics build smoke requires the production main config')
}

export default defineConfig({ main: electronViteConfig.main })
