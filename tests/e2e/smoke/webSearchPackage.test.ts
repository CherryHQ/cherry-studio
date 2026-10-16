import { readFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'

import { uiSelector } from '../../../src/renderer/utils/uiContract'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'

function startTestHttpServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ url: string; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done()))
      })
    })
  })
}

test.beforeAll(() => {
  expect(
    process.env.CS_DEV_PROFILE_ROOT,
    'The orchestrator must supply a unique profile root for this run'
  ).toBeTruthy()
})

test('Desktop Web Search preserves Tavily requests and sanitizes upstream HTTP failures', async ({
  mainWindow
}, testInfo) => {
  const dummyKey = 'web-search-smoke-dummy-key'
  const sentinel = 'SENTINEL-UPSTREAM-BODY'
  const fixture = readFileSync(
    join(process.cwd(), 'packages/web-search/src/__tests__/fixtures/tavily-response.json'),
    'utf8'
  )
  const requests: { method?: string; url?: string; headers: IncomingHttpHeaders; rawBody: string }[] = []
  let failUpstream = false
  const server = await startTestHttpServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        rawBody: Buffer.concat(chunks).toString()
      })
      if (req.method !== 'POST' || req.url !== '/search') {
        res.writeHead(404).end()
        return
      }
      res.writeHead(failUpstream ? 401 : 200, { 'Content-Type': 'application/json' })
      res.end(failUpstream ? JSON.stringify({ error: sentinel }) : fixture)
    })
  })

  try {
    const composer = mainWindow
      .locator(uiSelector({ parts: ['composer-input'] }))
      .filter({ visible: true })
      .first()
    const languageSelect = mainWindow.locator('[data-onboarding-language-select]')
    await expect(composer.or(languageSelect).first()).toBeVisible()
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click()
      await mainWindow.getByRole('option', { name: 'English', exact: false }).click()
      await mainWindow.getByRole('button', { name: 'Set up later', exact: true }).click()
    }

    await selectSidebarApp(mainWindow, 'Settings')
    const navigation = mainWindow.locator(uiSelector({ semanticId: 'settings.navigation' }))
    await navigation
      .locator('[data-slot="menu-item"]')
      .filter({ hasText: /^Web Search$/ })
      .click()
    const content = mainWindow.locator(uiSelector({ semanticId: 'settings.content' }))
    const providerSelect = content.getByRole('combobox', { name: 'Search service provider', exact: true })
    await expect(providerSelect).toBeVisible()
    await providerSelect.click()
    await mainWindow.getByRole('option', { name: 'Tavily', exact: true }).click()
    await expect(providerSelect).toContainText('Tavily')

    const searchSection = content.getByRole('region', { name: 'Search service provider', exact: true })
    const apiHost = searchSection.getByPlaceholder('API Host', { exact: true })
    const apiKey = searchSection.getByPlaceholder('API Key', { exact: true })
    await expect(apiHost).toBeVisible()
    await expect(apiKey).toBeVisible()
    await testInfo.attach('web-search-provider-configuration', {
      body: await content.screenshot(),
      contentType: 'image/png'
    })
    await apiHost.fill(server.url)
    await apiHost.blur()
    await apiKey.fill(dummyKey)
    await apiKey.blur()
    await searchSection.getByRole('button', { name: 'Advanced Settings', exact: true }).click()
    const maxResults = searchSection.getByRole('spinbutton', { name: 'Number of search results', exact: true })
    await maxResults.fill('5')
    await maxResults.blur()
    await expect(maxResults).toHaveValue('5')

    const check = searchSection.getByRole('button', { name: 'Check', exact: true })
    const success = mainWindow.getByRole('status').filter({ hasText: 'Verification successful' })
    await check.click()
    await expect(success).toBeVisible()
    await expect(check).toBeEnabled()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/search' })
    expect(JSON.parse(requests[0].rawBody)).toEqual({ query: 'Cherry Studio', max_results: 5 })
    expect(requests[0].headers).toMatchObject({
      authorization: `Bearer ${dummyKey}`,
      'http-referer': 'https://cherry-ai.com',
      'x-title': 'Cherry Studio'
    })
    expect(requests[0].headers['content-type']).toContain('application/json')
    await testInfo.attach('web-search-verification-success', {
      body: await mainWindow.screenshot(),
      contentType: 'image/png'
    })

    await mainWindow.reload()
    await expect(providerSelect).toContainText('Tavily')
    await expect(apiHost).toHaveValue(server.url)
    await expect(apiKey).toHaveValue(dummyKey)
    await expect(success).toBeHidden()
    failUpstream = true
    await check.click()
    const failure = mainWindow.getByRole('alert').filter({ hasText: /^Verification failed:/ })
    await expect(failure).toBeVisible()
    await expect(failure).toContainText('Web search HTTP request failed')
    await expect(failure).not.toContainText(sentinel)
    await expect(failure).not.toContainText(dummyKey)
    await expect(success).toBeHidden()
    await expect(check).toBeEnabled()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({ method: 'POST', url: '/search' })
    await testInfo.attach('web-search-verification-failure', {
      body: await mainWindow.screenshot(),
      contentType: 'image/png'
    })
  } finally {
    await server.close()
    await testInfo.attach('web-search-server-transcript', {
      body: JSON.stringify(requests, null, 2),
      contentType: 'application/json'
    })
  }
})
