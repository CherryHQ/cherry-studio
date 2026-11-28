import { expect } from '@playwright/test'

import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'

export default async function feedbackDialog(context: ScenarioContext): Promise<void> {
  const { page } = context
  const originalViewport = page.viewportSize()
  const originalPreferences = await page.evaluate(async () => ({
    'app.language': await window.api.preference.get('app.language'),
    'app.onboarding.provider_setup.status': await window.api.preference.get('app.onboarding.provider_setup.status')
  }))

  try {
    await page.evaluate(() => window.api.preference.set('app.onboarding.provider_setup.status', 'skipped'))
    for (const language of ['zh-CN', 'en-US'] as const) {
      await page.evaluate((language) => window.api.preference.set('app.language', language), language)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.evaluate(() => window.api.ipcApi.request('navigation.open_route_in_main', { path: '/settings/about' }))
      const feedback = page.getByRole('button', { name: language === 'zh-CN' ? '反馈' : 'Feedback', exact: true })

      for (const viewport of [
        { width: 960, height: 700 },
        // 200% zoom at the supported 960×700 and 960×600 window sizes.
        { width: 480, height: 350 },
        { width: 480, height: 300 }
      ]) {
        await page.setViewportSize({ width: 960, height: 700 })
        await feedback.click()
        const dialog = page.getByRole('dialog')
        await context.runSteps([{ verb: 'expectVisible', selector: '[role="dialog"]' }])
        await page.setViewportSize(viewport)
        const close = dialog.getByRole('button', { name: 'Close', exact: true })
        const email = dialog.getByRole('button', { name: /support@cherry-ai.com/ })

        await expect(dialog).toBeInViewport({ ratio: 1 })
        await expect(close).toBeInViewport({ ratio: 1 })
        if (viewport.width === 480) {
          const options = dialog.getByRole('list')
          await options.getByRole('button').first().focus()
          await options.hover()
          await page.mouse.wheel(0, 600)
          await expect.poll(() => options.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
          await expect(email).toBeInViewport({ ratio: 1 })
          await expect(close).toBeInViewport({ ratio: 1 })

          for (let index = 0; index < 3; index++) await page.keyboard.press('Tab')
          await expect(email).toBeFocused()
          await expect(email).toBeInViewport({ ratio: 1 })
          await page.keyboard.press('Tab')
          await expect(close).toBeFocused()
          await expect(close).toBeInViewport({ ratio: 1 })
          await context.screenshot(`feedback-${language.toLowerCase()}-${viewport.height}`)
        } else {
          await expect(email).toBeInViewport({ ratio: 1 })
        }
        await close.click()
        await expect(dialog).toHaveCount(0)
      }
    }
  } finally {
    if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape')
    if (originalViewport) await page.setViewportSize(originalViewport)
    else {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.clearDeviceMetricsOverride')
      await cdp.detach()
    }
    await page.evaluate((preferences) => window.api.preference.setMultiple(preferences), originalPreferences)
    await page.reload({ waitUntil: 'domcontentloaded' })
  }
}
