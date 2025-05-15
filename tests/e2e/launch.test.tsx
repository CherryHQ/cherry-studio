import { _electron as electron, expect, test } from '@playwright/test'

let electronApp: any
let window: any

test.describe('App Launch', () => {
  test('should launch and close the main application', async () => {
    electronApp = await electron.launch({ args: ['.'] })
    window = await electronApp.firstWindow()
    expect(window).toBeDefined()
    await electronApp.close()
  })
})
