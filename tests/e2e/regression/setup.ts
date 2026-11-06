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
  const topics = chat.locator('[data-ui~="chat.topic-list"]:visible').first()
  const toggle = chat.getByRole('button', { name: /^(Show|Hide) Sidebar$/ }).first()
  await expect(topics.or(toggle).first()).toBeVisible({ timeout: 20_000 })
  if (!(await topics.isVisible())) await toggle.click()
  await expect(topics).toBeVisible({ timeout: 20_000 })
}
