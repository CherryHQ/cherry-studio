import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { evaluateCdpExpression } from '../../../../scripts/e2e/regression/cdpClient'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { assertOwnedProcess, findListeningPid, MAIN_INSPECTOR_PORT } from '../../../../scripts/e2e/regression/process'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function networkProxySettings(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const keys = ['app.proxy.mode', 'app.proxy.url', 'app.proxy.bypass_rules'] as const
  const previous = await page.evaluate(
    async (keys) =>
      Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await window.api.preference.get(key)]))),
    keys
  )
  const main = async <T>(body: string): Promise<T> => {
    const record = app.record
    assertOwnedProcess(record, record.electronPid, 'electron')
    const inspectArgument = record.args.find((arg) => /^--inspect(?:-brk)?=/.test(arg))
    const inspectorPort = Number(inspectArgument?.split(':').at(-1)?.split('=').at(-1)) || MAIN_INSPECTOR_PORT
    expect(findListeningPid(record.platform, inspectorPort), 'Route inspection must belong to this application').toBe(
      record.electronPid
    )
    const targets = (await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json()) as {
      type: string
      webSocketDebuggerUrl: string
    }[]
    const target = targets.find(({ type }) => type === 'node')
    if (!target) throw new Error('UNCOVERED: owned main-process inspector is unavailable')
    return evaluateCdpExpression<T>(
      target.webSocketDebuggerUrl,
      `(async () => {
      const require = process.mainModule.require.bind(process.mainModule)
      ${body}
    })()`
    )
  }
  // Derive a wildcard rule from this machine's own non-loopback IPv4 so the
  // bypass check does not depend on a 192.168.x.x network being present.
  const lan =
    Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address ?? '127.0.0.1'
  const lanWildcard = `${lan.split('.')[0]}.*`
  const mock = await startMockChatServer()
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const mockPort = Number(new URL(mock.baseUrl).port)
  const requests: { route: string; host: string }[] = []
  const origin = createServer((req, res) => {
    requests.push({ route: 'direct', host: req.headers.host ?? '' })
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (req.url?.startsWith('/v1/')) {
      const upstream = httpRequest(
        { host: '127.0.0.1', port: mockPort, path: req.url, method: req.method, headers: req.headers },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers)
          response.pipe(res)
        }
      )
      upstream.on('error', () => {
        res.writeHead(502)
        res.end()
      })
      req.pipe(upstream)
      return
    }
    res.end('MP112 direct target')
  })
  origin.listen(0, '0.0.0.0')
  await once(origin, 'listening')
  const originPort = (origin.address() as { port: number }).port
  // Only external DNS is controlled; production routing and sockets remain real.
  const tunnels = new Set<Duplex>()
  const proxy = createServer((req, res) => {
    requests.push({ route: 'proxy', host: new URL(req.url!).hostname })
    const upstream = httpRequest({ host: '127.0.0.1', port: originPort, path: '/', method: req.method }, (response) =>
      response.pipe(res)
    )
    upstream.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })
  proxy.on('connect', (req, socket, head) => {
    requests.push({ route: 'proxy', host: req.url!.split(':')[0] })
    tunnels.add(socket)
    socket.once('close', () => tunnels.delete(socket))
    const port = Number(req.url!.split(':').at(-1))
    const upstream = connect(port === mockPort ? mockPort : originPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`
  const providerId = `mp112-${Date.now()}`
  let environmentPrepared = false
  try {
    const seeded = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp112-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP112 network mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const model = await window.api.dataApi.request({
          id: 'mp112-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        return [provider.status, model.status]
      },
      { providerId, modelId: mock.modelId, baseUrl: `http://${lan}:${originPort}/v1` }
    )
    expect(seeded).toEqual([201, 201])
    const modelId = createUniqueModelId(providerId, mock.modelId)
    const chooseMode = async (label: string, value: 'none' | 'custom' | 'system') => {
      await page.locator('#setting-general-proxy-mode').getByRole('combobox').click()
      await page.getByRole('option', { name: label, exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.api.preference.get('app.proxy.mode'))).toBe(value)
    }
    await openSettingsSection(page, 'General')
    const mode = page.locator('#setting-general-proxy-mode').getByRole('combobox')
    await mode.click()
    for (const label of ['System Proxy', 'Custom Proxy', 'No Proxy'])
      await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await chooseMode('No Proxy', 'none')
    await page.reload()
    await openSettingsSection(page, 'General')
    await expect(mode).toHaveText('No Proxy')
    await chooseMode('Custom Proxy', 'custom')
    const address = page.getByPlaceholder('socks5://127.0.0.1:6153', { exact: true })
    await address.fill('http://127.0.0.1:1')
    await address.blur()
    await expect.poll(() => page.evaluate(() => window.api.preference.get('app.proxy.url'))).toBe('http://127.0.0.1:1')
    await screenshot('MP-112 invalid custom proxy saved')
    const failed = await page.evaluate(async (uniqueModelId) => {
      try {
        const result = (await window.api.ipcApi.request('ai.provider.model.check', {
          uniqueModelId,
          timeout: 5000
        })) as IpcResult<{ latency: number }>
        return result.ok ? { failed: false, message: '' } : { failed: true, message: result.error.message }
      } catch (error) {
        return { failed: true, message: error instanceof Error ? error.message : String(error) }
      }
    }, modelId)
    expect(failed.failed, 'An invalid proxy must fail the real model call').toBe(true)
    expect(failed.message).toMatch(/proxy|connect|fetch|network|ECONNREFUSED/i)
    await testInfo.attach('MP-112 readable model connection error', { body: failed.message, contentType: 'text/plain' })
    expect(await page.evaluate(async (url) => (await fetch(url)).text(), `http://127.0.0.1:${originPort}/`)).toBe(
      'MP112 direct target'
    )
    // Bypass rules are a Custom Proxy field. Set them while that mode is active; the saved
    // preference outlives a round trip through System Proxy mode.
    const bypass = page.getByPlaceholder('localhost,127.0.0.1,::1', { exact: true })
    await expect(bypass, 'Custom Proxy exposes its bypass rules field').toBeVisible()
    await bypass.fill(`*.test.com,${lanWildcard}`)
    await bypass.blur()
    await expect
      .poll(() => page.evaluate(() => window.api.preference.get('app.proxy.bypass_rules')))
      .toBe(`*.test.com,${lanWildcard}`)
    await screenshot('MP-112 wildcard bypass rules saved in Custom Proxy mode')
    await chooseMode('System Proxy', 'system')
    const [recovered] = await Promise.all([
      page.evaluate(
        (uniqueModelId) =>
          window.api.ipcApi.request('ai.provider.model.check', { uniqueModelId, timeout: 10000 }) as Promise<
            IpcResult<{ latency: number }>
          >,
        modelId
      ),
      mock.nextRequest().then((request) => {
        expect(request.body.model).toBe(mock.modelId)
        request.complete('MP112 restored')
      })
    ])
    expect(recovered.ok, 'System proxy must restore a successful model call').toBe(true)
    await screenshot('MP-112 system proxy restored')
    await page.reload()
    await openSettingsSection(page, 'General')
    await expect(mode).toHaveText('System Proxy')
    // The bypass field is Custom-only, so System Proxy must not render it; the saved rules
    // still have to survive the mode switch.
    await expect(
      page.locator('[data-ui~="settings.content"]').getByText('Bypass Rules', { exact: true }),
      'System Proxy mode must hide the Custom-only bypass field'
    ).toBeHidden({ timeout: 3000 })
    await expect
      .poll(() => page.evaluate(() => window.api.preference.get('app.proxy.bypass_rules')))
      .toBe(`*.test.com,${lanWildcard}`)
    await main(`
      const dns = require('node:dns')
      globalThis.__mp112 = { lookup: dns.lookup }
      dns.lookup = function(host, options, callback) {
        if (!['mp112.test.com', 'mp112-public.example.com'].includes(host))
          return globalThis.__mp112.lookup.apply(this, arguments)
        const cb = typeof options === 'function' ? options : callback
        queueMicrotask(() => options?.all ? cb(null, [{ address: ${JSON.stringify(lan)}, family: 4 }]) : cb(null, ${JSON.stringify(lan)}, 4))
      }
    `)
    environmentPrepared = true
    await chooseMode('Custom Proxy', 'custom')
    await address.fill(proxyUrl)
    await address.blur()
    await expect.poll(() => page.evaluate(() => window.api.preference.get('app.proxy.url'))).toBe(proxyUrl)
    await screenshot('MP-112 wildcard bypass rules saved')
    for (const [host, expected] of [
      ['mp112.test.com', 'direct'],
      [lan, 'direct'],
      ['mp112-public.example.com', 'proxy']
    ] as const) {
      requests.length = 0
      const url = `http://${host}:${originPort}/`
      const result = await main<string>(
        `return await (await fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(5000) })).text()`
      )
      expect(result).toBe('MP112 direct target')
      expect(
        requests.some((request) => request.route === 'proxy'),
        `${host} must use ${expected}`
      ).toBe(expected === 'proxy')
      await testInfo.attach(`MP-112 route ${host}`, { body: JSON.stringify(requests), contentType: 'application/json' })
    }
    await screenshot('MP-112 wildcard routing verified')
  } finally {
    if (environmentPrepared)
      await main(`
      require('node:dns').lookup = globalThis.__mp112.lookup
      delete globalThis.__mp112
    `)
    await page.evaluate(
      async ({ previous, providerId }) => {
        await window.api.preference.setMultiple(previous)
        await window.api.dataApi.request({ id: 'mp112-cleanup', method: 'DELETE', path: '/providers/' + providerId })
      },
      { previous, providerId }
    )
    await mock.close()
    for (const socket of tunnels) socket.destroy()
    proxy.closeAllConnections()
    origin.closeAllConnections()
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => origin.close(() => resolve()))
    ])
  }
}
