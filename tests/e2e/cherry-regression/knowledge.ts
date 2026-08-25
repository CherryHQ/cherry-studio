import { join } from 'node:path'

import type { Page } from '@playwright/test'

import type { RegressionApp } from './app'
import { expect } from './fixture'
import { selectSidebarApp } from './helpers'
import { openSettingsSection } from './models'

export const EMBEDDING_PROVIDER = 'Cherry Regression Embedding'
export const KNOWLEDGE_NAME = 'Cherry Regression Knowledge 31415'

export async function ensureEmbeddingProvider(app: RegressionApp, page: Page): Promise<void> {
  const { baseUrl, apiKey, model } = app.config.customEmbeddingProvider
  await openSettingsSection(page, 'Model Provider')

  if (
    !(await page
      .getByText(EMBEDDING_PROVIDER, { exact: true })
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole('button', { name: 'Add Provider', exact: true }).click()
    await page.getByPlaceholder('Example: OpenAI', { exact: true }).fill(EMBEDDING_PROVIDER)
    const apiKeyInput = page.getByRole('textbox', { name: 'API Key', exact: true })
    await expect(apiKeyInput).toHaveAttribute('type', 'password')
    await apiKeyInput.fill(apiKey)
    await page.getByRole('textbox', { name: 'OpenAI', exact: true }).fill(baseUrl)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
  }

  const providerHeading = page.getByRole('heading', { name: EMBEDDING_PROVIDER, exact: true, level: 1 })
  if (!(await providerHeading.isVisible().catch(() => false))) {
    await page.locator('[data-testid^="provider-list-item-"]').filter({ hasText: EMBEDDING_PROVIDER }).first().click()
  }
  await expect(providerHeading).toBeVisible()
  const enabled = page.getByRole('switch').last()
  if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click()
  if (
    !(await page
      .getByText(model, { exact: true })
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole('button', { name: 'Add Model', exact: true }).click()
    const modelId = page.getByRole('textbox', { name: 'Model ID', exact: true })
    await modelId.fill(model)
    await page.getByRole('button', { name: 'More Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Embedding', exact: true }).click()
    await modelId.press('Enter')
  }
  await expect(page.getByText(model, { exact: true })).toBeVisible()
}

export async function ensureKnowledgeBase(app: RegressionApp, page: Page): Promise<void> {
  await selectSidebarApp(page, 'Knowledge Base')
  if (
    !(await page
      .getByText(KNOWLEDGE_NAME, { exact: true })
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole('button', { name: 'Create Knowledge Base', exact: true }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(KNOWLEDGE_NAME)
    await page.getByRole('button', { name: 'Embedding Model', exact: true }).click()
    await page.getByTestId('model-selector-search').fill(app.config.customEmbeddingProvider.model)
    await page.getByRole('option').filter({ hasText: app.config.customEmbeddingProvider.model }).first().click()
    await page.getByRole('button', { name: 'Create', exact: true }).click()
  } else {
    await page.getByText(KNOWLEDGE_NAME, { exact: true }).first().click()
  }

  const readyFiles = page.getByText('Ready', { exact: true })
  if ((await readyFiles.count()) < 3) {
    const chooserPromise = page.waitForEvent('filechooser')
    const folder = page.getByRole('button', { name: 'Folder', exact: true })
    if (await folder.isVisible().catch(() => false)) await folder.click()
    else {
      await page.getByRole('button', { name: 'Add Data Source', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Folder', exact: true }).click()
    }
    const chooser = await chooserPromise
    await chooser.setFiles(join(app.paths.fixtures, 'knowledge'))
  }
  await expect
    .poll(async () => page.getByText('Ready', { exact: true }).count(), { timeout: 3 * 60_000 })
    .toBeGreaterThanOrEqual(3)
}
