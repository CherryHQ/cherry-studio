import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { expect, test } from './fixtures/electron.fixture'

test('crash recovery and user-invoked reset of a blocked page preserve the browser session', async ({
  electronApp,
  mainWindow: page
}, testInfo) => {
  test.setTimeout(180_000)
  expect(process.env.CS_DEV_PROFILE_ROOT, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const marker = `CHERRY_23244_${token}_ONE`
  const server = createServer((req, res) => {
    const second = req.url?.startsWith('/two')
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(
      `<html><head><title>Probe page ${second ? 'two' : 'one'}</title></head><body>${second ? `CHERRY_23244_${token}_TWO` : marker}</body></html>`
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const url = `${base}/one`
  const agentName = `recovery-agent-${token}`
  const sessionName = `recovery-session-${token}`
  const providerId = `recovery-provider-${token}`
  try {
    await page.waitForSelector('#root')
    const settle = () =>
      page.evaluate(async () => {
        await window.api.preference.set('app.language', 'en-US')
        await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
        await window.api.preference.set('app.privacy.policy_version', '20260820')
      })
    await settle()
    if (await page.locator('[data-onboarding-language-select]').count()) {
      await page
        .getByRole('button', { name: 'Set up later', exact: true })
        .click()
        .catch(() => {})
    }
    await page.reload()
    await settle()
    await page.evaluate(() => window.api.preference.set('app.browser.agent_control.enabled', true))
    const seeded = await page.evaluate(
      async ({ providerId, agentName, sessionName, base }) => {
        const provider = await window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: providerId,
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: `${base}/v1` } },
            apiKeys: [{ id: 'probe-key', key: 'probe-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId: 'probe-model', endpointTypes: ['openai-chat-completions'] }]
        })
        const agent = (await window.api.ipcApi.request('ai.agent.create', {
          type: 'pi',
          name: agentName,
          model: `${providerId}::probe-model`,
          instructions: 'Answer briefly without using tools.'
        })) as { ok: boolean; data: { id: string } }
        if (!agent.ok) throw new Error('Agent creation failed')
        const session = await window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId: agent.data.id, name: sessionName, workspace: { type: 'system' } }
        })
        return [provider.status, enabled.status, model.status, session.status]
      },
      { providerId, agentName, sessionName, base }
    )
    expect(seeded).toEqual([201, 200, 201, 201])

    await page.getByRole('button', { name: 'Work', exact: true }).first().click()
    const view = page.locator('[data-ui~="agent.view"]').filter({ visible: true }).first()
    await expect(view).toBeVisible()
    const agentHeader = view.getByText(agentName, { exact: true }).first()
    await agentHeader.click()
    const conversation = view.getByText(sessionName, { exact: true }).first()
    if (!(await conversation.isVisible())) {
      await agentHeader.hover()
      await view
        .getByRole('button', { name: agentName, exact: true })
        .first()
        .locator('..')
        .getByRole('button', { name: 'Expand', exact: true })
        .click()
    }
    await conversation.click()
    const browser = view.getByRole('button', { name: 'Browser', exact: true }).first()
    await expect(browser).toBeVisible()
    if ((await browser.getAttribute('aria-pressed')) !== 'true') await browser.click()
    const pane = page.locator('[data-right-pane][data-right-pane-mode="docked"]')
    await expect(pane).toBeVisible()
    const guest = page.locator('[data-testid="webview-browser-guest"]').first()
    await expect(guest).toBeAttached()
    const address = page.locator('[data-right-pane] input[aria-label="Web address"]').first()
    await expect(address).toBeEnabled({ timeout: 30_000 })
    await address.fill(url)
    await address.press('Enter')
    const waitForMarker = () =>
      guest.evaluate(
        (el, marker) =>
          new Promise<void>((resolve, reject) => {
            const check = () =>
              (el as Electron.WebviewTag)
                .executeJavaScript('document.body.innerText')
                .then((text: unknown) => (String(text).includes(marker) ? resolve() : setTimeout(check, 200)))
                .catch(reject)
            check()
          }),
        marker
      )
    await waitForMarker()
    const id = () => guest.evaluate((el) => (el as Electron.WebviewTag).getWebContentsId())
    const state = (oldId: number, newId: number) =>
      electronApp.evaluate(
        ({ webContents }, ids) => {
          const current = webContents.fromId(ids.newId)
          return {
            oldExists: !!webContents.fromId(ids.oldId),
            type: current?.getType(),
            url: current?.getURL(),
            partition: current?.session.storagePath
          }
        },
        { oldId, newId }
      )
    const screenshot = async (name: string) =>
      testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
    const firstId = await id()
    const initial = await electronApp.evaluate(({ webContents }, id) => {
      const current = webContents.fromId(id)
      return { type: current?.getType(), partition: current?.session.storagePath }
    }, firstId)
    expect(initial.type).toBe('webview')
    const reason = await electronApp.evaluate(async ({ webContents }, id) => {
      const current = webContents.fromId(id)
      if (!current || current.getType() !== 'webview') throw new Error('Expected a webview')
      const gone = new Promise<string>((resolve) =>
        current.once('render-process-gone', (_event, details) => resolve(details.reason))
      )
      current.forcefullyCrashRenderer()
      return gone
    }, firstId)
    expect(['killed', 'crashed']).toContain(reason)
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('This page stopped unexpectedly.')
    await expect(alert.getByRole('button')).toBeEnabled()
    await expect(pane.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled()
    await expect(pane.getByRole('button', { name: 'Back', exact: true })).toBeDisabled()
    await expect(pane.getByRole('button', { name: 'Forward', exact: true })).toBeDisabled()
    await expect(pane.getByRole('button', { name: /annotat/i }).first()).toBeDisabled()
    expect(await id()).toBe(firstId)
    await screenshot('crashed')
    await alert.getByRole('button').click()
    await expect
      .poll(async () => {
        try {
          return await id()
        } catch {
          return firstId
        }
      })
      .not.toBe(firstId)
    const secondId = await id()
    await waitForMarker()
    await expect(alert).toHaveCount(0)
    expect(await state(firstId, secondId)).toEqual({
      oldExists: false,
      type: 'webview',
      url,
      partition: initial.partition
    })
    // The overlay requires a guest and a tabId returned after main validates and binds it to the Agent session.
    await expect(page.getByTestId('browser-cursor-overlay')).toBeAttached()
    await screenshot('recovered')

    await pane.getByRole('button', { name: 'Reload', exact: true }).click()
    await waitForMarker()
    expect(await id()).toBe(secondId)
    await expect(alert).toHaveCount(0)

    const blocked = await electronApp.evaluate(async ({ webContents }, id) => {
      const current = webContents.fromId(id)
      if (!current || current.getType() !== 'webview') throw new Error('Expected a webview')
      current
        .executeJavaScript('(() => { const t = Date.now(); while (Date.now() - t < 60000) {} return "done" })()')
        .catch(() => {})
      return Promise.race([
        current.executeJavaScript('1').then(() => 'responsive'),
        new Promise<string>((resolve) => setTimeout(() => resolve('blocked'), 5000))
      ])
    }, secondId)
    expect(blocked).toBe('blocked')
    await screenshot('blocked')
    await pane.getByRole('button', { name: 'Reset page', exact: true }).click()
    await expect
      .poll(async () => {
        try {
          return await id()
        } catch {
          return secondId
        }
      })
      .not.toBe(secondId)
    const thirdId = await id()
    await waitForMarker()
    expect(await state(secondId, thirdId)).toEqual({
      oldExists: false,
      type: 'webview',
      url,
      partition: initial.partition
    })
    await expect(page.getByTestId('browser-cursor-overlay')).toBeAttached()
    await screenshot('reset')
    await browser.click()
    await expect(pane).toBeHidden()
    await browser.click()
    await expect(pane).toBeVisible()
    expect(await id()).toBe(thirdId)
    await waitForMarker()
    await expect(alert).toHaveCount(0)
    await page.waitForTimeout(800)
    await screenshot('reopened')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
