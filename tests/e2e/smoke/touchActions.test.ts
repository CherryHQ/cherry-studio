import type { Locator } from '@playwright/test'

import { expect, test } from './fixtures/electron.fixture'

// Playwright visibility alone accepts opacity: 0, including transparent ancestors.
async function expectPainted(control: Locator) {
  await expect(control).toBeVisible()
  await expect
    .poll(() =>
      control.evaluate((element) => {
        let opacity = 1
        for (let current: Element | null = element; current; current = current.parentElement) {
          opacity *= Number(getComputedStyle(current).opacity)
        }
        return opacity
      })
    )
    .toBe(1)
}

test('message and conversation actions remain usable without hover', async ({ mainWindow }) => {
  const topicName = `Touch actions ${Date.now()}`
  const question = 'Touch action regression question'
  const historicalAnswer = 'Historical answer for touch actions'
  const preferences = await mainWindow.evaluate(async () => {
    const previous = {
      'app.language': await window.api.preference.get('app.language'),
      'app.onboarding.provider_setup.status': await window.api.preference.get('app.onboarding.provider_setup.status'),
      'chat.message.style': await window.api.preference.get('chat.message.style')
    }
    await window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.onboarding.provider_setup.status': 'skipped',
      'chat.message.style': 'plain'
    })
    return previous
  })
  const assistantId = await mainWindow.evaluate(
    async ({ topicName, question, historicalAnswer }) => {
      const assistantResponse = await window.api.dataApi.request({
        id: crypto.randomUUID(),
        method: 'POST',
        path: '/assistants',
        body: { name: topicName }
      })
      if (assistantResponse.error) throw new Error(assistantResponse.error.message)
      const assistant = assistantResponse.data as { id: string }
      const created = await window.api.dataApi.request({
        id: crypto.randomUUID(),
        method: 'POST',
        path: '/topics',
        body: { name: topicName, assistantId: assistant.id }
      })
      if (created.error) throw new Error(created.error.message)
      const topic = created.data as { id: string }
      for (const [role, text] of [
        ['user', question],
        ['assistant', historicalAnswer],
        ['user', 'Follow-up question'],
        ['assistant', 'Latest answer']
      ]) {
        const response = await window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: `/topics/${topic.id}/messages`,
          body: { role, data: { parts: [{ type: 'text', text }] }, status: 'success' }
        })
        if (response.error) throw new Error(response.error.message)
      }
      return assistant.id
    },
    { topicName, question, historicalAnswer }
  )
  const cdp = await mainWindow.context().newCDPSession(mainWindow)
  const tap = async (control: Locator) => {
    await expectPainted(control)
    await control.scrollIntoViewIfNeeded()
    const bounds = await control.boundingBox()
    if (!bounds) throw new Error('Touch target has no bounds')
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  try {
    await mainWindow.reload()
    await mainWindow.getByRole('button', { name: 'Chat', exact: true }).first().click()
    const row = mainWindow.getByRole('option').filter({ hasText: topicName })
    if (!(await row.isVisible())) {
      await mainWindow.getByRole('listbox').getByRole('button', { name: topicName, exact: true }).click()
    }
    await row.click()
    await expect(mainWindow.getByRole('region', { name: 'Messages', exact: true })).toContainText(question)

    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    expect(await mainWindow.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true)
    await mainWindow.mouse.move(1, 1)

    for (const style of ['plain', 'bubble'] as const) {
      await mainWindow.evaluate((style) => window.api.preference.set('chat.message.style', style), style)
      const message = mainWindow.locator('[data-ui~="chat.message"]').filter({ hasText: question }).first()
      const copy = message.getByRole('button', { name: 'Copy', exact: true })
      await tap(copy)
      await expect.poll(() => mainWindow.evaluate(() => navigator.clipboard.readText())).toBe(question)

      const answer = mainWindow.locator('[data-ui~="chat.message"]').filter({ hasText: historicalAnswer }).first()
      const more = answer.getByRole('button', { name: 'More actions', exact: true })
      await tap(more)
      await expect(mainWindow.getByRole('menu')).toBeVisible()
      await mainWindow.keyboard.press('Escape')
    }

    const pin = row.getByRole('button', { name: 'Pin Conversation', exact: true })
    await expectPainted(pin)
    await expect(pin).toHaveCSS('pointer-events', 'auto')
    await tap(pin)
    const unpin = row.getByRole('button', { name: 'Unpin Conversation', exact: true })
    await tap(unpin)
    await expect(pin).toBeVisible()

    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    expect(await mainWindow.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(true)
    await mainWindow.mouse.move(1, 1)
    await mainWindow.getByRole('button', { name: 'Selected models', exact: true }).focus()
    await expect(pin).toHaveCSS('opacity', '0')
    await row.hover()
    await expectPainted(pin)
    await mainWindow.mouse.move(1, 1)
    await row.focus()
    await mainWindow.keyboard.press('Tab')
    await expect(pin).toBeFocused()
    await expectPainted(pin)
    await mainWindow.keyboard.press('Enter')
    await expect(unpin).toBeVisible()
  } finally {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await cdp.detach()
    await mainWindow.evaluate(
      async ({ assistantId, preferences }) => {
        try {
          const response = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as { ok: boolean; error?: { message: string } }
          if (!response.ok) throw new Error(response.error?.message)
        } finally {
          await window.api.preference.setMultiple(preferences)
        }
      },
      { assistantId, preferences }
    )
  }
})
