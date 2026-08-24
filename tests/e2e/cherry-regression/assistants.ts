import type { Page } from '@playwright/test'

import type { RegressionApp } from './app'
import { expect } from './fixture'
import { closeSettings, ensureCustomChatProvider } from './models'

export const CUSTOM_ASSISTANT = 'Cherry Regression Assistant 31415'

export async function ensureCustomAssistant(app: RegressionApp, page: Page): Promise<void> {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)

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
    await page.locator('button[aria-label="star-struck"]').click()
    await page.locator('[aria-label="Model"]').click()
    await page.getByTestId('model-selector-search').fill(app.config.customProvider.chatModel)
    await page.getByRole('option').filter({ hasText: app.config.customProvider.chatModel }).first().click()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page
      .getByRole('textbox', {
        name: 'Enter instructions for the assistant, such as response style, role, or background context',
        exact: true
      })
      .fill('You must always include the exact phrase ASSISTANT_PROMPT_PASS in every response.')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByRole('button', { name: 'Create', exact: true }).click()
  } else {
    await page.getByText(CUSTOM_ASSISTANT, { exact: true }).first().click()
  }

  await expect(page.getByText(CUSTOM_ASSISTANT, { exact: true }).first()).toBeVisible()
}
