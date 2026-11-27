import * as fs from 'fs'
import * as path from 'path'

import type { FullConfig } from '@playwright/test'

/**
 * Global setup for Playwright e2e tests.
 * This runs once before all tests.
 */
async function globalSetup(config: FullConfig) {
  console.log('Running global setup...')

  // Create test results directories
  const screenshotsDir = path.join(config.projects[0].outputDir, 'screenshots')

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true })
  }

  // Set environment variables for testing
  process.env.NODE_ENV = 'test'

  console.log('Global setup complete')
}

export default globalSetup
