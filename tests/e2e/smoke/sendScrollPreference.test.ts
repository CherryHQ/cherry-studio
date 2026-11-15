import { copyFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
  type TestInfo
} from '@playwright/test'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import type { BranchMessagesResponse } from '../../../src/shared/data/types/message'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { type MockChatRequest, type MockChatServer, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { openSettingsSection } from '../regression/helpers/settings'
import { closeElectronApp, expect, test as base } from './fixtures/electron.fixture'

const view = (page: Page) => page.locator('[data-ui~="chat.view"]:visible')
const scroller = (page: Page) => view(page).locator('[data-message-virtual-list-scroller]')
const composer = (page: Page) => view(page).locator('[data-ui~="chat.composer"]:visible')
const editor = (page: Page) =>
  composer(page).locator('[data-ui~="part:composer-input"] [contenteditable="true"]').first()
const pause = (page: Page) => composer(page).locator('[data-ui~="chat.composer.action.pause"]')
const bottomButton = (page: Page) => view(page).getByTestId('message-scroll-to-bottom-button')
const setting = (page: Page) =>
  page.locator('#setting-appearance-scroll-to-bottom-on-send').getByRole('switch', {
    name: en['settings.messages.scroll_to_bottom_on_send.label'],
    exact: true
  })

type Session = { launch: () => Promise<Page> }
type Chat = { page: Page; server: MockChatServer; topicId: string; session: Session }
type Anchor = { element: Locator; offset: number }

const test = base.extend<{ session: Session; chat: Chat }>({
  session: async ({}, runTest, testInfo) => {
    const profile = testInfo.outputPath('profile')
    let app: ElectronApplication | undefined
    const launch = async () => {
      if (app) {
        const previous = app
        app = undefined
        await closeElectronApp(previous)
      }
      const env = { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile }
      Reflect.deleteProperty(env, 'ELECTRON_RENDERER_URL')
      app = await electron.launch({ args: ['.'], env, timeout: 60_000 })
      let page: Page | undefined
      await expect
        .poll(
          () => {
            page = app!.windows().find((window) => /\/windows\/main\/index\.html(?:[?#]|$)/.test(window.url()))
            return Boolean(page)
          },
          { timeout: 60_000 }
        )
        .toBe(true)
      await page!.waitForFunction(() => !!window.api?.preference, undefined, { timeout: 60_000 })
      await page!.bringToFront()
      return page!
    }
    try {
      await runTest({ launch })
    } finally {
      try {
        if (app) await closeElectronApp(app)
      } finally {
        await rm(profile, { recursive: true, force: true })
      }
    }
  },
  chat: async ({ session }, runTest) => {
    const server = await startMockChatServer()
    try {
      const page = await session.launch()
      await page.evaluate(async (policyVersion) => {
        await window.api.preference.setMultiple({
          'app.language': 'en-US',
          'app.onboarding.provider_setup.status': 'skipped',
          'app.privacy.policy_version': policyVersion,
          'chat.message.show_outline': true,
          'chat.narrow_mode': false,
          'topic.naming.enabled': false,
          'chat.input.send_message_shortcut': ['Enter'],
          'chat.input.paste_long_text_as_file': false
        })
      }, LATEST_PRIVACY_POLICY_VERSION)
      await page.reload()
      const providerId = await page.evaluate(
        async ({ baseUrl, modelId }) => {
          const providerId = `send-scroll-${crypto.randomUUID()}`
          const created = await window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'POST',
            path: '/providers',
            body: {
              providerId,
              name: 'Send scroll mock',
              defaultChatEndpoint: 'openai-chat-completions',
              endpointConfigs: { 'openai-chat-completions': { baseUrl } },
              apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
            }
          })
          if (created.status !== 201) throw new Error(JSON.stringify(created))
          const enabled = await window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'PATCH',
            path: `/providers/${providerId}`,
            body: { isEnabled: true }
          })
          if (enabled.status !== 200) throw new Error(JSON.stringify(enabled))
          const models = await window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'POST',
            path: '/models',
            body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
          })
          if (models.status !== 201) throw new Error(JSON.stringify(models))
          return providerId
        },
        { baseUrl: server.baseUrl, modelId: server.modelId }
      )
      const seeded = await page.evaluate(
        async (modelId) => {
          const assistant = await window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'POST',
            path: '/assistants',
            body: { name: 'Send scroll assistant', modelId }
          })
          if (assistant.status !== 201) throw new Error(JSON.stringify(assistant))
          const topic = await window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'POST',
            path: '/topics',
            body: { name: 'Send scroll history', assistantId: (assistant.data as { id: string }).id }
          })
          if (topic.status !== 201) throw new Error(JSON.stringify(topic))
          const id = (topic.data as { id: string }).id
          for (let index = 0; index < 40; index++) {
            const message = await window.api.dataApi.request({
              id: crypto.randomUUID(),
              method: 'POST',
              path: `/topics/${id}/messages`,
              body: {
                role: index % 2 === 0 ? 'user' : 'assistant',
                status: 'success',
                data: {
                  parts: [
                    {
                      type: 'text',
                      text: `History ${index}\n\nA stable historical paragraph for reading.\n\nAnother paragraph with enough height to exercise virtualization.`
                    }
                  ]
                }
              }
            })
            if (message.status !== 201) throw new Error(JSON.stringify(message))
          }
          return id
        },
        createUniqueModelId(providerId, server.modelId)
      )
      await page.reload()
      await openChat(page, seeded)
      await expect.poll(() => scroller(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(1500)
      await runTest({ page, server, topicId: seeded, session })
    } finally {
      await server.close()
    }
  }
})

