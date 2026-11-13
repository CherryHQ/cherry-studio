import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { WebviewTag } from 'electron'

import { AgentEntitySchema } from '@shared/data/api/schemas/agents'
import { AgentSessionEntitySchema } from '@shared/data/api/schemas/agentSessions'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { expect, test } from '../fixture'
import { selectSidebarApp } from '../helpers/navigation'
import { openSettingsSection } from '../helpers/settings'

test(...caseDefinition('MP-122'), async ({ mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  let requests = 0
  const server = createServer((request, response) => {
    if (request.url === '/unavailable') {
      request.socket.destroy()
      return
    }
    const count = ++requests
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
      response.end(`<title>MP-122 navigation fixture</title><h1>MP-122 request ${count}</h1>`)
    }, 1000)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const content = page.locator('[data-ui~="app.content"]')
  const guest = () => content.getByTestId('webview-browser-guest').filter({ visible: true })
  const readGuest = () =>
    guest().evaluate(async (element) => {
      const webview = element as WebviewTag
      return {
        url: webview.getURL(),
        title: webview.getTitle(),
        text: await webview.executeJavaScript('document.body.innerText')
      }
    })
  const address = () => content.getByRole('combobox', { name: 'Web address', exact: true }).filter({ visible: true })
  const navigate = async (url: string) => {
    await address().fill(url)
    await address().press('Enter')
  }

  try {
    await page.evaluate(
      (url) =>
        window.api.ipcApi.request('navigation.open_route_in_main', {
          path: `/app/browser?url=${encodeURIComponent(url)}`
        }),
      `${baseUrl}/start`
    )
    await expect(page.getByRole('status').filter({ hasText: 'Loading page' })).toBeVisible()
    await attachScreenshot('MP-122 browser loading')
    await expect(address()).toBeEnabled()
    await expect.poll(readGuest).toMatchObject({ url: `${baseUrl}/start`, title: 'MP-122 navigation fixture' })

    // The public site is loaded over the network; only navigation fixtures are served locally.
    await navigate('example.com')
    await expect.poll(readGuest, { timeout: 60_000 }).toMatchObject({
      url: 'https://example.com/',
      title: 'Example Domain',
      text: expect.stringContaining('This domain is for use in documentation examples')
    })
    await expect(address()).toHaveAttribute('title', 'https://example.com/')
    await attachScreenshot('MP-122 example.com loaded')

    await navigate(`${baseUrl}/second`)
    await expect.poll(readGuest).toMatchObject({ url: `${baseUrl}/second`, title: 'MP-122 navigation fixture' })
    const back = page.getByRole('button', { name: 'Back', exact: true }).filter({ visible: true }).last()
    const forward = page.getByRole('button', { name: 'Forward', exact: true }).filter({ visible: true }).last()
    await expect(back).toBeEnabled()
    await back.click()
    await expect.poll(readGuest).toMatchObject({ url: 'https://example.com/', title: 'Example Domain' })
    await expect(forward).toBeEnabled()
    await forward.click()
    await expect.poll(readGuest).toMatchObject({ url: `${baseUrl}/second`, title: 'MP-122 navigation fixture' })
    await expect(forward).toBeDisabled()
    const beforeReload = Number((await readGuest()).text.match(/MP-122 request (\d+)/)?.[1])
    expect(beforeReload).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Reload', exact: true }).filter({ visible: true }).last().click()
    await expect
      .poll(async () => Number((await readGuest()).text.match(/MP-122 request (\d+)/)?.[1]))
      .toBeGreaterThan(beforeReload)
    await expect.poll(readGuest).toMatchObject({ url: `${baseUrl}/second`, title: 'MP-122 navigation fixture' })

    await navigate('http://[')
    await expect(page.getByText('Enter a valid HTTP, HTTPS, or file URL', { exact: true })).toBeVisible()
    expect((await readGuest()).url).toBe(`${baseUrl}/second`)
    await attachScreenshot('MP-122 invalid address rejected')
    await address().press('Escape')

    await openSettingsSection(page, 'Browser')
    await page.getByRole('button', { name: 'Manage History', exact: true }).click()
    const history = page.getByRole('dialog', { name: 'History', exact: true })
    await history.getByRole('searchbox', { name: 'Search', exact: true }).fill('example.com')
    const visit = history.getByRole('button', { name: 'Example Domain', exact: true }).first()
    await expect(visit).toBeVisible()
    await attachScreenshot('MP-122 visited site found in history')
    await visit.click()
    await expect(history).toBeHidden()
    await expect.poll(readGuest, { timeout: 60_000 }).toMatchObject({
      url: 'https://example.com/',
      title: 'Example Domain',
      text: expect.stringContaining('This domain is for use in documentation examples')
    })

    await navigate(`${baseUrl}/unavailable`)
    const failure = page.getByRole('alert').filter({ hasText: 'Failed to load the page' })
    await expect(failure).toBeVisible()
    await attachScreenshot('MP-122 unavailable page displays error')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test(...caseDefinition('MP-123'), async ({ mainWindow: page }, testInfo) => {
  test.setTimeout(180_000)
  // Only website content is a fixture; annotation selection, pins, export and clearing use the real app.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><html><head><title>MP-123 Annotation fixture</title>
      <style>body{font:20px sans-serif;padding:32px}h1,button{display:block;width:100%;max-width:420px;
      box-sizing:border-box;padding:20px;margin:0 0 80px}button{font:inherit}</style></head>
      <body><h1 id="heading">Annotation heading</h1>
      <button id="action" onclick="document.querySelector('#result').textContent='Clicked successfully'">
      Interactive action</button><p id="result">Not clicked</p></body></html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Annotation fixture has no port')
  const url = `http://127.0.0.1:${address.port}/`
  const guest = page.getByTestId('webview-browser-guest').filter({ visible: true })
  const editor = page.getByLabel('Describe what should change or what you noticed…', { exact: true })
  const annotationDialog = page.getByRole('dialog').filter({ has: editor })
  const save = annotationDialog.getByRole('button', { name: 'Save', exact: true })
  const readGuest = (script: string) =>
    guest.evaluate((element, script) => (element as WebviewTag).executeJavaScript(script), script)
  const clickElement = async (id: string, pin = false) => {
    const rect = (await readGuest(
      `document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().toJSON()`
    )) as {
      x: number
      y: number
      width: number
      height: number
    }
    // Electron guest input must go to its own webContents rather than the host's CDP input target.
    await guest.evaluate(
      (element, point) => {
        const webview = element as WebviewTag
        webview.sendInputEvent({ type: 'mouseMove', ...point })
        webview.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        webview.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
      },
      { x: Math.round(rect.x + (pin ? 1 : rect.width / 2)), y: Math.round(rect.y + (pin ? 1 : rect.height / 2)) }
    )
  }
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const annotations = [
    { id: 'heading', text: 'Annotation heading', tag: 'h1', note: 'Make this heading clearer.' },
    { id: 'action', text: 'Interactive action', tag: 'button', note: 'Explain what this action does.' }
  ]
  let sessionId: string | undefined

  try {
    const agents = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'MP-123-agents', method: 'GET', path: '/agents', params: { limit: 200 } })
    )
    expect(agents.status).toBe(200)
    const agent = AgentEntitySchema.parse((agents.data as { items: unknown[] }).items[0])
    const session = await page.evaluate(
      (agentId) =>
        window.api.dataApi.request({
          id: 'MP-123-session',
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name: 'MP-123 Annotation', workspace: { type: 'system' } }
        }),
      agent.id
    )
    expect(session.status).toBe(201)
    sessionId = AgentSessionEntitySchema.parse(session.data).id
    const opened = await page.evaluate(
      (sessionId) =>
        window.api.ipcApi.request('navigation.open_route_in_main', {
          path: `/app/agents?sessionId=${sessionId}`
        }) as Promise<IpcResult<OutputFor<'navigation.open_route_in_main'>>>,
      sessionId
    )
    expect(opened.ok).toBe(true)
    await page.getByRole('button', { name: 'Browser', exact: true }).click()
    const maximize = page.getByRole('button', { name: 'Maximize', exact: true })
    const minimize = page.getByRole('button', { name: 'Minimize', exact: true })
    await expect(maximize.or(minimize)).toBeVisible()
    if (await maximize.isVisible()) await maximize.click()
    await expect(minimize).toBeVisible()
    const webAddress = page.getByRole('combobox', { name: 'Web address', exact: true })
    await webAddress.fill(url)
    await webAddress.press('Enter')
    await expect(guest).toBeVisible()
    await expect.poll(() => readGuest('document.title')).toBe('MP-123 Annotation fixture')
    await page.getByRole('button', { name: 'Annotate page', exact: true }).click()

    for (const [index, annotation] of annotations.entries()) {
      await clickElement(annotation.id)
      await expect(editor).toBeVisible()
      await editor.fill(annotation.note)
      await save.click()
      await expect(editor).toBeHidden()
      await expect(
        page.getByRole('button', { name: `Stop annotating, ${index + 1} annotation${index ? 's' : ''}`, exact: true })
      ).toHaveAttribute('aria-pressed', 'true')
    }
    expect(await readGuest('document.getElementById("result").textContent')).toBe('Not clicked')
    await screenshot('MP-123 two saved annotation pins and count')

    // Pins live in a closed shadow root; a real click at each element's corner must reopen its saved note.
    for (const annotation of annotations) {
      await clickElement(annotation.id, true)
      await expect(editor).toHaveText(annotation.note)
      await expect(annotationDialog.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
      await annotationDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(editor).toBeHidden()
    }

    await page.getByRole('button', { name: 'Copy annotations as Markdown', exact: true }).click()
    await expect(page.getByText('Annotations copied', { exact: true })).toBeVisible()
    const markdown = await page.evaluate(() => navigator.clipboard.readText())
    expect(markdown).toContain(url)
    expect(markdown.match(/^### \d+\. Annotation$/gm)).toHaveLength(2)
    for (const [index, annotation] of annotations.entries()) {
      const section = markdown.split(`### ${index + 1}. Annotation`)[1].split(/^### /m)[0]
      expect(section).toContain(annotation.note)
      expect(section).toContain(annotation.text)
      expect(section).toContain(`<${annotation.tag}>`)
      expect(section).toContain(`#${annotation.id}`)
    }
    await testInfo.attach('MP-123 copied Markdown', { body: markdown, contentType: 'text/markdown' })

    const clear = page.getByRole('button', { name: 'Clear annotations', exact: true })
    const confirmation = page.getByRole('dialog', { name: 'Clear all annotations?', exact: true })
    await clear.click()
    await expect(confirmation).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Stop annotating, 2 annotations', exact: true, includeHidden: true })
    ).toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(confirmation).toBeHidden()
    await expect(page.getByRole('button', { name: 'Stop annotating, 2 annotations', exact: true })).toBeVisible()
    await clear.click()
    await screenshot('MP-123 clear all confirmation')
    await confirmation.getByRole('button', { name: 'Clear annotations', exact: true }).click()
    await expect(confirmation).toBeHidden()
    const stop = page.getByRole('button', { name: 'Stop annotating', exact: true })
    await expect(stop).toHaveAttribute('aria-pressed', 'true')
    await expect(clear).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Copy annotations as Markdown', exact: true })).toHaveCount(0)
    for (const annotation of annotations) {
      await clickElement(annotation.id, true)
      await expect(editor).toBeEmpty()
      await expect(save).toBeDisabled()
      await expect(annotationDialog.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
      await annotationDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(editor).toBeHidden()
    }
    await stop.click()
    await expect(page.getByRole('button', { name: 'Annotate page', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await clickElement('action')
    await expect.poll(() => readGuest('document.getElementById("result").textContent')).toBe('Clicked successfully')
    await expect(editor).toBeHidden()
    await screenshot('MP-123 annotations cleared and page interaction restored')
  } catch (error) {
    await screenshot('MP-123 annotation failure before cleanup')
    await testInfo.attach('MP-123 guest state', {
      body: JSON.stringify(
        await guest.evaluate((element) => {
          const webview = element as WebviewTag
          return { url: webview.getURL(), loading: webview.isLoading(), preload: webview.getAttribute('preload') }
        })
      ),
      contentType: 'application/json'
    })
    throw error
  } finally {
    await page.keyboard.press('Escape')
    await selectSidebarApp(page, 'Chat')
    if (sessionId)
      await page.evaluate(
        (sessionId) =>
          window.api.dataApi.request({
            id: 'MP-123-cleanup',
            method: 'DELETE',
            path: `/agent-sessions/${sessionId}`
          }),
        sessionId
      )
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test(...caseDefinition('MP-125'), async ({ mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  // Only the HTTP fixture is controlled; errors and recovery come from the real Electron webview.
  let generation = 'initial'
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
    response.end(`<title>MP-125 local service</title><h1>MP-125 service ${generation}</h1>`)
  })
  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
  const stop = async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
  await listen(0)
  const port = (server.address() as AddressInfo).port
  const url = `http://127.0.0.1:${port}/local-service`
  const content = page.locator('[data-ui~="app.content"]')
  const address = content.getByRole('combobox', { name: 'Web address', exact: true }).filter({ visible: true })
  const reload = content.getByRole('button', { name: 'Reload', exact: true }).filter({ visible: true })
  const failure = content.getByRole('alert').filter({ hasText: 'Failed to load the page' })
  const loading = content.getByRole('status').filter({ hasText: 'Loading page' })
  const guest = content.getByTestId('webview-browser-guest').filter({ visible: true })
  const readGuest = () =>
    guest.evaluate(async (element) => {
      const webview = element as WebviewTag
      return { url: webview.getURL(), text: await webview.executeJavaScript('document.body.innerText') }
    })

  try {
    await test.step('Unreachable address shows a usable failure state and retry entry', async () => {
      await page.evaluate(() =>
        window.api.ipcApi.request('navigation.open_route_in_main', {
          path: `/app/browser?url=${encodeURIComponent('http://127.0.0.1:9/')}`
        })
      )
      await expect(address).toHaveAttribute('title', 'http://127.0.0.1:9/')
      await expect(failure).toBeVisible()
      await expect(loading).toBeHidden()
      await expect(address).toBeEditable()
      await expect(reload).toBeEnabled()
      await attachScreenshot('MP-125 unreachable address with retry entry')
      await reload.click()
      await expect(failure).toBeVisible()
      await expect(loading).toBeHidden()
    })

    await test.step('Stopping the loaded local service shows the local-server guidance on refresh', async () => {
      await address.focus()
      await address.fill(url)
      await expect(address).toHaveValue(url)
      await address.press('Enter')
      await expect.poll(readGuest).toEqual({ url, text: 'MP-125 service initial' })
      await expect(failure).toBeHidden()
      await stop()
      await reload.click()
      await expect(failure).toBeVisible()
      await expect(failure).toHaveText('Failed to load the page')
      await expect(loading).toBeHidden()
      await expect(address).toBeEditable()
      await expect(reload).toBeEnabled()
      await attachScreenshot('MP-125 local service disconnected guidance')
    })

    await test.step('Retry loads fresh page content after the same local service is restored', async () => {
      generation = 'restored'
      await listen(port)
      await reload.click()
      await expect(failure).toBeHidden()
      await expect.poll(readGuest).toEqual({ url, text: 'MP-125 service restored' })
      await expect(loading).toBeHidden()
      await expect(address).toHaveAttribute('title', url)
      await attachScreenshot('MP-125 local service recovered after retry')
    })
  } finally {
    if (server.listening) await stop()
  }
})
