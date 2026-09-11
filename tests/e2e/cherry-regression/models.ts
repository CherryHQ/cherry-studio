import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

import type { RegressionApp } from './RegressionApp'
import { closeOpenSettingsDrawer, openSettingsSection } from './settings'

export const CUSTOM_CHAT_PROVIDER = 'Cherry Regression Provider'

export async function selectVisibleModel(page: Page, model: string): Promise<void> {
  const selector = page.locator('[data-testid="model-selector-content"]:visible').last()
  await expect(selector).toBeVisible()
  const modelName = model.split('/').at(-1) ?? model
  const search = selector.getByTestId('model-selector-search')
  await search.fill(modelName)
  const option = selector
    .locator(`[role="option"][data-testid$="::${model}"], [role="option"][data-testid$="::${modelName}"]`)
    .first()
  await expect(option).toBeVisible()
  await option.click()
}

async function addModel(page: Page, model: string): Promise<void> {
  if (
    await page
      .getByText(model, { exact: true })
      .last()
      .isVisible()
      .catch(() => false)
  )
    return
  await page.getByRole('button', { name: 'Add model manually', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add Model' })
  const modelId = dialog.getByRole('textbox', { name: 'Model ID', exact: true })
  await modelId.fill(model)
  await dialog.getByRole('button', { name: 'More Settings', exact: true }).click()
  await dialog.getByRole('button', { name: 'Tool', exact: true }).click()
  await dialog.getByRole('button', { name: 'Add Model', exact: true }).click()
  await expect(page.getByText(model, { exact: true }).last()).toBeVisible()
  await closeOpenSettingsDrawer(page)
}

export async function skipNewProviderModelSetup(page: Page): Promise<void> {
  const skipButton = page.getByRole('button', { name: 'Skip', exact: true })
  await expect(skipButton).toBeVisible()
  await skipButton.click()
  await expect(skipButton).toBeHidden()
}

export async function ensureCustomChatProvider(app: RegressionApp, page: Page): Promise<string> {
  const { baseUrl, apiKey, chatModel } = app.config.customProvider
  await openSettingsSection(page, 'Model Provider')
  const providerItem = page
    .locator('[data-testid^="provider-list-item-"]')
    .filter({ hasText: CUSTOM_CHAT_PROVIDER })
    .first()

  await expect(page.getByRole('button', { name: 'Add Provider', exact: true })).toBeVisible()
  if ((await providerItem.count()) === 0) {
    await page.getByRole('button', { name: 'Add Provider', exact: true }).click()
    await page.getByPlaceholder('Example: OpenAI', { exact: true }).fill(CUSTOM_CHAT_PROVIDER)
    const apiKeyInput = page.getByRole('textbox', { name: 'API Key', exact: true })
    await expect(apiKeyInput).toHaveAttribute('type', 'password')
    await apiKeyInput.fill(apiKey)
    await page.getByRole('textbox', { name: 'Anthropic', exact: true }).fill(baseUrl)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await skipNewProviderModelSetup(page)
  }

  const providerHeading = page.getByRole('heading', { name: CUSTOM_CHAT_PROVIDER, exact: true, level: 1 })
  if (!(await providerHeading.isVisible().catch(() => false))) await providerItem.click()
  await expect(providerHeading).toBeVisible()
  const enabled = page.getByRole('switch').last()
  if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click()
  await addModel(page, chatModel)

  const providerTestId = await providerItem.getAttribute('data-testid')
  const providerTestIdPrefix = 'provider-list-item-'
  if (!providerTestId?.startsWith(providerTestIdPrefix)) {
    throw new Error('Custom chat provider ID is unavailable')
  }
  return providerTestId.slice(providerTestIdPrefix.length)
}
