import type { Page } from '@playwright/test'

import type { RegressionApp } from './app'
import { expect } from './fixture'
import { selectSidebarApp } from './helpers'
import { closeSettings, ensureCustomChatProvider } from './models'

export const CUSTOM_ASSISTANT = 'Cherry Regression Assistant 31415'

export async function ensureCustomAssistant(app: RegressionApp, page: Page): Promise<void> {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  await selectSidebarApp(page, 'Chat')

  if (
    !(await page
      .getByText(CUSTOM_ASSISTANT, { exact: true })
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole('button', { name: 'Add Assistant', exact: true }).click()
    await page.getByRole('option', { name: 'New Assistant', exact: true }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(CUSTOM_ASSISTANT)
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Cherry Regression Test Assistant')
    await page.locator('[aria-label="Choose avatar"]').click()
    await page.locator('button[aria-label="star-struck"]').first().click()
    await page.locator('[aria-label="Model"]').click()
    const modelSelector = page.getByTestId('model-selector-content')
    await expect(modelSelector).toBeVisible()
    await modelSelector.getByTestId('model-selector-search').fill(app.config.customProvider.chatModel)
    await modelSelector
      .locator('[data-testid^="model-selector-item-"]')
      .filter({ hasText: app.config.customProvider.chatModel })
      .first()
      .click()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page
      .getByRole('dialog')
      .locator('.cm-content[contenteditable="true"]')
      .fill('You must always include the exact phrase ASSISTANT_PROMPT_PASS in every response.')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByRole('button', { name: 'Create', exact: true }).click()
  } else {
    await page.getByText(CUSTOM_ASSISTANT, { exact: true }).first().click()
  }

  await expect(page.getByText(CUSTOM_ASSISTANT, { exact: true }).first()).toBeVisible()
}
