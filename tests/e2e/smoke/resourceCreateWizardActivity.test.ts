import { isAbsolute, parse, relative, sep } from 'node:path'

import { type ElectronApplication, type Page } from '@playwright/test'

import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectVisibleModel } from '../regression/helpers/models'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { closeElectronApp, expect, launchSmokeElectron, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const test = base.extend<{ isolatedSession: { launch: () => Promise<{ app: ElectronApplication; page: Page }> } }>({
  isolatedSession: async ({}, use) => {
    const profile = process.env.CS_DEV_PROFILE_ROOT!
    expect(profile, 'The automatic fixture must initialize the isolated profile').toBeTruthy()
    expect(isAbsolute(profile), 'Profile cleanup must target an absolute test-owned path').toBe(true)
    expect(profile, 'Profile cleanup must never target the filesystem root').not.toBe(parse(profile).root)
    let app: ElectronApplication | undefined
    try {
      await use({
        launch: async () => {
          const env = { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile }
          Reflect.deleteProperty(env, 'ELECTRON_RENDERER_URL')
          app = await launchSmokeElectron({
            args: ['.'],
            env,
            timeout: 60_000
          })
          const userData = await app.evaluate(({ app }) => app.getPath('userData'))
          const inside = relative(profile, userData)
          expect(inside, 'Electron must use a userData directory inside the isolated profile').not.toBe('')
          expect(isAbsolute(inside), 'Electron must not fall back to a profile on another volume').toBe(false)
          expect(inside === '..' || inside.startsWith(`..${sep}`), 'Electron must not use the shared profile').toBe(
            false
          )
          let page: Page | undefined
          await expect
            .poll(
              async () => {
                for (const candidate of app!.windows()) {
                  if (/\/windows\/main\/index\.html(?:[?#]|$)/.test(candidate.url())) {
                    page = candidate
                    return true
                  }
                }
                return false
              },
              { timeout: 60_000, message: 'The isolated main window must become ready' }
            )
            .toBe(true)
          await page!.waitForFunction(() => !!window.api?.preference, undefined, { timeout: 60_000 })
          return { app, page: page! }
        }
      })
    } finally {
      if (app) await closeElectronApp(app)
    }
  }
})

test.setTimeout(240_000)

test('agent wizard preserves its draft and Knowledge step across Activity re-show, then resets on reopen', async ({
  isolatedSession
}, testInfo) => {
  const { page } = await isolatedSession.launch()
  const server = await startMockChatServer()
  const providerId = 'wizard-activity-smoke'
  const name = 'Wizard Activity draft 23297'
  const prompt = [
    'WIZARD_DRAFT_BEGIN_23297',
    ...Array.from(
      { length: 12 },
      (_, index) =>
        `Instruction ${index + 1}: Preserve this complete unsaved system prompt, including every line and marker, while the user visits Knowledge and returns to Work.`
    ),
    'WIZARD_DRAFT_END_23297'
  ].join('\n')

  try {
    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()).toBeVisible()
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click()
      await page.getByRole('option', { name: 'English', exact: false }).click()
      await page.getByRole('button', { name: 'Set up later', exact: true }).click()
    }
    await page.evaluate(() => window.api.preference.set('app.language', 'en-US'))
    await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Wizard Activity mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: `${providerId}-enable`,
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    await page.evaluate(
      ({ providerId, modelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    await page.reload()
    await selectSidebarApp(page, 'Work')
    const view = uiLocator(page, 'agent.view').filter({ visible: true })
    const addAgent = view.getByRole('button', { name: 'Add Agent', exact: true })
    const tabBar = uiLocator(page, 'app.tab-bar')
    const originalTabId = await tabBar.locator('[data-tab-id][data-active="true"]').getAttribute('data-tab-id')
    expect(originalTabId, 'The return path must target the original Work tab').toBeTruthy()
    const originalTab = tabBar.locator(`[data-tab-id="${originalTabId}"]`)
    const dialog = page.getByRole('dialog', { name: 'New Agent', exact: true })
    const basicStep = dialog.getByRole('button', { name: /Basic info$/ })
    const advancedStep = dialog.getByRole('button', { name: /Advanced$/ })
    const knowledgeStep = dialog.getByRole('button', { name: /Knowledge$/ })
    const nameInput = dialog.getByPlaceholder('Enter a name', { exact: true })
    const promptEditor = dialog.locator('.cm-content[contenteditable="true"]')
    const next = dialog.getByRole('button', { name: 'Next', exact: true })
    const agentPrompt = dialog.getByRole('button', { name: 'Agent Prompt', exact: true })
    const enterManualWizard = async () => {
      await addAgent.click()
      await dialog.getByRole('button', { name: 'Manual create', exact: true }).click()
    }
    const openAdvanced = async () => {
      await next.click() // MCP
      await next.click() // Channels
      await next.click() // Advanced
      await expect(advancedStep).toHaveAttribute('aria-current', 'step')
    }
    const discardDraft = async () => {
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Discard unsaved changes?', exact: true })
        .getByRole('button', { name: 'Discard changes', exact: true })
        .click()
      await expect(dialog).toBeHidden()
    }
    const selectModel = async () => {
      await dialog.getByRole('button', { name: 'Model', exact: true }).click()
      await selectVisibleModel(page, server.modelId)
    }
    const expectNoCreatedDraft = async () => {
      const agents = await page.evaluate(
        (name) =>
          window.api.dataApi.request({
            id: 'wizard-unsaved-agent',
            method: 'GET',
            path: '/agents',
            params: { search: name }
          }),
        name
      )
      expect(agents, 'Navigation and cancellation must never submit the agent draft').toMatchObject({
        status: 200,
        data: { items: [], total: 0 }
      })
    }

    await enterManualWizard()
    await expect(basicStep, 'Agent creation must start at Basic info').toHaveAttribute('aria-current', 'step')
    await nameInput.fill(name)
    await selectModel()
    await next.click() // Tools
    await next.click() // Skills
    await next.click() // Knowledge
    await expect(knowledgeStep).toHaveAttribute('aria-current', 'step')
    await openAdvanced()
    await agentPrompt.click()
    const edit = dialog.getByRole('button', { name: 'Edit', exact: true })
    await expect(edit.or(promptEditor).first()).toBeVisible()
    if (await edit.isVisible()) await edit.click()
    await promptEditor.fill(prompt)
    await knowledgeStep.click()
    await expect(knowledgeStep).toHaveAttribute('aria-current', 'step')

    const opened = await page.evaluate(() =>
      window.api.ipcApi.request('navigation.open_route_in_main', { path: '/app/knowledge' })
    )
    expect(opened).toMatchObject({ ok: true })
    await expect(uiLocator(page, 'knowledge.view').filter({ visible: true })).toBeVisible()
    await expect(originalTab, 'Work must be hidden before testing Activity re-show').not.toHaveAttribute('data-active')
    await expect(view, 'Switching tabs must hide the original Work content').toBeHidden()
    await originalTab.click()
    await expect(dialog, 'Activity re-show must keep the unsaved wizard open').toBeVisible()
    await expect(knowledgeStep, 'Activity re-show must not reset the wizard to step one').toHaveAttribute(
      'aria-current',
      'step'
    )

    const screenshot = testInfo.outputPath('wizard-draft-after-tab-switch.png')
    await page.screenshot({ path: screenshot })
    await testInfo.attach('wizard-draft-after-tab-switch', { path: screenshot, contentType: 'image/png' })

    await basicStep.click()
    await expect(nameInput, 'Activity re-show must preserve the unsaved name').toHaveValue(name)
    await next.click()
    await next.click()
    await next.click()
    await openAdvanced()
    await agentPrompt.click()
    const promptPreview = dialog.locator('div.prompt-preview')
    for (const marker of ['WIZARD_DRAFT_BEGIN_23297', 'Instruction 12:', 'WIZARD_DRAFT_END_23297']) {
      await expect(
        promptPreview,
        'The re-shown wizard must keep the whole unsaved system prompt, not a prefix'
      ).toContainText(marker)
    }
    await expectNoCreatedDraft()

    await discardDraft()
    await enterManualWizard()
    await expect(basicStep, 'A real reopen must reset the current step to Basic info').toHaveAttribute(
      'aria-current',
      'step'
    )
    await expect(nameInput, 'A real reopen must discard the old name').toHaveValue('')
    await nameInput.fill('Reset verification only')
    await selectModel()
    await next.click()
    await next.click()
    await next.click()
    await openAdvanced()
    await agentPrompt.click()
    await expect(dialog, 'A real reopen must discard the old system prompt').not.toContainText('WIZARD_DRAFT_END_23297')
    await expect(dialog, 'A real reopen must discard the old system prompt').not.toContainText(
      'WIZARD_DRAFT_BEGIN_23297'
    )
    await discardDraft()
    await expectNoCreatedDraft()
  } finally {
    await server.close()
  }
})
