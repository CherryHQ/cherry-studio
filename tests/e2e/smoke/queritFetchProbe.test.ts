import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { _electron as electron } from '@playwright/test'

import { expect, test as base } from './fixtures/electron.fixture'

const PROBE_URL = 'https://www.querit.ai/en/docs/overview/about'
const PAGE_FAILURE_DESCRIPTION = `Querit responded, but could not fetch the test page (${PROBE_URL}). URL fetching was not verified.`

const test = base.extend<{ isolatedProfile: string }>({
  isolatedProfile: async ({}, provide) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-e2e-querit-'))
    const previousProfile = process.env.CS_DEV_PROFILE_ROOT
    process.env.CS_DEV_PROFILE_ROOT = dir
    try {
      await provide(dir)
    } finally {
      if (previousProfile === undefined) {
        delete process.env.CS_DEV_PROFILE_ROOT
      } else {
        process.env.CS_DEV_PROFILE_ROOT = previousProfile
      }
      fs.rmSync(dir, { recursive: true, force: true })
    }
  },
  electronApp: async ({ isolatedProfile }, provide) => {
    const electronApp = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        CS_DEV_PROFILE_ROOT: isolatedProfile,
        NODE_ENV: 'development'
      },
      timeout: 60_000
    })
    try {
      await provide(electronApp)
    } finally {
      await electronApp.close()
    }
  }
})

test.setTimeout(300_000)

