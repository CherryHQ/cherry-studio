/**
 * Global teardown for Playwright e2e tests.
 * This runs once after all tests complete.
 */
async function globalTeardown() {
  console.log('Running global teardown...')

  // Cleanup tasks can be added here:
  // - Kill orphaned Electron processes
  // - Clean up temporary test data
  // - Reset test databases

  console.log('Global teardown complete')
}

export default globalTeardown
