import type { Page } from '@playwright/test'

import { selectSidebarApp } from './helpers'

export async function prepareScenario(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.onboarding.provider_setup.status': 'skipped',
      'app.privacy.data_collection.enabled': false,
      'feature.quick_assistant.enabled': false,
      'feature.selection.enabled': false
    })
  })
  await selectSidebarApp(page, 'Chat')
}
