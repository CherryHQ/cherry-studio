import { isAbsolute, parse, relative, sep } from 'node:path'

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectVisibleModel } from '../regression/helpers/models'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { closeElectronApp, expect, test as base } from './fixtures/electron.fixture'
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
          app = await electron.launch({
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
  const { app, page } = await isolatedSession.launch()
  const server = await startMockChatServer()
  const providerId = 'wizard-activity-smoke'
  const name = 'Wizard Activity draft 23297'
  const description = 'Keep this unsaved agent description while visiting the knowledge library.'
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
    const knowledge = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'wizard-empty-knowledge', method: 'GET', path: '/knowledge-bases' })
    )
    expect(knowledge, 'The reported entry must be exercised with an empty knowledge library').toMatchObject({
      status: 200,
      data: { items: [] }
    })
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
    const promptStep = dialog.getByRole('button', { name: /System Prompt$/ })
    const skillsStep = dialog.getByRole('button', { name: /Skills$/ })
    const knowledgeStep = dialog.getByRole('button', { name: /Knowledge$/ })
    const nameInput = dialog.getByPlaceholder('Enter a name', { exact: true })
    const descriptionInput = dialog.getByPlaceholder('Describe what it is for...', { exact: true })
    const promptEditor = dialog.locator('.cm-content[contenteditable="true"]')
    const next = dialog.getByRole('button', { name: 'Next', exact: true })
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

    await addAgent.click()
    await expect(basicStep, 'Agent creation must start at Basic info').toHaveAttribute('aria-current', 'step')
    const pi = dialog.getByRole('radio').and(dialog.locator('[value="pi"]'))
    await dialog.getByLabel('Runtime mode').getByText('Pi', { exact: true }).click()
    await expect(pi, 'Pi must expose the Skills and Knowledge path').toBeChecked()
    await nameInput.fill(name)
    await descriptionInput.fill(description)
    await selectModel()
    await next.click()
    await expect(promptStep, 'Next must reach the real system prompt editor').toHaveAttribute('aria-current', 'step')
    await promptEditor.fill(prompt)
    await next.click()
    await expect(skillsStep, 'Pi creation must include the Skills step before Knowledge').toHaveAttribute(
      'aria-current',
      'step'
    )
    await next.click()
    await expect(knowledgeStep, 'The draft must reach Knowledge before leaving Work').toHaveAttribute(
      'aria-current',
      'step'
    )
    await dialog.getByRole('button', { name: 'Add knowledge base', exact: true }).click()
    await dialog.getByRole('button', { name: 'Open Knowledge to create one', exact: true }).click()

    // SubWindow is pooled, so a detached page may already exist before the entry is clicked.
    let knowledgeWindow: Page | undefined
    await expect
      .poll(
        async () => {
          for (const candidate of app.windows()) {
            if (candidate !== page && (await uiLocator(candidate, 'knowledge.view').first().isVisible())) {
              knowledgeWindow = candidate
              return true
            }
          }
          return false
        },
        { timeout: 60_000, message: 'The knowledge entry must open the detached knowledge library' }
      )
      .toBe(true)
    await knowledgeWindow!.getByRole('button', { name: 'Back to Main Window', exact: true }).click()
    await expect
      .poll(() => knowledgeWindow!.isClosed(), { message: 'Returning to main must close the detached window' })
      .toBe(true)
    const knowledgeTab = tabBar.locator('[data-tab-id][aria-label="Knowledge Base"]')
    await expect(knowledgeTab, 'Attaching Knowledge must activate its main-window tab').toHaveAttribute(
      'data-active',
      'true'
    )
    await expect(originalTab, 'Work must be hidden before testing Activity re-show').not.toHaveAttribute('data-active')
    await expect(view, 'The Knowledge tab must hide the original Work content').toBeHidden()
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
    await expect(descriptionInput, 'Activity re-show must preserve the unsaved description').toHaveValue(description)
    await next.click()
    const promptPreview = dialog.locator('div.prompt-preview')
    for (const marker of ['WIZARD_DRAFT_BEGIN_23297', 'Instruction 12:', 'WIZARD_DRAFT_END_23297']) {
      await expect(
        promptPreview,
        'The re-shown wizard must keep the whole unsaved system prompt, not a prefix'
      ).toContainText(marker)
    }
    await expectNoCreatedDraft()

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog, 'A committed cancel must remove the wizard before reopening').toHaveCount(0)
    await addAgent.click()
    await expect(basicStep, 'A real reopen must reset the current step to Basic info').toHaveAttribute(
      'aria-current',
      'step'
    )
    await expect(nameInput, 'A real reopen must discard the old name').toHaveValue('')
    await expect(descriptionInput, 'A real reopen must discard the old description').toHaveValue('')
    await nameInput.fill('Reset verification only')
    await selectModel()
    await next.click()
    await expect(promptPreview, 'A real reopen must discard the old system prompt').toHaveCount(0)
    await expect(dialog, 'A real reopen must discard the old system prompt').not.toContainText('WIZARD_DRAFT_END_23297')
    await expect(dialog, 'A real reopen must discard the old system prompt').not.toContainText(
      'WIZARD_DRAFT_BEGIN_23297'
    )
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog, 'The reset check must leave no wizard open').toHaveCount(0)
    await expectNoCreatedDraft()
  } finally {
    await server.close()
  }
})
