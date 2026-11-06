import { expect, type Page } from '@playwright/test'

import { dismissTransientDialogs, selectSidebarApp } from './helpers/navigation'

export async function prepareScenario(page: Page): Promise<void> {
  await dismissTransientDialogs(page)
  await page.evaluate(async () => {
    await window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.onboarding.provider_setup.status': 'skipped',
      'app.privacy.data_collection.enabled': false,
      'topic.tab.show': true,
      'feature.quick_assistant.enabled': false,
      'feature.selection.enabled': false
    })
  })
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  await selectSidebarApp(page, 'Chat')
  const chat = page.locator('[data-ui~="chat.view"]:visible').first()
  // `isVisible()` does not retry: the navbar toggle may not be painted yet right after the view appears,
  // and a missed click leaves the resource list auto-collapsed for the whole case.
  const toggle = chat.getByRole('button', { name: /^(Show|Hide) Sidebar$/ }).first()
  await expect(toggle).toBeVisible({ timeout: 20_000 })
  if ((await toggle.getAttribute('aria-label')) !== 'Hide Sidebar') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-label', 'Hide Sidebar', { timeout: 20_000 })
}
