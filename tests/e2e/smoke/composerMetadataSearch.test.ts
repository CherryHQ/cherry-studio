import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { _electron as electron, type Locator, type Page, type TestInfo } from '@playwright/test'

import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentWorkspaceEntitySchema } from '../../../src/shared/data/api/schemas/agentWorkspaces'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const skillName = 'metadata-pdf'
const description = 'Read and analyze PDFs'

type MetadataContext = {
  view: Locator
  composer: Locator
  editor: Locator
  agentName: string
  baseName: string
  baseId: string
  server: Awaited<ReturnType<typeof startMockChatServer>>
}

const test = base.extend<{ isolatedProfile: string; metadata: MetadataContext }>({
  isolatedProfile: async ({}, use) => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'cherry-metadata-search-'))
    try {
      await use(profile)
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  },
  electronApp: async ({ isolatedProfile }, use) => {
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: isolatedProfile },
      timeout: 60_000
    })
    try {
      await use(app)
    } finally {
      await app.close()
    }
  },
  metadata: async ({ mainWindow: page, isolatedProfile }, use) => {
    const server = await startMockChatServer()
    const previous = await page.evaluate(async () => ({
      language: await window.api.preference.get('app.language'),
      onboarding: await window.api.preference.get('app.onboarding.provider_setup.status'),
      privacy: await window.api.preference.get('app.privacy.policy_version'),
      naming: await window.api.preference.get('topic.naming.enabled')
    }))
    try {
      const languageSelect = page.locator('[data-onboarding-language-select]')
      await expect(uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()).toBeVisible()
      if (await languageSelect.isVisible()) {
        await languageSelect.getByRole('combobox').click()
        await page.getByRole('option', { name: 'English', exact: false }).click()
        await page.getByRole('button', { name: 'Set up later', exact: true }).click()
      }
      await page.evaluate(async (privacyVersion) => {
        await window.api.preference.set('app.language', 'en-US')
        await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
        await window.api.preference.set('app.privacy.policy_version', privacyVersion)
        await window.api.preference.set('topic.naming.enabled', false)
      }, LATEST_PRIVACY_POLICY_VERSION)
      await selectSidebarApp(page, 'Chat')
      const providerId = `metadata-${Date.now()}`
      const statuses = await page.evaluate(
        async ({ providerId, baseUrl, modelId }) => {
          const provider = await window.api.dataApi.request({
            id: 'metadata-provider',
            method: 'POST',
            path: '/providers',
            body: {
              providerId,
              name: 'Metadata mock',
              defaultChatEndpoint: 'openai-chat-completions',
              endpointConfigs: { 'openai-chat-completions': { baseUrl } },
              apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
            }
          })
          const enabled = await window.api.dataApi.request({
            id: 'metadata-enable',
            method: 'PATCH',
            path: `/providers/${providerId}`,
            body: { isEnabled: true }
          })
          const models = await window.api.dataApi.request({
            id: 'metadata-model',
            method: 'POST',
            path: '/models',
            body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
          })
          return [provider.status, enabled.status, models.status]
        },
        { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
      )
      expect(statuses).toEqual([201, 200, 201])
      const workspacePath = path.join(isolatedProfile, 'user-workspace')
      for (const [name, text] of [
        [skillName, description],
        ['metadata-review', 'Please read analyze reports']
      ]) {
        const directory = path.join(workspacePath, '.claude', 'skills', name)
        await mkdir(directory, { recursive: true })
        await writeFile(
          path.join(directory, 'SKILL.md'),
          `---\nname: ${name}\ndescription: ${text}\n---\nUse this skill for document work.\n`
        )
      }
      const registered = await page.evaluate(
        (workspacePath) =>
          window.api.ipcApi.request('ai.agent.workspace.register', { path: workspacePath, name: 'Metadata workspace' }),
        workspacePath
      )
      expect(registered).toMatchObject({ ok: true })
      const workspace = AgentWorkspaceEntitySchema.parse((registered as { data: unknown }).data)
      const agentName = `Metadata Agent ${providerId}`
      const created = await page.evaluate(
        ({ name, model }) =>
          window.api.ipcApi.request('ai.agent.create', {
            type: 'pi',
            name,
            model,
            instructions: 'Answer briefly without using tools.'
          }),
        { name: agentName, model: createUniqueModelId(providerId, server.modelId) }
      )
      expect(created).toMatchObject({ ok: true })
      const agent = AgentEntitySchema.parse((created as { data: unknown }).data)
      const sessionName = `Metadata session ${providerId}`
      const session = await page.evaluate(
        ({ agentId, workspaceId, name }) =>
          window.api.dataApi.request({
            id: 'metadata-session',
            method: 'POST',
            path: '/agent-sessions',
            body: { agentId, name, workspace: { type: 'user', workspaceId } }
          }),
        { agentId: agent.id, workspaceId: workspace.id, name: sessionName }
      )
      expect(session.status).toBe(201)
      const baseName = `Research Library ${providerId}`
      const knowledge = await page.evaluate(
        (name) =>
          window.api.ipcApi.request('knowledge.create_base', {
            base: { name, embeddingModelId: null, dimensions: null }
          }),
        baseName
      )
      expect(knowledge).toMatchObject({ ok: true })
      const bases = await page.evaluate(() =>
        window.api.dataApi.request({ id: 'metadata-bases', method: 'GET', path: '/knowledge-bases' })
      )
      expect(bases.status).toBe(200)
      const baseItem = (bases.data as { items: { id: string; name: string }[] }).items.find(
        (item) => item.name === baseName
      )!
      expect(baseItem).toBeTruthy()
      await page.reload()
      await selectSidebarApp(page, 'Chat')
      await selectSidebarApp(page, 'Work')
      const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
      const header = view.getByText(agentName, { exact: true }).first()
      await header.click()
      const conversation = view.getByText(sessionName, { exact: true }).first()
      if (!(await conversation.isVisible())) {
        await header.hover()
        await view
          .getByRole('button', { name: agentName, exact: true })
          .first()
          .locator('..')
          .getByRole('button', { name: 'Expand', exact: true })
          .click()
      }
      await conversation.click()
      const composer = uiLocator(view, 'chat.composer').filter({ visible: true })
      await expect(composer).toHaveCount(1)
      const editor = composer.locator('[data-ui~="part:composer-input"] [contenteditable="true"]').first()
      await expect(editor).toBeEditable()
      await use({ view, composer, editor, agentName, baseName, baseId: baseItem.id, server })
    } finally {
      try {
        await page.evaluate(async (values) => {
          await window.api.preference.set('app.language', values.language)
          await window.api.preference.set('app.onboarding.provider_setup.status', values.onboarding)
          await window.api.preference.set('app.privacy.policy_version', values.privacy)
          await window.api.preference.set('topic.naming.enabled', values.naming)
        }, previous)
      } finally {
        await server.close()
      }
    }
  }
})

