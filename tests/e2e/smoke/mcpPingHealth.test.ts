import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import type { McpServer } from '../../../src/shared/data/types/mcpServer'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('MCP server remains usable when legacy ping returns extra fields', async ({ mainWindow }, testInfo) => {
  test.setTimeout(120_000)
  const name = `issue-22769-ping-${randomUUID()}`
  const requests: {
    method: string | undefined
    rpcMethod?: string
    timestamp: string
    statusCode?: number
  }[] = []
  const httpServer = createServer((req, res) => {
    const request: (typeof requests)[number] = { method: req.method, timestamp: new Date().toISOString() }
    requests.push(request)
    res.once('finish', () => {
      request.statusCode = res.statusCode
    })
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
      request.rpcMethod = body?.method
      if (req.url !== '/mcp') {
        res.writeHead(404).end()
        return
      }
      if (req.method === 'GET') {
        res.writeHead(405).end()
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
              serverInfo: { name: 'ping-extra-fixture', version: '1' }
            }
          : body.method === 'tools/list'
            ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
            : body.method === 'tools/call'
              ? { content: [{ type: 'text', text: 'usable' }] }
              : body.method === 'ping'
                ? { status: 'ok' }
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
      return window.api.dataApi.request({ id: 'issue-22769-read', method: 'GET', path: '/mcp-servers' })
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
    const enableRequestIndex = requests.length
    await content.getByRole('switch').first().check()
    const startFailure = mainWindow.getByRole('dialog').filter({
      has: mainWindow.getByRole('heading', { name: 'Start failed', exact: true })
    })
    await expect
      .poll(
        async () => {
          if (await startFailure.count()) return `start-failed: ${await startFailure.innerText()}`
          if (await content.getByText('Connected', { exact: true }).first().isVisible()) return 'connected'
          if (await content.getByText('Error', { exact: true }).first().isVisible()) return 'error-state'
          return 'pending'
        },
        { timeout: 30_000 }
      )
      .toBe('connected')
    const tools = content.getByRole('radio', { name: /^Tools/ })
    await expect(tools).toBeVisible({ timeout: 30_000 })
    await tools.click()
    await expect(content.getByText('echo', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(
        () => {
          const enabledRequests = requests.slice(enableRequestIndex)
          return ['ping', 'tools/list'].every((method) =>
            enabledRequests.some((request) => request.rpcMethod === method && request.statusCode === 200)
          )
        },
        { timeout: 30_000 }
      )
      .toBe(true)
    await matchingRows()
    const toolsPath = testInfo.outputPath('mcp-ping-extra-tools.png')
    await mainWindow.screenshot({ path: toolsPath })
    await testInfo.attach('MCP ping extra fields tools', { path: toolsPath, contentType: 'image/png' })
  } finally {
    try {
      try {
        const rows = await matchingRows()
        if (!serverId) serverId = rows[0]?.id
      } finally {
        const journalPath = testInfo.outputPath('mcp-ping-extra-journal.json')
        await writeFile(journalPath, JSON.stringify({ persisted, requests }, null, 2))
        await testInfo.attach('Ping extra fields journal', { path: journalPath, contentType: 'application/json' })
      }
    } finally {
      try {
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
  }
})
