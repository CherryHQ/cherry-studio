import { _electron as electron } from '@playwright/test'
import * as z from 'zod'

import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const test = base.extend({
  electronApp: async ({}, provideApp, testInfo) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'development',
      CS_DEV_PROFILE_ROOT: testInfo.outputPath('profile')
    }
    delete env.ELECTRON_RENDERER_URL
    const app = await electron.launch({
      args: ['.'],
      env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      timeout: 60_000
    })
    try {
      await provideApp(app)
    } finally {
      await app.close()
    }
  }
})

test('Chat tabs display their own topic names and update a background tab after renaming', async ({
  mainWindow: page
}, testInfo) => {
  const firstName = 'Tab title Alpha'
  const secondName = 'Tab title Beta'
  const renamedName = 'Renamed Alpha'

  await page.evaluate(() =>
    window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.onboarding.provider_setup.status': 'skipped',
      'app.privacy.data_collection.enabled': false,
      'feature.quick_assistant.enabled': false,
      'feature.selection.enabled': false,
      'topic.tab.display_mode': 'time'
    })
  )

  const assistant = await page.evaluate(() =>
    window.api.dataApi.request({
      id: 'tab-title-assistant',
      method: 'POST',
      path: '/assistants',
      body: { name: 'Tab title assistant' }
    })
  )
  expect(assistant.status).toBe(201)
  const { id: assistantId } = z.object({ id: z.string() }).parse(assistant.data)
  for (const name of [firstName, secondName]) {
    const topic = await page.evaluate(
      ({ assistantId, name }) =>
        window.api.dataApi.request({
          id: `tab-title-${name}`,
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { assistantId, name }
    )
    expect(topic.status).toBe(201)
  }

  await page.reload()
  await selectSidebarApp(page, 'Chat')
  const topicList = uiLocator(page, 'chat.topic-list').filter({ visible: true })
  const firstRow = topicList.getByTestId('topic-list-row').filter({ hasText: firstName })
  const secondRow = topicList.getByTestId('topic-list-row').filter({ hasText: secondName })
  const tabBar = uiLocator(page, 'app.tab-bar')
  const firstTab = tabBar.getByRole('button', { name: firstName, exact: true })
  const secondTab = tabBar.getByRole('button', { name: secondName, exact: true })

  await firstRow.click()
  await expect(firstTab).toBeVisible()
  await expect(firstTab).toContainText(firstName)

  await secondRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in new tab', exact: true }).click()
  await expect(secondTab).toBeVisible()
  await expect(secondTab).toContainText(secondName)
  await expect(firstTab).toContainText(firstName)

  await firstTab.click()
  await expect(firstTab).toContainText(firstName)
  await secondTab.click()
  await expect(secondTab).toContainText(secondName)

  await firstRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit conversation name', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit conversation name', exact: true })
  await dialog.getByRole('textbox').fill(renamedName)
  await dialog.getByRole('textbox').press('Enter')
  await expect(dialog).not.toBeVisible()

  const renamedTab = tabBar.getByRole('button', { name: renamedName, exact: true })
  await expect(renamedTab).toBeVisible()
  await expect(renamedTab).toContainText(renamedName)
  await expect(firstTab).toHaveCount(0)
  await expect(secondTab).toContainText(secondName)
  await renamedTab.click()
  await expect(renamedTab).toContainText(renamedName)
  await expect(secondTab).toContainText(secondName)
  const screenshot = testInfo.outputPath('conversation-tab-titles.png')
  await page.screenshot({ path: screenshot })
  await testInfo.attach('conversation-tab-titles', { path: screenshot, contentType: 'image/png' })
})