test('Querit fetch check distinguishes page failure, usable content and HTTP failure', async ({
  mainWindow: page
}, testInfo) => {
  type Outcome = 'page-failure' | 'usable-content' | 'unauthorized'
  const receivedRequests: { outcome: Outcome; method: string | undefined; url: string; body: unknown }[] = []
  let outcome: Outcome = 'page-failure'
  // The shared helper uses import.meta.dirname, which this CommonJS Playwright suite does not transform.
  const server = createServer((req, res) => {
    const requestOutcome = outcome
    let rawBody = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      rawBody += chunk
    })
    req.on('end', () => {
      let body: unknown = rawBody
      try {
        body = JSON.parse(rawBody)
      } catch {
        // Retain malformed input in the evidence so the request assertion explains the failure.
      }
      receivedRequests.push({
        outcome: requestOutcome,
        method: req.method,
        url: `http://${req.headers.host}${req.url}`,
        body
      })
      res.setHeader('Content-Type', 'application/json')
      if (req.method !== 'POST' || req.url !== '/v1/contents') {
        res.writeHead(404).end(JSON.stringify({ error_msg: 'Unexpected endpoint' }))
        return
      }
      if (requestOutcome === 'unauthorized') {
        res.writeHead(401).end(JSON.stringify({ error_msg: 'Invalid credential' }))
        return
      }
      const requestedUrl = (body as { urls?: string[] } | null)?.urls?.[0]
      res.writeHead(200).end(
        JSON.stringify({
          error_code: 200,
          error_msg: '',
          results: [
            {
              id: '1',
              url: requestedUrl,
              content: requestOutcome === 'page-failure' ? '' : '# Fixture page\n\nBody for the connectivity check.'
            }
          ],
          statuses: [{ id: '1', status: requestOutcome === 'page-failure' ? 'failed' : 'success' }]
        })
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const fixtureUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  try {
    const shell = page.locator('[data-ui~="app.content"]').first()
    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(shell.or(languageSelect).first()).toBeVisible({ timeout: 120_000 })
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click({ timeout: 60_000 })
      await page.getByRole('option', { name: 'English', exact: false }).click({ timeout: 60_000 })
    }
    if (!(await shell.isVisible())) {
      await page.getByRole('button', { name: 'Set up later', exact: true }).click({ timeout: 60_000 })
    }
    await expect(shell, 'App shell should appear after onboarding dismissal').toBeVisible({ timeout: 60_000 })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click({ timeout: 60_000 })
    await expect(page.locator('[data-ui~="settings.view"]')).toBeVisible({ timeout: 60_000 })
    await page
      .locator('[data-ui~="settings.navigation"] [data-slot="menu-item"]')
      .filter({ hasText: 'Web Search' })
      .click()

    const section = page.locator('section[aria-labelledby="web-search-fetchUrls-title"]')
    await expect(section).toBeVisible({ timeout: 60_000 })
    await section.getByRole('combobox').click()
    await page.getByRole('option', { name: /Querit/ }).click()
    await expect(section.getByRole('combobox')).toContainText('Querit')

    const apiHost = section.getByPlaceholder('API Host', { exact: true })
    await expect(
      apiHost,
      'Querit must expose an editable API Host; stop if this UI contract is unavailable'
    ).toBeEditable()
    await apiHost.fill(fixtureUrl)
    await section.getByPlaceholder('API Key', { exact: true }).fill('querit-e2e-fake-key')
    const hostValidation = await apiHost.evaluate((input: HTMLInputElement) => ({
      value: input.value,
      valid: input.validity.valid,
      validationMessage: input.validationMessage
    }))
    await testInfo.attach('querit-api-host.json', {
      body: JSON.stringify(
        {
          selector: 'section[aria-labelledby="web-search-fetchUrls-title"] input[placeholder="API Host"]',
          ...hostValidation
        },
        null,
        2
      ),
      contentType: 'application/json'
    })
    expect(hostValidation, 'Stop if the UI rejects the loopback API Host').toEqual({
      value: fixtureUrl,
      valid: true,
      validationMessage: ''
    })
    await expect(apiHost).toHaveValue(fixtureUrl)

    const check = section.getByRole('button', { name: 'Check', exact: true })
    const notifications = page.getByRole('region', { name: 'notifications', exact: true })
    const cases = [
      { outcome: 'page-failure', role: 'alert', title: 'Verification failed' },
      { outcome: 'usable-content', role: 'status', title: 'Verification successful' },
      {
        outcome: 'unauthorized',
        role: 'alert',
        title: 'Verification failed: querit request failed: HTTP 401 Invalid credential'
      }
    ] as const

    for (const scenario of cases) {
      await test.step(scenario.outcome, async () => {
        outcome = scenario.outcome
        await expect(check).toBeEnabled()
        await check.click()
        const notice = notifications.getByRole(scenario.role).filter({ hasText: scenario.title })
        await expect(notice).toBeVisible({ timeout: 30_000 })
        // Hover pauses the real toast's three-second dismissal timer while collecting evidence.
        await notice.hover()
        await expect(notice.getByText(scenario.title, { exact: true })).toBeVisible()

        if (scenario.outcome === 'page-failure') {
          const description = notice.getByText(PAGE_FAILURE_DESCRIPTION, { exact: true })
          await expect(description).toBeVisible()
          await expect(description).toBeInViewport({ ratio: 1 })
          await expect(notice).toBeInViewport({ ratio: 1 })
          expect(
            await description.evaluate((element) => ({
              horizontal: element.scrollWidth <= element.clientWidth,
              vertical: element.scrollHeight <= element.clientHeight
            })),
            'The complete URL and not-verified qualification must be readable, without clipping'
          ).toEqual({ horizontal: true, vertical: true })
          await expect(notifications.getByRole('status')).toHaveCount(0)
        } else {
          await expect(notice).not.toContainText(PROBE_URL)
          await expect(notice).not.toContainText('URL fetching was not verified')
          if (scenario.outcome === 'unauthorized') {
            await expect(notifications.getByRole('status')).toHaveCount(0)
          } else {
            await expect(notifications.getByRole('alert')).toHaveCount(0)
          }
        }

        await expect(check, 'Check must become usable again after every outcome').toBeEnabled()
        const requests = receivedRequests.filter((request) => request.outcome === scenario.outcome)
        expect(requests, 'The visible outcome must come from the loopback Querit endpoint').not.toEqual([])
        for (const request of requests) {
          expect(request).toEqual({
            outcome: scenario.outcome,
            method: 'POST',
            url: `${fixtureUrl}/v1/contents`,
            body: { urls: [PROBE_URL], format: 'markdown', extrasMeta: true }
          })
        }

        await testInfo.attach(`${scenario.outcome}-toast.txt`, {
          body: await notice.innerText(),
          contentType: 'text/plain'
        })
        const screenshotPath = testInfo.outputPath(`querit-${scenario.outcome}.png`)
        await page.screenshot({ path: screenshotPath })
        await testInfo.attach(`Querit ${scenario.outcome}`, { path: screenshotPath, contentType: 'image/png' })
        await notice.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(notice).toHaveCount(0)
        await check.click({ trial: true })
      })
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await testInfo.attach('querit-fetch-probe-requests.json', {
      body: JSON.stringify({ fixtureUrl, receivedRequests }, null, 2),
      contentType: 'application/json'
    })
  }
})
