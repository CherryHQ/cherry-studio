import { rm } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'
import type { MessageBoxOptions } from 'electron'

import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    try {
      const app = await electron.launch({
        args: ['.'],
        env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
        timeout: 60000
      })
      try {
        await use(app)
      } finally {
        await app.close().catch(() => {})
      }
    } finally {
      await rm(profile, { recursive: true, force: true }).catch(() => {})
    }
  }
})

type KnowledgeAppLinksRecorder = {
  dialogCalls: MessageBoxOptions[]
  openCalls: string[]
  setResponse: (response: number) => void
  restore: () => void
}

test('assistant markdown knowledge links retain hrefs and require confirmation before opening', async ({
  mainWindow: page,
  electronApp
}, testInfo) => {
  const topicName = `Knowledge app links ${Date.now()}`
  let assistantId: string | undefined
  let preferences: Awaited<ReturnType<typeof readPreferences>> | undefined
  async function readPreferences() {
    return page.evaluate(async () => ({
      'app.browser.open_links_in_browser': await window.api.preference.get('app.browser.open_links_in_browser'),
      'app.language': await window.api.preference.get('app.language'),
      'app.onboarding.provider_setup.status': await window.api.preference.get('app.onboarding.provider_setup.status'),
      'app.privacy.policy_version': await window.api.preference.get('app.privacy.policy_version'),
      'chat.message.style': await window.api.preference.get('chat.message.style')
    }))
  }
  await electronApp.evaluate(({ dialog, shell }) => {
    const originalShowMessageBox = dialog.showMessageBox
    const originalOpenExternal = shell.openExternal
    const dialogCalls: MessageBoxOptions[] = []
    const openCalls: string[] = []
    let currentResponse = 1
    Object.assign(globalThis, {
      knowledgeAppLinksRecorder: {
        dialogCalls,
        openCalls,
        setResponse: (response: number) => {
          currentResponse = response
        },
        restore: () => {
          dialog.showMessageBox = originalShowMessageBox
          shell.openExternal = originalOpenExternal
        }
      }
    })
    dialog.showMessageBox = async (
      optionsOrWindow: Electron.BaseWindow | MessageBoxOptions,
      options?: MessageBoxOptions
    ) => {
      dialogCalls.push(options ?? (optionsOrWindow as MessageBoxOptions))
      return { response: currentResponse, checkboxChecked: false }
    }
    shell.openExternal = async (url) => {
      openCalls.push(url)
    }
  })
  const recordedCalls = () =>
    electronApp.evaluate(() => {
      const { dialogCalls, openCalls } = (
        globalThis as typeof globalThis & {
          knowledgeAppLinksRecorder: KnowledgeAppLinksRecorder
        }
      ).knowledgeAppLinksRecorder
      return { dialogCalls, openCalls }
    })
  const setResponse = (response: number) =>
    electronApp.evaluate((_, response) => {
      const state = globalThis as typeof globalThis & {
        knowledgeAppLinksRecorder: KnowledgeAppLinksRecorder
      }
      state.knowledgeAppLinksRecorder.setResponse(response)
    }, response)
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await page.screenshot({ path })
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  try {
    preferences = await readPreferences()
    await page.evaluate(
      (policyVersion) =>
        window.api.preference.setMultiple({
          'app.browser.open_links_in_browser': false,
          'app.language': 'en-US',
          'app.onboarding.provider_setup.status': 'skipped',
          'app.privacy.policy_version': policyVersion,
          'chat.message.style': 'plain'
        }),
      LATEST_PRIVACY_POLICY_VERSION
    )
    assistantId = await page.evaluate(
      async ({ topicName }) => {
        const assistantResponse = await window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/assistants',
          body: { name: topicName }
        })
        if (assistantResponse.error) throw new Error(assistantResponse.error.message)
        const assistant = assistantResponse.data as { id: string }
        const topicResponse = await window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/topics',
          body: { name: topicName, assistantId: assistant.id }
        })
        if (topicResponse.error) throw new Error(topicResponse.error.message)
        const topic = topicResponse.data as { id: string }
        const text = [
          'Open the PDF: [Zotero PDF](zotero://open-pdf/library/items/ABCD1234)',
          'Open the note: [Obsidian note](obsidian://open?vault=Research&file=Note)',
          'Open the block: [SiYuan block](siyuan://blocks/20221031001313-rk7sd0e)',
          'Visit the website: [Example](https://example.com)'
        ].join('\n')
        const message = await window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: `/topics/${topic.id}/messages`,
          body: { role: 'assistant', data: { parts: [{ type: 'text', text }] }, status: 'success' }
        })
        if (message.error) throw new Error(message.error.message)
        return assistant.id
      },
      { topicName }
    )
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const row = page.getByRole('option').filter({ hasText: topicName })
    if (!(await row.isVisible())) {
      await page.getByRole('listbox').getByRole('button', { name: topicName, exact: true }).click()
    }
    await row.click()
    const message = page.locator('[data-ui~="chat.message"]').filter({ hasText: 'Open the PDF:' })
    await expect(message.getByRole('link', { name: 'Zotero PDF', exact: true })).toHaveAttribute(
      'href',
      'zotero://open-pdf/library/items/ABCD1234'
    )
    await expect(message.getByRole('link', { name: 'Obsidian note', exact: true })).toHaveAttribute(
      'href',
      'obsidian://open?vault=Research&file=Note'
    )
    await expect(message.getByRole('link', { name: 'SiYuan block', exact: true })).toHaveAttribute(
      'href',
      'siyuan://blocks/20221031001313-rk7sd0e'
    )
    await screenshot('knowledge-links-rendered')

    await message.getByRole('link', { name: 'Zotero PDF', exact: true }).click()
    await expect.poll(async () => (await recordedCalls()).dialogCalls.length).toBe(1)
    expect((await recordedCalls()).dialogCalls[0]).toMatchObject({
      type: 'warning',
      message: 'Open this link in an external application?',
      detail: 'zotero://open-pdf/library/items/ABCD1234',
      buttons: ['Cancel', 'Open application'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    await expect
      .poll(async () => (await recordedCalls()).openCalls)
      .toEqual(['zotero://open-pdf/library/items/ABCD1234'])
    await screenshot('link-click-dialog')

    await setResponse(0)
    await message.getByRole('link', { name: 'Obsidian note', exact: true }).click()
    await expect.poll(async () => (await recordedCalls()).dialogCalls.length).toBe(2)
    expect((await recordedCalls()).openCalls).toEqual(['zotero://open-pdf/library/items/ABCD1234'])

    await setResponse(1)
    await message.getByRole('link', { name: 'Example', exact: true }).click()
    await expect
      .poll(async () => {
        const { openCalls } = await recordedCalls()
        return (
          openCalls.length === 2 &&
          openCalls[0] === 'zotero://open-pdf/library/items/ABCD1234' &&
          (openCalls[1] === 'https://example.com' || openCalls[1] === 'https://example.com/')
        )
      })
      .toBe(true)
    expect((await recordedCalls()).dialogCalls).toHaveLength(2)
  } finally {
    await electronApp
      .evaluate(() => {
        const state = globalThis as typeof globalThis & { knowledgeAppLinksRecorder?: { restore: () => void } }
        state.knowledgeAppLinksRecorder?.restore()
        delete state.knowledgeAppLinksRecorder
      })
      .catch(() => {})
    if (assistantId)
      await page
        .evaluate(
          (assistantId) =>
            window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true }),
          assistantId
        )
        .catch(() => {})
    if (preferences)
      await page.evaluate((values) => window.api.preference.setMultiple(values), preferences).catch(() => {})
  }
})