test.beforeEach(() => test.setTimeout(120_000))

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const phase = process.env.EVIDENCE_PHASE ?? 'after'
  const filename = `${name}-${phase}.png`
  const output = testInfo.outputPath(filename)
  await page.screenshot({ path: output })
  await testInfo.attach(filename, { path: output, contentType: 'image/png' })
  const evidenceDirectory = process.env.EVIDENCE_DIR // optional: mirror for the coordinator
  if (evidenceDirectory) {
    await mkdir(evidenceDirectory, { recursive: true })
    await copyFile(output, path.join(evidenceDirectory, filename))
  }
}

const panel = (page: Page) => page.getByTestId('quick-panel').filter({ visible: true })

async function openSubmenu(page: Page, editor: Locator, name: string) {
  await editor.fill(`/${name}`)
  await panel(page).getByRole('button', { name, exact: true }).click()
}

test('Agent root description search', async ({ mainWindow: page, metadata }, testInfo) => {
  await metadata.editor.fill('/analyze')
  const row = panel(page).getByRole('button').filter({ hasText: skillName })
  try {
    await expect(row).toBeVisible()
  } finally {
    await screenshot(page, testInfo, 'agent-root-query')
  }
  await expect(row.getByText(skillName, { exact: true })).toBeVisible()
  await expect(row.getByText(description, { exact: true })).toBeVisible()
  await row.click()
  await expect(metadata.composer.locator('[data-composer-token-node]').filter({ hasText: skillName })).toBeVisible()
  await screenshot(page, testInfo, 'agent-root-token')
})

