import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

import { openApp, phase } from './helpers'

test(`dark theme survives an Electron restart (${phase})`, async ({ app, agent, browser, screen }) => {
  await openApp(app, browser)
  if (phase === 'write') {
    await agent.act('Open Settings, then Appearance. Set the appearance/theme to Dark using its theme selector.', {
      timeout: 120_000
    })
  }
  await expect.poll(() => browser.evaluate(() => window.api.preference.get('ui.theme_mode'))).toBe('dark')
  await expect(screen.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(browser.locator('html')).toHaveAttribute('class', /dark/)
  await app.screenshot(`dark-theme-${phase}`)
})
