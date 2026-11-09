import { expect, type Page } from '@playwright/test'

import { openLaunchpadApp } from '../helpers/navigation'
import { closeSettings, openMcpServers } from '../helpers/settings'

export async function marketplaceNavigation(page: Page): Promise<void> {
  await openLaunchpadApp(page, 'Marketplace')
  const marketplace = page.getByTestId('marketplace-page')
  const types = marketplace.getByRole('complementary', { name: 'Resource types' })
  await types.getByRole('button', { name: /^All\b/ }).click()
  for (const name of ['Skill', 'Agent', 'MCP']) {
    await expect(marketplace.getByRole('heading', { name, exact: true })).toBeVisible()
  }
  await types.getByRole('button', { name: /^Skill\b/ }).click()
  await expect(marketplace.getByRole('button', { name: 'Add subscription source', exact: true })).toBeVisible()
  await types.getByRole('button', { name: /^Agent\b/ }).click()
  await expect(marketplace.getByLabel('Categories', { exact: true })).toBeVisible()
  await types.getByRole('button', { name: /^MCP\b/ }).click()
  const search = marketplace.getByRole('textbox', { name: 'Search resources', exact: true })
  await search.fill('@cherry/filesystem')
  await expect(marketplace.getByText('@cherry/filesystem', { exact: true })).toBeVisible()
  await search.fill('MARKET_01_NO_MATCH_31415')
  await expect(marketplace.getByText('No resources found', { exact: true })).toBeVisible()
  await search.clear()
  await expect(marketplace.getByText('@cherry/filesystem', { exact: true })).toBeVisible()
  await openMcpServers(page)
  await closeSettings(page)
}
