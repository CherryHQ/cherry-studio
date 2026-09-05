import { join } from 'node:path'

import type { Page } from '@playwright/test'

import type { RegressionApp } from './app'
import { expect } from './fixture'
import { selectSidebarApp } from './helpers'
import { openSettingsSection, selectVisibleModel } from './models'
import { chooseNativeFile } from '../../../scripts/cherry-regression-test/system-automation'

export const EMBEDDING_PROVIDER = 'Cherry Regression Embedding'
export const KNOWLEDGE_NAME = 'Cherry Regression Knowledge 31415'

export async function ensureEmbeddingProvider(app: RegressionApp, page: Page): Promise<void> {
  const { baseUrl, apiKey, model } = app.config.customEmbeddingProvider
  await openSettingsSection(page, 'Model Provider')
  const providerItem = page
    .locator('[data-testid^="provider-list-item-"]')
    .filter({ hasText: EMBEDDING_PROVIDER })
    .first()

  await expect(page.getByRole('button', { name: 'Add Provider', exact: true })).toBeVisible()
  if ((await providerItem.count()) === 0) {
    await page.getByRole('button', { name: 'Add Provider', exact: true }).click()
    await page.getByPlaceholder('Example: OpenAI', { exact: true }).fill(EMBEDDING_PROVIDER)
    const apiKeyInput = page.getByRole('textbox', { name: 'API Key', exact: true })
    await expect(apiKeyInput).toHaveAttribute('type', 'password')
    await apiKeyInput.fill(apiKey)
    await page.getByRole('textbox', { name: 'OpenAI', exact: true }).fill(baseUrl)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
  }

  const providerHeading = page.getByRole('heading', { name: EMBEDDING_PROVIDER, exact: true, level: 1 })
  if (!(await providerHeading.isVisible().catch(() => false))) await providerItem.click()
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
    await page.getByRole('dialog', { name: 'Add Model' }).getByRole('button', { name: 'Add Model' }).click()
  }
  await expect(page.getByText(model, { exact: true })).toBeVisible()
}

export async function ensureKnowledgeBase(app: RegressionApp, page: Page): Promise<void> {
  await selectSidebarApp(page, 'Knowledge Base')
  const navigation = page.locator('[data-ui="knowledge.navigation"]')
  const existingBase = navigation.getByText(KNOWLEDGE_NAME, { exact: true }).first()
  const selectedBase = page.locator('[data-ui="knowledge.content"]').getByText(KNOWLEDGE_NAME, { exact: true }).first()
  const createBase = page.getByRole('button', { name: 'Create Knowledge Base', exact: true })
  await expect(existingBase.or(selectedBase).or(createBase).first()).toBeVisible()

  if (!(await selectedBase.isVisible().catch(() => false))) {
    if (await existingBase.isVisible().catch(() => false)) {
      await existingBase.click()
    } else {
      await page.getByRole('button', { name: 'Create Knowledge Base', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'New Knowledge Base' })
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill(KNOWLEDGE_NAME)
      await page.getByRole('button', { name: 'Embedding Model', exact: true }).click()
      await selectVisibleModel(page, app.config.customEmbeddingProvider.model)
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(dialog).toBeHidden({ timeout: 2 * 60_000 })
      await expect(selectedBase).toBeVisible()
    }
  }

  const readyFiles = page.getByText('Ready', { exact: true })
  if ((await readyFiles.count()) === 0) {
    const folder = page.getByRole('button', { name: 'Folder', exact: true })
    if (await folder.isVisible().catch(() => false)) await folder.click()
    else {
      await page.getByRole('button', { name: 'Add Data Source', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Folder', exact: true }).click()
    }
    await page.waitForTimeout(1_000)
    chooseNativeFile(app.record.platform, app.paths, join(app.paths.fixtures, 'knowledge'))
  }
  await expect
    .poll(async () => page.getByText('Ready', { exact: true }).count(), { timeout: 3 * 60_000 })
    .toBeGreaterThanOrEqual(1)
}
