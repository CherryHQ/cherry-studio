import { test } from '@e2e-dev/web'
import { expect, unique } from 'e2e'

import { data, openApp } from './helpers'

test('complete onboarding and type in the real desktop chat', async ({ app, agent, browser }) => {
  await openApp(app, browser)
  await agent.act(
    'If provider onboarding appears, click Set up later. Enter {text} in the chat composer without sending it.',
    { params: { text: unique(data.marker) }, timeout: 90_000 }
  )
  await expect(browser.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()).toContainText(
    data.marker
  )
  expect(await browser.evaluate(() => typeof window.api.preference.get)).toBe('function')
  await app.screenshot('startup')
})
