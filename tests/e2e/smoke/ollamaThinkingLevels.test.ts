import { rm } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'

import type { HttpMethod } from '../../../src/shared/data/api/types'
import type { Model } from '../../../src/shared/data/types/model'
import { startStubOllamaServer } from '../../helpers/http/stubOllamaServer'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profileRoot = testInfo.outputPath('profile')
    try {
      const electronApp = await electron.launch({
        args: ['.'],
        env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profileRoot },
        timeout: 120_000
      })
      try {
        await use(electronApp)
      } finally {
        await electronApp.close()
      }
    } finally {
      await rm(profileRoot, { recursive: true, force: true })
    }
  }
})

const PRIVACY_VERSION = '20260820'

test('discovered Ollama thinking levels survive model sync and reach chat requests', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(300_000)
  const server = await startStubOllamaServer([
    { name: 'qwen3.8:27b', thinking: { values: ['low', 'medium', 'high'], default: 'medium' } },
    { name: 'tiny-toggle:1b', thinking: { values: [true, false] } },
    { name: 'plain-thinking:1b' },
    { name: 'plain-notags:1b', capabilities: ['completion', 'tools'] }
  ])

  try {
    const shell = page.locator('[data-ui~="app.shell"]').first()
    const onboarding = page.locator('[data-onboarding-language-select]')
    await expect(shell.or(onboarding).filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 })

    await page.evaluate(async (privacy) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.privacy.policy_version', privacy)
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    }, PRIVACY_VERSION)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(shell.filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 })

    const dataApi = async (method: HttpMethod, apiPath: string, body?: unknown) =>
      page.evaluate(
        async ({ method, apiPath, body }) =>
          window.api.dataApi.request({
            id: crypto.randomUUID(),
            method,
            path: apiPath,
            ...(body === undefined ? {} : { body })
          }),
        { method, apiPath, body }
      )

    const providerPatch = await dataApi('PATCH', '/providers/ollama', {
      endpointConfigs: { 'ollama-chat': { baseUrl: server.baseUrl } },
      defaultChatEndpoint: 'ollama-chat',
      isEnabled: true
    })
    expect(providerPatch.status, 'Ollama provider configuration must be saved').toBe(200)

    await page.getByRole('button', { name: 'Settings', exact: true }).first().click({ timeout: 60_000 })
    await expect(page.locator('[data-ui~="settings.view"]').first()).toBeVisible({ timeout: 60_000 })
    await page.waitForTimeout(2_000)
    {
      const shot = testInfo.outputPath('settings-nav.png')
      await page.screenshot({ path: shot })
      await testInfo.attach('settings-nav', { path: shot, contentType: 'image/png' })
    }
    await page
      .locator('[data-ui~="settings.navigation"] [data-slot="menu-item"]')
      .filter({ hasText: 'Model Provider' })
      .first()
      .click()
    await page.waitForTimeout(2_500)
    const providerList = page.locator('[data-ui~="settings.content"]').first()
    await providerList.getByText('Ollama', { exact: true }).first().click()
    await page.waitForTimeout(1_500)

    const syncButton = page.getByRole('button', { name: 'Sync models', exact: true }).first()
    await expect(syncButton).toBeVisible({ timeout: 60_000 })
    await syncButton.click()
    await expect(page.getByText('Ollama Models', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
    await page.waitForTimeout(2_500)
    const modelsDrawer = page.getByRole('dialog').filter({ hasText: 'Ollama Models' }).first()
    for (const name of ['qwen3.8:27b', 'tiny-toggle:1b', 'plain-thinking:1b', 'plain-notags:1b']) {
      await expect(
        modelsDrawer.getByText(name, { exact: true }).first(),
        `Ollama Models must list ${name}`
      ).toBeVisible()
    }
    {
      const shot = testInfo.outputPath('sync-drawer.png')
      await page.screenshot({ path: shot })
      await testInfo.attach('sync-drawer', { path: shot, contentType: 'image/png' })
    }

    const addAll = page.getByRole('button', { name: 'Add all models', exact: true }).first()
    await expect(addAll).toBeVisible({ timeout: 60_000 })
    await addAll.click()
    await page.waitForTimeout(2_500)
    {
      const shot = testInfo.outputPath('models-added.png')
      await page.screenshot({ path: shot })
      await testInfo.attach('models-added', { path: shot, contentType: 'image/png' })
    }

    const models = await dataApi('GET', '/models', undefined)
    expect(models.status, 'Synced models must be readable').toBe(200)
    const ollamaRows = (models.data as Model[]).filter((row) => row.providerId === 'ollama')
    expect(ollamaRows, 'Sync must persist all four Ollama fixture models').toHaveLength(4)
    const graded = ollamaRows.find((row) => row.apiModelId === 'qwen3.8:27b')
    expect(graded, 'Discovered graded model must not bind to a catalog preset').toMatchObject({
      presetModelId: null,
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }],
        selectableEfforts: ['low', 'medium', 'high']
      }
    })
    const toggle = ollamaRows.find((row) => row.apiModelId === 'tiny-toggle:1b')
    expect(toggle?.reasoning, 'Boolean discovery must remain a toggle').toMatchObject({
      selectableEfforts: ['none', 'auto'],
      controls: [{ kind: 'toggle' }]
    })
    const fallback = ollamaRows.find((row) => row.apiModelId === 'plain-thinking:1b')
    expect(
      fallback?.reasoning?.selectableEfforts,
      'Missing thinking metadata must retain the declared-capability fallback'
    ).toEqual(['low', 'medium', 'high', 'none'])
    const plain = ollamaRows.find((row) => row.apiModelId === 'plain-notags:1b')
    expect(plain, 'Non-thinking fixture must be persisted').toBeDefined()
    expect(plain?.reasoning, 'A model without thinking capability must have no reasoning selector').toBeUndefined()

    const assistant = await dataApi('POST', '/assistants', {
      name: 'Ollama thinking levels',
      modelId: 'ollama::qwen3.8:27b'
    })
    expect(assistant.status, 'Assistant must be bound to the discovered graded model').toBe(201)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(shell.filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 })
    const backButton = page.getByRole('button', { name: 'Back', exact: true }).first()
    if (await backButton.isVisible().catch(() => false)) {
      await backButton.click()
      await page.waitForTimeout(1_500)
    }
    await page.getByRole('button', { name: 'Chat', exact: true }).first().click({ timeout: 60_000 })
    const assistantRow = page
      .locator('[data-ui~="chat.group-header"]')
      .filter({ hasText: 'Ollama thinking levels' })
      .first()
    await expect(assistantRow).toBeVisible({ timeout: 60_000 })
    await assistantRow.hover()
    await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).first().click({ timeout: 60_000 })
    await page.waitForTimeout(2_000)

    const speedButton = page
      .locator('[data-ui~="chat.composer"]')
      .getByRole('button', { name: 'Response settings', exact: true })
      .first()
    await expect(speedButton, 'graded Ollama model must expose the response settings control').toBeVisible({
      timeout: 60_000
    })
    await speedButton.click()
    const popover = page.locator('[role="dialog"]').first()
    await expect(popover).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(700)
    {
      const shot = testInfo.outputPath('speed-popover-default.png')
      await page.screenshot({ path: shot })
      await testInfo.attach('speed-popover-default', { path: shot, contentType: 'image/png' })
    }

    const slider = popover.getByRole('slider').first()
    await expect(slider).toBeVisible({ timeout: 20_000 })
    await expect(slider, 'Only the three advertised effort levels must be selectable').toHaveAttribute(
      'aria-valuemax',
      '2'
    )
    await expect(slider, 'A new assistant must start with the provider default').toHaveAttribute(
      'aria-valuetext',
      'Default'
    )
    await slider.focus()
    for (let i = 0; i < 4; i += 1) {
      const value = await slider.getAttribute('aria-valuetext')
      if (value === 'High') break
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(250)
    }
    await expect(slider, 'ArrowRight must select the advertised High level').toHaveAttribute('aria-valuetext', 'High')
    {
      const shot = testInfo.outputPath('speed-popover-high.png')
      await page.screenshot({ path: shot })
      await testInfo.attach('speed-popover-high', { path: shot, contentType: 'image/png' })
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    const composerInput = page.locator('[data-ui~="chat.composer"] [data-ui~="part:composer-input"]').first()
    await composerInput.click()
    await page.keyboard.type('probe level high')
    const sendButton = page.locator('[data-ui~="chat.composer.action.send"]').first()
    await expect(sendButton).toHaveAttribute('aria-disabled', 'false', { timeout: 30_000 })
    await sendButton.click()
    for (let i = 0; i < 60 && server.chatBodies.length === 0; i += 1) await page.waitForTimeout(500)
    expect(server.chatBodies, 'Sending High must reach the Ollama daemon once').toHaveLength(1)
    expect(Object.hasOwn(server.chatBodies[0], 'think'), 'High must explicitly include think').toBe(true)
    expect(server.chatBodies[0].think, 'High must serialize exactly as the advertised high value').toBe('high')
    expect(server.rejectedChats, 'High must not send an unadvertised think value').toEqual([])
    await page.waitForTimeout(1_500)
    {
      const shot = testInfo.outputPath('chat-after-send.png')
      await page.screenshot({ path: shot })
      await testInfo.attach('chat-after-send', { path: shot, contentType: 'image/png' })
    }

    await speedButton.click()
    await expect(popover).toBeVisible({ timeout: 20_000 })
    const defaultButton = popover.getByRole('button', { name: 'Default', exact: true }).first()
    if (await defaultButton.isVisible().catch(() => false)) {
      await defaultButton.click()
    } else {
      const sliderAgain = popover.getByRole('slider').first()
      await sliderAgain.focus()
      for (let i = 0; i < 4; i += 1) {
        if ((await sliderAgain.getAttribute('aria-valuetext')) === 'Default') break
        await page.keyboard.press('ArrowLeft')
        await page.waitForTimeout(200)
      }
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await composerInput.click()
    await page.keyboard.type('probe default')
    await sendButton.click()
    for (let i = 0; i < 60 && server.chatBodies.length < 2; i += 1) await page.waitForTimeout(500)
    expect(server.chatBodies, 'Sending Default must reach the Ollama daemon a second time').toHaveLength(2)
    expect(Object.hasOwn(server.chatBodies[1], 'think'), 'Default must omit think rather than send false or null').toBe(
      false
    )
    expect(server.rejectedChats, 'Neither chat may send an unknown model or unadvertised think value').toEqual([])
  } finally {
    await server.close()
  }
})
