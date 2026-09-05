import type { Page } from '@playwright/test'

import type { RegressionApp } from './app'
import { expect } from './fixture'
import { dismissOnboarding, selectSidebarApp } from './helpers'

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

async function closeOpenSettingsDrawer(page: Page): Promise<void> {
  const drawer = page.locator('[data-slot="page-side-panel"][role="dialog"]:visible').first()
  if (!(await drawer.isVisible().catch(() => false))) return

  await page.keyboard.press('Escape')
  if (await drawer.isVisible().catch(() => false)) {
    const closed = await drawer
      .waitFor({ state: 'hidden', timeout: 1_000 })
      .then(() => true)
      .catch(() => false)
    if (!closed) await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  }
  await expect(drawer).toBeHidden()
}

export async function openSettingsSection(page: Page, section: string): Promise<void> {
  await dismissOnboarding(page)
  await page.keyboard.press('Escape')
  await closeOpenSettingsDrawer(page)
  const sectionButton = page
    .locator('[data-ui="settings.navigation"] [data-slot="menu-item"]')
    .filter({ hasText: section })
    .first()
  if (!(await sectionButton.isVisible().catch(() => false))) {
    await selectSidebarApp(page, 'Settings')
  }
  await sectionButton.click()
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
  await page.getByRole('button', { name: 'Add Model', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add Model' })
  const modelId = dialog.getByRole('textbox', { name: 'Model ID', exact: true })
  await modelId.fill(model)
  await dialog.getByRole('button', { name: 'More Settings', exact: true }).click()
  await dialog.getByRole('button', { name: 'Tool', exact: true }).click()
  await dialog.getByRole('button', { name: 'Add Model', exact: true }).click()
  await expect(page.getByText(model, { exact: true }).last()).toBeVisible()
  await closeOpenSettingsDrawer(page)
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

export async function closeSettings(page: Page): Promise<void> {
  await closeOpenSettingsDrawer(page)
  await page.getByRole('button', { name: 'Back', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Chat', exact: true }).first()).toBeVisible()
}

export async function selectChatModel(page: Page, model: string): Promise<void> {
  await selectSidebarApp(page, 'Chat')
  await page.getByRole('button', { name: 'Selected models', exact: true }).click()
  await selectVisibleModel(page, model)
  await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toBeVisible()
}

export async function sendChatMarker(page: Page, prompt: string, marker: string, exact = true): Promise<void> {
  const composer = page.locator('[data-ui="chat.composer"] [contenteditable="true"]').first()
  await composer.fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText(marker, { exact }).last()).toBeVisible({ timeout: 2 * 60_000 })
}