test('Skills submenu description search', async ({ mainWindow: page, metadata }, testInfo) => {
  await openSubmenu(page, metadata.editor, 'Skills')
  await metadata.editor.pressSequentially('analyze')
  const rows = panel(page)
    .getByRole('button')
    .filter({ hasText: /metadata-pdf|metadata-review/ })
  await expect(rows).toHaveCount(2)
  await expect(panel(page).getByText(description, { exact: true })).toBeVisible()
  await screenshot(page, testInfo, 'skills-submenu-query')
  // Query changes may alter ranking; Enter must insert whichever row has keyboard focus.
  const active = panel(page).locator('[role="button"][aria-current="true"]')
  await expect(active).toHaveCount(1)
  const selectedName = (await active.innerText()).includes(skillName) ? skillName : 'metadata-review'
  await metadata.editor.press('Enter')
  await expect(metadata.composer.locator('[data-composer-token-node]').filter({ hasText: selectedName })).toBeVisible()
  await screenshot(page, testInfo, 'skills-submenu-token')
})

test('Save to Knowledge Base selector ID search', async ({ mainWindow: page, metadata }, testInfo) => {
  const prompt = 'METADATA_SEARCH_MESSAGE'
  const marker = 'METADATA_SEARCH_RESPONSE'
  await metadata.editor.fill(prompt)
  await metadata.composer.getByRole('button', { name: 'Send', exact: true }).click()
  let matched = false
  const deadline = Date.now() + 30_000
  while (!matched && Date.now() < deadline) {
    const request = await metadata.server.nextRequest(Math.max(1, deadline - Date.now()))
    matched =
      request.body.model === metadata.server.modelId &&
      request.body.messages.some((message) => JSON.stringify(message).includes(prompt))
    request.complete(matched ? marker : 'Background request complete')
  }
  expect(matched).toBe(true)
  const message = uiLocator(metadata.view, 'chat.message').filter({ hasText: marker })
  await expect(message).toBeVisible({ timeout: 30_000 })
  await message.hover()
  await message.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Save', exact: true }).hover()
  await page.getByRole('menuitem', { name: 'Save to Knowledge Base', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save to Knowledge Base', exact: true })
  const trigger = dialog.getByRole('button', { name: 'Select Knowledge Base', exact: true })
  await trigger.click()
  const popover = page.getByTestId('knowledge-base-selector-content')
  await expect(popover).toBeVisible()
  const query = metadata.baseId.slice(-12)
  expect(metadata.baseName).not.toContain(query)
  const search = popover.getByPlaceholder('Search', { exact: true })
  await search.fill(query)
  const option = popover.getByRole('option', { name: metadata.baseName, exact: true })
  await expect(option).toBeVisible()
  await expect(popover).toBeVisible()
  await expect(search).toHaveValue(query)
  await screenshot(page, testInfo, 'save-knowledge-query')
  await option.click()
  await expect(trigger).toContainText(metadata.baseName)
  await screenshot(page, testInfo, 'save-knowledge-selection')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('Catalog knowledge-base picker ID search', async ({ mainWindow: page, metadata }, testInfo) => {
  await metadata.view.getByRole('button', { name: metadata.agentName, exact: true }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit Agent', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Agent', exact: true })
  await dialog.getByRole('tab', { name: 'Knowledge', exact: true }).click()
  await dialog.getByRole('button', { name: 'Add knowledge base', exact: true }).click()
  const query = metadata.baseId.slice(-12)
  expect(metadata.baseName).not.toContain(query)
  await page.getByPlaceholder('Search knowledge bases...', { exact: true }).fill(`  ${query.toUpperCase()}  `)
  const row = page.getByRole('option').filter({ hasText: metadata.baseName })
  try {
    await expect(row).toContainText('0 docs')
  } finally {
    await screenshot(page, testInfo, 'catalog-knowledge-query')
  }
  await expect(row.getByText(metadata.baseName, { exact: true })).toBeVisible()
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await screenshot(page, testInfo, 'catalog-knowledge-highlight')
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
})
