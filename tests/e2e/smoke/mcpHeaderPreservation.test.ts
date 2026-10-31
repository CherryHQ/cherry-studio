import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

import type { McpServer } from '../../../src/shared/data/types/mcpServer'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('MCP detail save preserves literal hashes in persisted and outgoing headers', async ({ mainWindow }, testInfo) => {
  test.setTimeout(120_000)
  const name = `issue-22060-header-${randomUUID()}`
  const authorization = 'Bearer xxx-proxy@!@#'
  const requests: {
    method: string | undefined
    rpcMethod?: string
    id?: string | number
    body: unknown
    rawBody: string
    rawHeaders: string[]
    authorization: string | undefined
  }[] = []
  const httpServer = createServer((req, res) => {
    let rawBody = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      rawBody += chunk
    })
    req.on('end', () => {
      let body: { method?: string; id?: string | number } | undefined
      try {
        body = rawBody ? JSON.parse(rawBody) : undefined
      } catch {
        res.writeHead(400).end()
        return
      }
      requests.push({
        method: req.method,
        rpcMethod: body?.method,
        id: body?.id,
        body,
        rawBody,
        rawHeaders: req.rawHeaders,
        authorization: req.headers.authorization
      })
      if (req.url !== '/mcp') {
        res.writeHead(404).end()
        return
      }
      if (req.method === 'GET') {
        res.writeHead(405).end()
        return
      }
      if (body?.method === 'server/discover') {
        res.writeHead(500).end()
        return
      }
      if (body?.id === undefined) {
        res.writeHead(202).end()
        return
      }
      const result =
        body.method === 'initialize'
          ? {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'header-fixture', version: '1' }
            }
          : body.method === 'tools/list'
            ? { tools: [{ name: 'inspect_header', inputSchema: { type: 'object' } }] }
            : body.method === 'ping'
              ? {}
              : undefined
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          ...(result === undefined ? { error: { code: -32601, message: 'Method not found' } } : { result })
        })
      )
    })
  })
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', resolve)
  })
  const address = httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Mock server did not bind a TCP port')
  const server = {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.closeAllConnections?.()
        httpServer.close((error) => (error ? reject(error) : resolve()))
      })
  }
  let preferences: Awaited<ReturnType<typeof prepare>> | undefined
  let persisted: unknown
  let serverId: string | undefined
  async function prepare() {
    return mainWindow.evaluate(async () => {
      const previous = {
        'app.language': await window.api.preference.get('app.language'),
        'app.onboarding.provider_setup.status': await window.api.preference.get('app.onboarding.provider_setup.status'),
        'app.privacy.data_collection.enabled': await window.api.preference.get('app.privacy.data_collection.enabled')
      }
      await window.api.preference.setMultiple({
        'app.language': 'en-US',
        'app.onboarding.provider_setup.status': 'skipped',
        'app.privacy.data_collection.enabled': false
      })
      return previous
    })
  }
  const readServers = () =>
    mainWindow.evaluate(async () => {
      return window.api.dataApi.request({ id: 'issue-22060-read', method: 'GET', path: '/mcp-servers' })
    })
  const matchingRows = async () => {
    const response = await readServers()
    const rows =
      response.status === 200 && !response.error
        ? (response.data as { items: McpServer[] }).items.filter((row) => row.name === name)
        : []
    persisted = { status: response.status, error: response.error, rows }
    return rows
  }
  try {
    preferences = await prepare()
    await mainWindow.reload()
    await uiLocator(mainWindow, 'app.sidebar').getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = uiLocator(mainWindow, 'settings.view')
    await mainWindow.locator('[data-ui~="settings.navigation"]').getByRole('button', { name: /MCP$/ }).click()
    const content = uiLocator(settings, 'settings.content')
    await content.locator('#setting-mcp-servers-tab-servers').click()
    await content.getByRole('button', { name: 'Add', exact: true }).click()
    await mainWindow.getByRole('button', { name: 'Quick Create', exact: true }).click()
    const create = mainWindow.getByRole('dialog').filter({ hasText: 'Quick Create' }).first()
    await create.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
    await create.getByRole('combobox').first().click()
    await mainWindow.getByRole('option', { name: 'Streamable HTTP (streamableHttp)', exact: true }).click()
    await create.getByPlaceholder('http://localhost:3000/mcp').fill(`${server.url}/mcp`)
    await create.getByRole('button', { name: 'Add', exact: true }).click()
    await expect
      .poll(async () => {
        const rows = await matchingRows()
        serverId = rows.length === 1 ? rows[0].id : undefined
        return rows.length
      })
      .toBe(1)
    const form = content.locator('#mcp-settings-form')
    const headers = form.locator('textarea[name="headers"]')
    await headers.fill(`# ignored=value\nAuthorization=${authorization}`)
    const save = content.getByRole('button', { name: 'Save', exact: true })
    await save.click()
    await expect.poll(async () => (await matchingRows())[0]?.headers?.Authorization).toBe(authorization)
    const saved = persisted
    await content.getByRole('switch').first().check()
    await expect
      .poll(
        () => ['initialize', 'tools/list'].every((method) => requests.some((request) => request.rpcMethod === method)),
        { timeout: 30_000 }
      )
      .toBe(true)
    await testInfo.attach('Persistence and wire observations', {
      body: JSON.stringify({ persisted: saved, requests }, null, 2),
      contentType: 'application/json'
    })
    await expect
      .poll(async () => (await matchingRows()).map((row) => row.headers))
      .toEqual([{ Authorization: authorization }])
    for (const method of ['initialize', 'tools/list']) {
      const observed = requests.filter((request) => request.rpcMethod === method)
      expect(observed.length).toBeGreaterThan(0)
      for (const request of observed) expect(request.authorization).toBe(authorization)
    }
    const tools = content.getByRole('radio', { name: /^Tools/ })
    await expect(tools).toBeVisible({ timeout: 30_000 })
    await tools.click()
    await expect(content.getByText('inspect_header', { exact: true })).toBeVisible()
    const toolsPath = testInfo.outputPath('mcp-tools-connected.png')
    await mainWindow.screenshot({ path: toolsPath })
    await testInfo.attach('MCP tools connected', { path: toolsPath, contentType: 'image/png' })
    await content.locator('#setting-mcp-servers-tab-servers').click()
    await content
      .locator('[data-slot="mcp-server-row"]')
      .filter({ has: mainWindow.getByText(name, { exact: true }) })
      .click()
    await content.getByRole('radio', { name: 'General', exact: true }).click()
    await expect(headers).toHaveValue(`Authorization=${authorization}`)
    await headers.scrollIntoViewIfNeeded()
    await expect(headers).toBeInViewport()
    const p = testInfo.outputPath('mcp-header-preserved.png')
    await mainWindow.screenshot({ path: p })
    await testInfo.attach('MCP header preserved', { path: p, contentType: 'image/png' })
  } finally {
    try {
      await testInfo.attach('Final persistence and request journal', {
        body: JSON.stringify({ persisted, requests }, null, 2),
        contentType: 'application/json'
      })
      // Recover the created ID even if navigation or saving failed after creation.
      if (!serverId) serverId = (await matchingRows())[0]?.id
      if (serverId)
        await mainWindow.evaluate((id) => window.api.ipcApi.request('mcp.server.remove', { serverId: id }), serverId)
    } finally {
      try {
        if (preferences)
          await mainWindow.evaluate((previous) => window.api.preference.setMultiple(previous), preferences)
      } finally {
        await server.close()
      }
    }
  }
})
