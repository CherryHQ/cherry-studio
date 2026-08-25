import type { Page } from '@playwright/test'

import type { RegressionApp } from './app'
import { expect } from './fixture'
import { dismissOnboarding, selectSidebarApp } from './helpers'

export const CUSTOM_CHAT_PROVIDER = 'Cherry Regression Provider'

async function closeOpenSettingsDrawer(page: Page): Promise<void> {
  const drawer = page.locator('[data-slot="page-side-panel"][role="dialog"]:visible').first()
  if (!(await drawer.isVisible().catch(() => false))) return

  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(drawer).toBeHidden()
}

export async function openSettingsSection(page: Page, section: string): Promise<void> {
  await dismissOnboarding(page)
  await closeOpenSettingsDrawer(page)
  const sectionButton = page
    .locator('[data-ui="settings.navigation"] [data-slot="menu-item"]')
    .filter({ hasText: section })
    .first()
  if (!(await sectionButton.isVisible().catch(() => false))) {
    await page.locator('#app-sidebar').getByRole('button', { name: 'Settings', exact: true }).click()
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
  await dialog.getByRole('button', { name: 'Add Model', exact: true }).click()
  await expect(page.getByText(model, { exact: true }).last()).toBeVisible()
  await closeOpenSettingsDrawer(page)
}

export async function ensureCustomChatProvider(app: RegressionApp, page: Page): Promise<void> {
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
    await page.getByRole('textbox', { name: 'OpenAI', exact: true }).fill(baseUrl)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
  }

  const providerHeading = page.getByRole('heading', { name: CUSTOM_CHAT_PROVIDER, exact: true, level: 1 })
  if (!(await providerHeading.isVisible().catch(() => false))) await providerItem.click()
  await expect(providerHeading).toBeVisible()
  const enabled = page.getByRole('switch').last()
  if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click()
  await addModel(page, chatModel)
}

export async function closeSettings(page: Page): Promise<void> {
  await closeOpenSettingsDrawer(page)
  await page.getByRole('button', { name: 'Back', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Chat', exact: true }).first()).toBeVisible()
}

export async function selectChatModel(page: Page, model: string): Promise<void> {
  await selectSidebarApp(page, 'Chat')
  await page.getByRole('button', { name: 'Selected models', exact: true }).click()
  const search = page.getByTestId('model-selector-search')
  await search.fill(model)
  await page.getByRole('option').filter({ hasText: model }).first().click()
  await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(
    model.split('/').at(-1) ?? model
  )
}

export async function sendChatMarker(page: Page, prompt: string, marker: string, exact = true): Promise<void> {
  const composer = page.locator('[data-ui="chat.composer"] [contenteditable="true"]').first()
  await composer.fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText(marker, { exact }).last()).toBeVisible({ timeout: 2 * 60_000 })
}
