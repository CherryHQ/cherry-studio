import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { _electron as electron } from '@playwright/test'

import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend<{ isolatedProfile: string }>({
  isolatedProfile: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-e2e-yuanbao-'))
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

test('Yuanbao checks use one query-only request and report pages, errors, and empty results', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(300_000)
  let scenario: 'pages' | 'empty' | 'error' = 'pages'
  const requests: {
    method: string | undefined
    url: string | undefined
    authorization: string | undefined
    contentType: string | undefined
    body: string
    timestamp: number
  }[] = []
  const server = createServer((request, response) => {
    const recorded = {
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'],
      body: '',
      timestamp: Date.now()
    }
    requests.push(recorded)
    const currentScenario = scenario
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      recorded.body = Buffer.concat(chunks).toString('utf8')
      if (request.method !== 'POST' || request.url !== '/SearchPro') {
        response.writeHead(404).end()
        return
      }
      response.writeHead(currentScenario === 'error' ? 401 : 200, { 'Content-Type': 'application/json' })
      if (currentScenario === 'error') {
        response.end(
          JSON.stringify({
            Response: {
              Error: { Code: 'UnauthorizedOperation', Message: 'Yuanbao denied access' },
              RequestId: 'stub-2'
            }
          })
        )
      } else if (currentScenario === 'empty') {
        response.end(JSON.stringify({ Response: { Pages: [] } }))
      } else {
        response.end(
          JSON.stringify({
            Response: {
              Pages: [
                JSON.stringify({
                  title: 'Yuanbao Stub Source',
                  url: 'https://source.example/yuanbao-stub',
                  content: 'Stub summary from Yuanbao.'
                })
              ],
              Query: 'Cherry Studio',
              Version: 'lite',
              RequestId: 'stub-1'
            }
          })
        )
      }
    })
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a loopback TCP address')
    const apiHostUrl = `http://127.0.0.1:${address.port}`

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
    ).toBeVisible({ timeout: 60_000 })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click({ timeout: 60_000 })
    await expect(page.locator('[data-ui="settings.view"]')).toBeVisible({ timeout: 60_000 })
    await page
      .locator('[data-ui="settings.navigation"] [data-slot="menu-item"]')
      .filter({ hasText: 'Web Search' })
      .click()

    const keywordSection = page.locator('section[aria-labelledby="web-search-searchKeywords-title"]')
    const fetchSection = page.locator('section[aria-labelledby="web-search-fetchUrls-title"]')
    await expect(keywordSection).toBeVisible({ timeout: 60_000 })
    await keywordSection.getByRole('combobox').click()
    await expect(page.getByRole('option', { name: /Yuanbao/ })).toBeVisible()
    await page.getByRole('option', { name: /Yuanbao/ }).click()
    await expect(
      keywordSection.getByText('Tencent Yuanbao Search (WSA) provides web search summaries and source links.', {
        exact: true
      })
    ).toBeVisible()
    await expect(keywordSection.locator('a[href="https://cloud.tencent.com/product/wsa"]')).toBeVisible()
    await expect(keywordSection.locator('a[href="https://console.cloud.tencent.com/wsa"]')).toBeVisible()
    const apiHost = keywordSection.getByPlaceholder('API Host', { exact: true })
    const apiKey = keywordSection.getByPlaceholder('API Key', { exact: true })
    await expect(apiHost).toHaveValue('https://api.wsa.cloud.tencent.com')
    await expect(fetchSection).not.toContainText('Yuanbao')
    await fetchSection.getByRole('combobox').click()
    await expect(page.getByRole('option').first()).toBeVisible()
    await expect(page.getByRole('option', { name: /Yuanbao/ })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await apiHost.fill(apiHostUrl)
    await apiHost.blur()
    await expect(apiHost).toHaveValue(apiHostUrl)
    await apiKey.fill('dummy-key-for-layout')
    await apiKey.blur()
    await expect(apiKey).toHaveAttribute('type', 'password')

    const check = keywordSection.getByRole('button', { name: 'Check', exact: true })
    const notifications = page.locator('[aria-label="notifications"]')
    const success = notifications.getByText('Verification successful', { exact: false }).first()
    const failure = notifications.getByText('Verification failed', { exact: false }).last()

    await check.click()
    await success.waitFor({ state: 'visible' })
    await notifications.hover()
    await expect(success).toBeVisible()
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/SearchPro',
      authorization: 'Bearer dummy-key-for-layout'
    })
    expect(requests[0].contentType).toContain('charset=utf-8')
    expect(JSON.parse(requests[0].body)).toEqual({ Query: 'Cherry Studio' })
    await notifications.getByRole('button', { name: 'Close', exact: true }).first().click()
    await expect(success).not.toBeVisible()

    scenario = 'error'
    await check.click()
    await failure.waitFor({ state: 'visible' })
    await notifications.hover()
    await expect(failure).toBeVisible()
    await expect(failure).toContainText('Yuanbao denied access')
    await expect(success).not.toBeVisible()
    await expect.poll(() => requests.length).toBe(2)
    const errorScreenshot = testInfo.outputPath('yuanbao-error.png')
    await page.screenshot({ path: errorScreenshot })
    await testInfo.attach('Yuanbao error', { path: errorScreenshot, contentType: 'image/png' })
    await notifications.getByRole('button', { name: 'Close', exact: true }).first().click()
    await expect(failure).not.toBeVisible()

    scenario = 'empty'
    await check.click()
    await success.waitFor({ state: 'visible' })
    await notifications.hover()
    await expect(success).toBeVisible()
    await expect(failure).not.toBeVisible()
    await expect.poll(() => requests.length).toBe(3)
    expect(requests.filter((request) => request.url === '/SearchPro')).toHaveLength(3)
    for (const request of requests) {
      expect(request.method).toBe('POST')
      expect(request.url).toBe('/SearchPro')
      expect(request.body).toBe('{"Query":"Cherry Studio"}')
      expect(JSON.parse(request.body)).toEqual({ Query: 'Cherry Studio' })
    }
    await expect(keywordSection.getByRole('combobox')).toContainText('Yuanbao')
    await expect(apiKey).toHaveAttribute('type', 'password')
    await expect(apiKey).toHaveValue('dummy-key-for-layout')
    await expect(apiHost).toHaveValue(apiHostUrl)
    await apiHost.scrollIntoViewIfNeeded()
    await notifications.hover()
    await expect(success).toBeVisible()
    const successScreenshot = testInfo.outputPath('yuanbao-settings-success.png')
    await page.screenshot({ path: successScreenshot })
    await testInfo.attach('Yuanbao settings success', { path: successScreenshot, contentType: 'image/png' })
    expect(requests).toHaveLength(3)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})
