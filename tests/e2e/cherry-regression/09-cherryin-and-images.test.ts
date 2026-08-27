import { join } from 'node:path'

import { expect, test } from './fixture'
import { addCherryInModel, ensureCherryInSignedIn } from './cherry-in'
import { dismissOnboarding, selectSidebarApp } from './helpers'
import { closeSettings, selectChatModel, selectVisibleModel, sendChatMarker } from './models'
import { validateFileEvidence } from '../../../scripts/cherry-regression-test/file-evidence'
import { saveNativeFile } from '../../../scripts/cherry-regression-test/system-automation'

const IMAGE_PROMPT = 'A red cherry robot holding a blue umbrella in a bright workshop, detailed illustration.'

test('[M-01] 登录 CherryIN 并完成聊天 @cherryin-chat', async ({ app, mainWindow: _mainWindow }) => {
  let page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await ensureCherryInSignedIn(app, page)
  await addCherryInModel(page, app.config.cherryIn.chatModel)
  await closeSettings(page)
  await selectChatModel(page, app.config.cherryIn.chatModel)
  await sendChatMarker(page, 'Reply with exactly CHERRYIN_CHAT_PASS and nothing else.', 'CHERRYIN_CHAT_PASS')

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await ensureCherryInSignedIn(app, page)
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible()
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
  if (!(await modelButton.textContent())?.includes(modelName)) {
    await modelButton.click()
    await selectVisibleModel(page, modelName)
  }
  await page.locator('[contenteditable="true"]').fill(IMAGE_PROMPT)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const image = page.getByTestId('artboard-image-transform').last()
  await expect(image).toBeVisible({ timeout: 3 * 60_000 })

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
  await expect(page.getByTestId('artboard-image-transform').last()).toBeVisible()
}

test('[P-01] 使用 Gemini 模型生成图片 @image-generation', async ({ app, mainWindow: page }) => {
  await ensureCherryInSignedIn(app, page)
  await addCherryInModel(page, app.config.cherryIn.geminiImageModel, 'Image')
  await generateAndSaveImage(app, page, app.config.cherryIn.geminiImageModel, 'gemini-image.png')
})

test('[P-02] 使用 Image 2 模型生成图片 @image-generation', async ({ app, mainWindow: page }) => {
  await ensureCherryInSignedIn(app, page)
  await addCherryInModel(page, app.config.cherryIn.image2Model, 'Image 9')
  await generateAndSaveImage(app, page, app.config.cherryIn.image2Model, 'image2-image.png')
})
