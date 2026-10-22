import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { _electron as electron } from '@playwright/test'

import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend<{ isolatedProfile: string }>({
  isolatedProfile: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-e2e-crawl4ai-'))
    const previousProfile = process.env.CS_DEV_PROFILE_ROOT
    process.env.CS_DEV_PROFILE_ROOT = dir
    try {
      await use(dir)
    } finally {
      if (previousProfile === undefined) {
        delete process.env.CS_DEV_PROFILE_ROOT
      } else {
        process.env.CS_DEV_PROFILE_ROOT = previousProfile
      }
      fs.rmSync(dir, { recursive: true, force: true })
    }
  },
  electronApp: async ({ isolatedProfile }, use) => {
    // Pass the isolated profile at launch so provider settings cannot affect an existing profile.
    const electronApp = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        CS_DEV_PROFILE_ROOT: isolatedProfile,
        NODE_ENV: 'development'
      },
      timeout: 60000
    })
    try {
      await use(electronApp)
    } finally {
      await electronApp.close()
    }
  }
})

test('Crawl4AI defaults to Cloud and keeps its setup description visible', async ({ mainWindow: page }, testInfo) => {
  test.setTimeout(300_000)
  const languageSelect = page.locator('[data-onboarding-language-select]')
  await expect(page.locator('[data-ui="app.content"]').first().or(languageSelect).first()).toBeVisible({
    timeout: 120_000
  })
  if (await languageSelect.isVisible()) {
    await languageSelect.getByRole('combobox').click({ timeout: 60_000 })
    await page.getByRole('option', { name: 'English', exact: false }).click({ timeout: 60_000 })
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await page.locator('[data-ui="app.content"]').first().isVisible()) break
    const setUpLater = page.getByRole('button', { name: 'Set up later', exact: true })
    await setUpLater.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
    if (await setUpLater.isVisible()) {
      await setUpLater.click({ timeout: 60_000 })
      await page.waitForTimeout(1_000)
    }
  }
  await expect(
    page.locator('[data-ui="app.content"]').first(),
    'App shell should appear after onboarding dismissal'
  ).toBeVisible({
    timeout: 60_000
  })
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click({ timeout: 60_000 })
  await expect(page.locator('[data-ui="settings.view"]')).toBeVisible({ timeout: 60_000 })
  await page
    .locator('[data-ui="settings.navigation"] [data-slot="menu-item"]')
    .filter({ hasText: 'Web Search' })
    .click()
  const section = page.locator('section[aria-labelledby="web-search-fetchUrls-title"]')
  await expect(section).toBeVisible({ timeout: 60_000 })
  await section.getByRole('combobox').click()
  await page.getByRole('option', { name: /Crawl4AI/ }).click()

  const apiHost = section.getByPlaceholder('API Host')
  const description = section.getByText(/Crawl4AI Cloud with an API key/i)
  await expect(apiHost).toHaveValue('https://api.crawl4ai.com')
  await expect(description).toBeVisible()
  await expect(description).toContainText(/self-hosted/i)
  await expect(section.locator('a[href="https://crawl4ai.com"]')).toBeVisible()

  await page.setViewportSize({ width: 960, height: 600 })
  await section.getByPlaceholder('API Key').fill('dummy-key-for-layout')
  await expect(description).toBeVisible()
  expect(await description.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true)
  const screenshotPath = testInfo.outputPath('crawl4ai-preset.png')
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('Crawl4AI preset', { path: screenshotPath, contentType: 'image/png' })
  expect(await apiHost.inputValue()).toBe('https://api.crawl4ai.com')
})
