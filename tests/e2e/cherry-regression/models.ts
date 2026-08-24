import type { Page } from '@playwright/test'

import type { RegressionApp } from './app'
import { expect } from './fixture'
import { dismissOnboarding, selectSidebarApp } from './helpers'

export const CUSTOM_CHAT_PROVIDER = 'Cherry Regression Custom Provider 31415'

export async function openSettingsSection(page: Page, section: string): Promise<void> {
  await dismissOnboarding(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: section, exact: true }).click()
}

async function addModel(page: Page, model: string): Promise<void> {
  if (
    await page
      .getByText(model, { exact: true })
      .isVisible()
      .catch(() => false)
  )
    return
  await page.getByRole('button', { name: 'Add Model', exact: true }).click()
  const modelId = page.getByRole('textbox', { name: 'Model ID', exact: true })
  await modelId.fill(model)
  await modelId.press('Enter')
  await expect(page.getByText(model, { exact: true })).toBeVisible()
}

export async function ensureCustomChatProvider(app: RegressionApp, page: Page): Promise<void> {
  const { baseUrl, apiKey, chatModel } = app.config.customProvider
  await openSettingsSection(page, 'Model Provider')

  if (
    !(await page
      .getByText(CUSTOM_CHAT_PROVIDER, { exact: true })
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole('button', { name: 'Add Provider', exact: true }).click()
    await page.getByRole('textbox', { name: 'Provider Name*', exact: true }).fill(CUSTOM_CHAT_PROVIDER)
    const apiKeyInput = page.getByRole('textbox', { name: 'API Key', exact: true })
    await expect(apiKeyInput).toHaveAttribute('type', 'password')
    await apiKeyInput.fill(apiKey)
    await page.getByRole('textbox', { name: 'Anthropic', exact: true }).fill(baseUrl)
    await page.getByRole('textbox', { name: 'OpenAI', exact: true }).fill(baseUrl)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
  }

  await page.getByText(CUSTOM_CHAT_PROVIDER, { exact: true }).first().click()
  const enabled = page.getByRole('switch').last()
  if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click()
  await addModel(page, chatModel)
}

export async function closeSettings(page: Page): Promise<void> {
  const back = page.getByRole('button', { name: 'Back', exact: true }).first()
  if (await back.isVisible().catch(() => false)) await back.click()
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

export async function sendChatMarker(page: Page, prompt: string, marker: string): Promise<void> {
  const composer = page.locator('[data-ui="chat.composer"] [contenteditable="true"]').first()
  await composer.fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText(marker, { exact: true }).last()).toBeVisible({ timeout: 2 * 60_000 })
}
