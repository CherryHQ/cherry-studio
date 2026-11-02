import { join } from 'node:path'

import type { DeleteAssistantResult } from '@shared/data/api/schemas/assistants'
import { AssistantSchema } from '@shared/data/types/assistant'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import { validateFileEvidence } from '../../../scripts/e2e/regression/fileEvidence'
import { saveNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
import { selectChatModel, sendChatMarker } from './chat'
import { addCherryInModel, ensureCherryInSignedIn } from './cherryIn'
import { expect, test } from './fixture'
import { selectVisibleModel } from './models'
import { dismissOnboarding, selectSidebarApp } from './navigation'
import { closeSettings, openSettingsSection } from './settings'

const IMAGE_PROMPT = 'A red cherry robot holding a blue umbrella in a bright workshop, detailed illustration.'

test(...caseDefinition('M-01'), async ({ app, mainWindow: _mainWindow }) => {
  let page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await ensureCherryInSignedIn(app, page)
  await addCherryInModel(page, app.config.cherryIn.chatModel)
  await closeSettings(page)
  const assistantName = app.resourceName(`CherryIN chat ${Date.now()}`)
  const created = await page.evaluate(
    (name) =>
      window.api.dataApi.request({
        id: 'cherryin-chat-assistant-create',
        method: 'POST',
        path: '/assistants',
        body: { name }
      }),
    assistantName
  )
  expect(created.status, `Chat assistant creation failed: ${JSON.stringify(created)}`).toBe(201)
  const assistantId = AssistantSchema.parse(created.data).id
  try {
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chatView = page.locator('[data-ui~="chat.view"]:visible')
    await chatView.getByRole('listbox').getByRole('button', { name: assistantName, exact: true }).click()
    await chatView.getByRole('button', { name: 'New Chat', exact: true }).last().click()
    await selectChatModel(page, app.config.cherryIn.chatModel)
    await sendChatMarker(page, 'Reply with exactly CHERRYIN_CHAT_PASS and nothing else.', 'CHERRYIN_CHAT_PASS', false)

    page = await app.restart('authenticated')
    await dismissOnboarding(page)
    await openSettingsSection(page, 'Model Provider')
    await page.getByTestId('provider-list-item-cherryin').click()
    await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible({ timeout: 60_000 })
  } finally {
    page = await app.mainWindow()
    await page.evaluate(async (assistantId) => {
      try {
        const removed = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
          assistantId,
          deleteTopics: true
        })) as IpcResult<DeleteAssistantResult>
        if (!removed.ok || !removed.data.deleted)
          throw new Error(`Permanent deletion failed: ${JSON.stringify(removed)}`)
      } catch (error) {
        throw new Error(`CherryIN Chat assistant cleanup failed for ${assistantId}: ${String(error)}`)
      }
    }, assistantId)
  }
})

async function generateAndSaveImage(
  app: Parameters<typeof ensureCherryInSignedIn>[0],
  page: Parameters<typeof ensureCherryInSignedIn>[1],
  model: string,
  outputName: string
): Promise<void> {
  await closeSettings(page)
  await selectSidebarApp(page, 'Paintings')
  const modelButton = page.locator('[data-selector-shell-root="true"] > button').first()
  const modelName = model.split('/').at(-1) ?? model
  const selectedModelRestored = await modelButton
    .filter({ hasText: modelName })
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
  if (!selectedModelRestored) {
    await modelButton.click()
    await selectVisibleModel(page, model)
  }
  await page.locator('[contenteditable="true"]').fill(IMAGE_PROMPT)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const generation = page.getByRole('status', {
    name: /Drawing in progress\. Please do not leave this page\.|Revealing generated image/
  })
  const image = page.getByTestId('artboard-image-transform').last()
  await expect(generation).toBeVisible()
  await expect(generation).toBeHidden({ timeout: 3 * 60_000 })
  await expect(image).toBeVisible()

  await image.click({ button: 'right' })
  await page.getByText('Save As', { exact: true }).click()
  const output = join(app.paths.evidence, 'downloads', outputName)
  saveNativeFile(app.record.platform, app.paths, output)
  await expect
    .poll(async () => {
      try {
        await validateFileEvidence(output, { minimumBytes: 1_024, type: 'image' })
        return true
      } catch {
        return false
      }
    })
    .toBe(true)

  await selectSidebarApp(page, 'Chat')
  await selectSidebarApp(page, 'Paintings')
  await page.getByRole('button', { name: 'Select Image', exact: true }).last().click()
  await expect(page.getByTestId('artboard-image-transform').last()).toBeVisible()
}

test(...caseDefinition('P-01'), async ({ app, mainWindow: page }) => {
  await ensureCherryInSignedIn(app, page)
  await addCherryInModel(page, app.config.cherryIn.imageModel, 'Image')
  await generateAndSaveImage(app, page, app.config.cherryIn.imageModel, 'image.png')
})
