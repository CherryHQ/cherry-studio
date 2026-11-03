import { writeFile } from 'node:fs/promises'

import type { Page } from '@playwright/test'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { expect, test } from '../fixture'
import { openLaunchpad, selectSidebarApp } from '../helpers/navigation'
import { launchpadPinning } from '../scenarios/launchpadPinning'

test(...caseDefinition('MP-130'), async ({ app, mainWindow }, testInfo) => {
  await launchpadPinning(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-131'), async ({ app, mainWindow: page }, testInfo) => {
  test.setTimeout(180_000)
  const menuMode = await page.evaluate(() => window.api.preference.get('menu.presentation_mode'))
  const strip = page.getByTestId('app-shell-tab-strip')
  const tabs = strip.locator('[data-tab-id]')
  const tab = (name: string) => strip.getByRole('button', { name, exact: true }).and(tabs)
  const menu = async (target: ReturnType<typeof tab>, action: string) => {
    await target.click({ button: 'right' })
    await page.getByRole('menuitem', { name: action, exact: true }).click()
  }
  const screenshot = async (window: Page, name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(window, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const chat = page.locator('[data-ui~="chat.view"]:visible')
  const knowledge = page.locator('[data-ui~="knowledge.view"]:visible')
  let child: Page | undefined
  try {
    await page.evaluate(() => window.api.preference.set('menu.presentation_mode', 'cherry'))
    await selectSidebarApp(page, 'Chat')
    // Normalize tabs left by earlier cases through the same close actions users have.
    const normalTabs = tabs.filter({ has: page.getByRole('button', { name: 'Close Tab', exact: true }) })
    if ((await normalTabs.count()) > 1) {
      const retainedId = await normalTabs.first().getAttribute('data-tab-id')
      await menu(strip.locator(`[data-tab-id="${retainedId}"]`), 'Close Other Tabs')
      await expect(normalTabs).toHaveCount(1)
    }
    while ((await tabs.count()) > 1) {
      const id = await tabs.last().getAttribute('data-tab-id')
      await menu(strip.locator(`[data-tab-id="${id}"]`), 'Close Tab')
      await expect(strip.locator(`[data-tab-id="${id}"]`)).toHaveCount(0)
    }
    await menu(tabs.first(), 'Close Tab')
    await expect(tab('Launchpad')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible()

    await selectSidebarApp(page, 'Chat')
    await expect(chat).toBeVisible()
    const chatTab = tabs.last()
    const chatId = await chatTab.getAttribute('data-tab-id')
    expect(chatId).toBeTruthy()
    const pinned = strip.locator(`[data-tab-id="${chatId}"]`)
    await expect(tabs).toHaveCount(1)
    await openLaunchpad(page)
    await selectSidebarApp(page, 'Knowledge Base')
    await expect(knowledge).toBeVisible()
    await selectSidebarApp(page, 'Settings')
    await expect(page.locator('[data-ui~="settings.view"]:visible')).toBeVisible()
    await page.keyboard.press('Control+Shift+Tab')
    await expect(tab('Settings')).toBeVisible()
    await expect(tabs).toHaveCount(3)
    await expect(knowledge).toBeVisible()

    await menu(pinned, 'Pin Tab')
    await expect(pinned).toHaveAttribute('title', /.+/)
    await expect(pinned.getByRole('button', { name: 'Close Tab', exact: true })).toHaveCount(0)
    await pinned.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Unpin Tab', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await pinned.click({ button: 'middle' })
    await pinned.dblclick()
    await expect(pinned).toBeVisible()
    await expect(tabs).toHaveCount(3)
    await expect(chat).toBeVisible()
    await screenshot(page, 'MP-131 pinned chat with knowledge and settings tabs')

    await menu(tab('Knowledge Base'), 'Close Tabs to the Right')
    await expect(tab('Settings')).toHaveCount(0)
    await expect(pinned).toBeVisible()
    await expect(tab('Knowledge Base')).toBeVisible()
    await expect(tabs).toHaveCount(2)
    await openLaunchpad(page)
    await selectSidebarApp(page, 'Translation')
    await expect(tab('Translate')).toBeVisible()
    await menu(tab('Knowledge Base'), 'Close Other Tabs')
    await expect(tab('Translate')).toHaveCount(0)
    await expect(tabs).toHaveCount(2)
    await expect(pinned).toBeVisible()
    await expect(knowledge).toBeVisible()

    const knowledgeId = await tab('Knowledge Base').getAttribute('data-tab-id')
    expect(knowledgeId).toBeTruthy()
    const knowledgeContent = await knowledge.innerText()
    await menu(tab('Knowledge Base'), 'Open in New Window')
    child = await app.window('/windows/subWindow/', knowledgeId!)
    await expect(child.locator('[data-ui~="knowledge.view"]:visible')).toBeVisible()
    await expect(child.locator('[data-ui~="knowledge.view"]:visible')).toHaveText(knowledgeContent, {
      useInnerText: true
    })
    await expect(child.getByRole('button', { name: 'Back to Main Window', exact: true })).toBeVisible()
    await expect(tab('Knowledge Base')).toHaveCount(0)
    await expect(tabs).toHaveCount(1)
    await pinned.click()
    await expect(chat).toBeVisible()
    await screenshot(child, 'MP-131 knowledge base in independent window')
    await child.getByRole('button', { name: 'Back to Main Window', exact: true }).click()
    await expect.poll(() => child!.isClosed()).toBe(true)
    await page.bringToFront()
    await expect(knowledge).toBeVisible()
    await expect(tab('Knowledge Base')).toHaveAttribute('data-tab-id', knowledgeId!)
    await expect(tabs).toHaveCount(2)
    await expect(pinned).toBeVisible()
    await expect(pinned.getByRole('button', { name: 'Close Tab', exact: true })).toHaveCount(0)
    await screenshot(page, 'MP-131 knowledge returned and pinned chat preserved')

    await tab('Knowledge Base').hover()
    await tab('Knowledge Base').getByRole('button', { name: 'Close Tab', exact: true }).click()
    await expect(tabs).toHaveCount(1)
    await expect(chat).toBeVisible()
    await menu(pinned, 'Close Tab')
    await expect(tabs).toHaveCount(1)
    await expect(tab('Launchpad')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible()
    await expect(chat).toHaveCount(0)
    await expect(knowledge).toHaveCount(0)
    await expect(page.locator('[data-ui~="settings.view"]:visible')).toHaveCount(0)
    await screenshot(page, 'MP-131 last tab closed falls back to Launchpad')

    await selectSidebarApp(page, 'Chat')
    await expect(chat).toBeVisible()
    await expect(page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()).toBeEditable()
    await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeHidden()
    await expect(tabs).toHaveCount(1)
    await openLaunchpad(page)
    await selectSidebarApp(page, 'Knowledge Base')
    await expect(knowledge).toBeVisible()
    await expect(tabs).toHaveCount(2)
    await screenshot(page, 'MP-131 sidebar opens working chat after Launchpad fallback')
  } finally {
    if (child && !child.isClosed()) await child.close()
    await page.evaluate((mode) => window.api.preference.set('menu.presentation_mode', mode), menuMode)
  }
})
