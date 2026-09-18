import { caseDefinition } from '../../../scripts/cherry-regression-test/cases'
import { expect, test } from './fixture'

test(...caseDefinition('S-01'), async ({ mainWindow: page }) => {
  await expect(page).toHaveTitle('Cherry Studio')
  await expect(page.locator('#root')).toBeVisible()
  await expect.poll(async () => (await page.locator('body').innerText()).trim().length).toBeGreaterThan(0)
  await expect(page.locator('[data-ui="app.shell"], [data-ui="onboarding.page"], #root > *').first()).toBeVisible()
  await expect(page.getByText(/white screen|renderer process gone|uncaught exception/i)).toHaveCount(0)

  await page.screenshot({ path: test.info().outputPath('startup.png'), fullPage: true })
})