async function box(locator: Locator) {
  const result = await locator.boundingBox()
  if (!result) throw new Error(`Missing geometry: ${locator}`)
  return result
}

async function openChat(page: Page, topicId: string) {
  await selectSidebarApp(page, 'Chat')
  await page.evaluate(
    (id) =>
      window.api.ipcApi.request('navigation.open_route_in_main', {
        path: `/app/chat?topicId=${id}`
      }),
    topicId
  )
  await expect(editor(page)).toBeEditable()
  await expect(scroller(page)).toHaveCount(1)
}

async function toggle(chat: Chat, enabled: boolean) {
  await openSettingsSection(chat.page, 'Appearance')
  await expect(setting(chat.page)).toBeChecked({ checked: !enabled })
  await setting(chat.page).click()
  await expect(setting(chat.page)).toBeChecked({ checked: enabled })
  await expect
    .poll(() => chat.page.evaluate(() => window.api.preference.get('chat.message.scroll_to_bottom_on_send')))
    .toBe(enabled)
  await openChat(chat.page, chat.topicId)
}

async function atBottom(page: Page) {
  await expect
    .poll(() => scroller(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThanOrEqual(24)
}

async function goBottom(page: Page) {
  if (await bottomButton(page).isVisible()) await bottomButton(page).click()
  await atBottom(page)
}

async function reading(page: Page): Promise<Anchor> {
  const area = scroller(page)
  const samples: { attempt: number; phase: string; scrollTop: number; scrollHeight: number; clientHeight: number }[] =
    []
  for (let attempt = 1; attempt <= 3; attempt++) {
    let phase = 'idle'
    const sample = async () => {
      const current = await area.evaluate((el) => ({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight
      }))
      samples.push({ attempt, phase, ...current })
      return current
    }
    try {
      let previous: Awaited<ReturnType<typeof sample>> | undefined
      let stable = 0
      await expect
        .poll(
          async () => {
            const current = await sample()
            stable =
              current.scrollHeight === previous?.scrollHeight && current.scrollTop === previous?.scrollTop
                ? stable + 1
                : 0
            previous = current
            return stable
          },
          { intervals: [100] }
        )
        .toBeGreaterThanOrEqual(3)
      const before = (await sample()).scrollTop
      phase = 'wheel'
      await area.hover()
      await page.mouse.wheel(0, -500)
      await expect.poll(async () => (await sample()).scrollTop).toBeLessThan(before - 200)
      phase = 'settled'
      previous = undefined
      stable = 0
      await expect
        .poll(
          async () => {
            const current = await sample()
            stable =
              current.scrollHeight - current.clientHeight - current.scrollTop > 250 &&
              Math.abs(current.scrollTop - (previous?.scrollTop ?? -1)) < 0.1
                ? stable + 1
                : 0
            previous = current
            return stable
          },
          { intervals: [100] }
        )
        .toBeGreaterThanOrEqual(4)
      break
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`Reading scroll failed after 3 attempts. Samples: ${JSON.stringify(samples)}`, { cause: error })
      }
    }
  }
  await expect.poll(() => area.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(250)
  const viewport = await box(area)
  const messages = view(page).locator('[data-ui~="chat.message"][data-message-id]')
  for (const element of await messages.all()) {
    const bounds = await box(element)
    if (bounds.y > viewport.y + 30 && bounds.y < viewport.y + viewport.height - 30) {
      const id = await element.getAttribute('data-message-id')
      return {
        element: view(page).locator(`[data-ui~="chat.message"][data-message-id="${id}"]`),
        offset: bounds.y - viewport.y
      }
    }
  }
  throw new Error('No historical message with a visible top for the reading anchor')
}

// Retain maximum drift across samples so a temporary jump cannot pass on a later retry.
async function anchored(page: Page, anchor: Anchor, marker?: string) {
  const start = Date.now()
  let maximum = 0
  await expect
    .poll(
      async () => {
        maximum = Math.max(
          maximum,
          Math.abs((await box(anchor.element)).y - (await box(scroller(page))).y - anchor.offset)
        )
        const consumed =
          !marker || (await view(page).locator('[data-ui~="chat.message"]').filter({ hasText: marker }).count()) > 0
        return consumed && Date.now() - start >= 350
      },
      { intervals: [50], timeout: 10_000 }
    )
    .toBe(true)
  expect(maximum, 'The same history anchor must remain within the 2px freeze tolerance').toBeLessThanOrEqual(2)
}

async function clickSend(page: Page) {
  const button = composer(page).getByRole('button', { name: 'Send', exact: true })
  await expect(button).toHaveAttribute('aria-disabled', 'false')
  await button.click()
}

async function accepted(chat: Chat, text: string) {
  const request = await chat.server.nextRequest(30_000)
  expect(request.body.stream).toBe(true)
  expect(request.body.model).toBe(chat.server.modelId)
  const users = request.body.messages.filter((message) => (message as { role?: string }).role === 'user')
  expect(JSON.stringify(users.at(-1))).toContain(text.split('\n')[0])
  await expect(editor(chat.page)).toHaveText('')
  await expect
    .poll(async () => {
      const response = await chat.page.evaluate(
        (id) =>
          window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'GET',
            path: `/topics/${id}/messages`,
            params: { limit: 100 }
          }),
        chat.topicId
      )
      expect(response.status).toBe(200)
      return (response.data as BranchMessagesResponse).items.some(
        ({ message }) =>
          message.role === 'user' && message.data.parts?.some((part) => part.type === 'text' && part.text === text)
      )
    })
    .toBe(true)
  return request
}

