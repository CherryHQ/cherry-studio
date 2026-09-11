import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { ensureCustomChatProvider, selectVisibleModel } from './models'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'
import { closeSettings } from './settings'

export function customAssistantName(app: RegressionApp): string {
  return app.resourceName('Cherry Regression Assistant 31415')
}

export async function ensureCustomAssistant(app: RegressionApp, page: Page): Promise<void> {
  const name = customAssistantName(app)
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  await selectSidebarApp(page, 'Chat')
  const chatView = page.locator('[data-ui="chat.view"]:visible').first()
  const assistant = chatView.getByText(name, { exact: true }).first()

  if (!(await assistant.isVisible().catch(() => false))) {
    await chatView.getByRole('button', { name: 'Add Assistant', exact: true }).click({ noWaitAfter: true })
    await page.getByRole('option', { name: 'New Assistant', exact: true }).click()
    await page.getByPlaceholder('Enter a name', { exact: true }).fill(name)
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Cherry Regression Test Assistant')
    await page.locator('[aria-label="Choose avatar"]').click()
    await page.locator('button[aria-label="star-struck"]').first().click()
    await page.locator('[aria-label="Model"]').click()
    await selectVisibleModel(page, app.config.customProvider.chatModel)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page
      .getByRole('dialog')
      .locator('.cm-content[contenteditable="true"]')
      .fill('You must always include the exact phrase ASSISTANT_PROMPT_PASS in every response.')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByRole('button', { name: 'Create', exact: true }).click()
  } else {
    await assistant.click({ noWaitAfter: true })
  }

  await expect(assistant).toBeVisible()
}