async function stream(chat: Chat, request: MockChatRequest, name: string, anchor?: Anchor) {
  if (anchor) await anchored(chat.page, anchor)
  else await atBottom(chat.page)
  for (const part of [1, 2]) {
    const marker = `${name} stream segment ${part}`
    request.sendText(`\n\n${marker}\n\nA growing response paragraph.\n\nAnother streamed paragraph.`)
    if (anchor) await anchored(chat.page, anchor, marker)
    else {
      await expect(view(chat.page).getByText(marker, { exact: true })).toBeInViewport()
      await atBottom(chat.page)
    }
  }
  request.complete()
  await expect(pause(chat.page)).toBeHidden({ timeout: 30_000 })
  if (anchor) await anchored(chat.page, anchor)
  else await atBottom(chat.page)
}

async function capture(page: Page, testInfo: TestInfo, scenario: string) {
  await page.bringToFront()
  const start = Date.now()
  await expect.poll(() => Date.now() - start, { intervals: [50] }).toBeGreaterThanOrEqual(250)
  const filename = `${scenario}.png`
  const output = testInfo.outputPath(filename)
  await page.screenshot({ path: output })
  await testInfo.attach(filename, { path: output, contentType: 'image/png' })
  const taskRoot = process.env.TASKS
  if (!taskRoot) return
  const evidence = join(taskRoot, 'evidence')
  await mkdir(evidence, { recursive: true })
  await copyFile(output, join(evidence, `${scenario}-retry-${testInfo.retry}.png`))
}

test.setTimeout(180_000)

test('S1 default enabled sends return to latest and follow both stream segments', async ({ chat }, testInfo) => {
  await expect
    .poll(() => chat.page.evaluate(() => window.api.preference.get('chat.message.scroll_to_bottom_on_send')))
    .toBe(true)
  await goBottom(chat.page)
  await editor(chat.page).fill('S1 default enabled')
  await reading(chat.page)
  await clickSend(chat.page)
  await stream(chat, await accepted(chat, 'S1 default enabled'), 'S1')
  await capture(chat.page, testInfo, 'S1-default')
})

test('S2 Appearance switch disables send scrolling and preserves the reading anchor', async ({ chat }, testInfo) => {
  await toggle(chat, false)
  await goBottom(chat.page)
  await editor(chat.page).fill('S2 reading send')
  const anchor = await reading(chat.page)
  await clickSend(chat.page)
  await stream(chat, await accepted(chat, 'S2 reading send'), 'S2', anchor)
  await capture(chat.page, testInfo, 'S2-disabled')
})

test('S3 Enter sends a tall multiline draft without moving history and restores focus', async ({ chat }, testInfo) => {
  await toggle(chat, false)
  await goBottom(chat.page)
  const emptyHeight = (await box(editor(chat.page))).height
  const draft = Array.from({ length: 8 }, (_, index) => `S3 multiline draft line ${index}`).join('\n')
  await editor(chat.page).fill(draft)
  await expect.poll(async () => (await box(editor(chat.page))).height).toBeGreaterThan(emptyHeight + 30)
  const tallHeight = (await box(editor(chat.page))).height
  const anchor = await reading(chat.page)
  await editor(chat.page).press('Enter')
  const request = await accepted(chat, draft)
  await anchored(chat.page, anchor)
  await expect(editor(chat.page)).toBeFocused()
  await expect.poll(async () => (await box(editor(chat.page))).height).toBeLessThan(tallHeight - 30)
  await stream(chat, request, 'S3', anchor)
  await capture(chat.page, testInfo, 'S3-enter-multiline')
})

test('S4 disabled preference retains following when already at bottom', async ({ chat }, testInfo) => {
  await toggle(chat, false)
  await goBottom(chat.page)
  await editor(chat.page).fill('S4 already following')
  await atBottom(chat.page)
  await clickSend(chat.page)
  await stream(chat, await accepted(chat, 'S4 already following'), 'S4')
  await capture(chat.page, testInfo, 'S4-following')
})

test('S5 enqueue and real queue drain both preserve the disabled reading anchor', async ({ chat }, testInfo) => {
  await toggle(chat, false)
  await goBottom(chat.page)
  await editor(chat.page).fill('S5 held first turn')
  await clickSend(chat.page)
  const held = await accepted(chat, 'S5 held first turn')
  held.sendText('S5 held response')
  await expect(view(chat.page).getByText('S5 held response', { exact: true })).toBeInViewport()
  await editor(chat.page).fill('S5 queued second turn')
  const anchor = await reading(chat.page)
  await clickSend(chat.page)
  await expect(view(chat.page).getByRole('button', { name: 'Queued (1)', exact: true })).toBeVisible()
  await expect(editor(chat.page)).toHaveText('')
  await anchored(chat.page, anchor)
  await expect(chat.server.nextRequest(400)).rejects.toThrow('Timed out waiting for a mock chat request')
  await anchored(chat.page, anchor)
  held.complete()
  const drained = await accepted(chat, 'S5 queued second turn')
  await stream(chat, drained, 'S5 drained', anchor)
  await expect(view(chat.page).getByRole('button', { name: /^Queued \(/ })).toHaveCount(0)
  await capture(chat.page, testInfo, 'S5-queue-drain')
})

test('S6 re-enabling the Appearance switch restores return-to-latest sends', async ({ chat }, testInfo) => {
  await toggle(chat, false)
  await toggle(chat, true)
  await goBottom(chat.page)
  await editor(chat.page).fill('S6 enabled again')
  await reading(chat.page)
  await clickSend(chat.page)
  await stream(chat, await accepted(chat, 'S6 enabled again'), 'S6')
  await capture(chat.page, testInfo, 'S6-reenabled')
})

test('S7 disabled preference persists across process restart with the same profile', async ({ chat }, testInfo) => {
  await toggle(chat, false)
  chat.page = await chat.session.launch()
  await expect
    .poll(() => chat.page.evaluate(() => window.api.preference.get('chat.message.scroll_to_bottom_on_send')))
    .toBe(false)
  await openSettingsSection(chat.page, 'Appearance')
  await expect(setting(chat.page)).not.toBeChecked()
  await capture(chat.page, testInfo, 'S7-persisted-setting')
  await openChat(chat.page, chat.topicId)
  await goBottom(chat.page)
  await editor(chat.page).fill('S7 persisted reading send')
  const anchor = await reading(chat.page)
  await clickSend(chat.page)
  await stream(chat, await accepted(chat, 'S7 persisted reading send'), 'S7', anchor)
  await capture(chat.page, testInfo, 'S7-restarted-reading')
})

test('S8 manual return-to-bottom still scrolls and follows with the preference disabled', async ({
  chat
}, testInfo) => {
  await toggle(chat, false)
  await goBottom(chat.page)
  await editor(chat.page).fill('S8 manual navigation')
  const anchor = await reading(chat.page)
  await clickSend(chat.page)
  const request = await accepted(chat, 'S8 manual navigation')
  await anchored(chat.page, anchor)
  await expect(bottomButton(chat.page)).toBeVisible()
  await bottomButton(chat.page).click()
  await stream(chat, request, 'S8')
  await capture(chat.page, testInfo, 'S8-manual-bottom')
})
