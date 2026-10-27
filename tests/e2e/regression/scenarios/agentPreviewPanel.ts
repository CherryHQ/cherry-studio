import { copyFile, rm, writeFile } from 'node:fs/promises'
import { join, parse } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'
import { Document, Packer, Paragraph } from 'docx'
import JSZip from 'jszip'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { chooseNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { createAgent, openAgentPane, selectAgentWorkspace, startNewAgentTask } from '../helpers/agents'
import { openAttachmentPicker } from '../helpers/chat'
import { ensureCustomChatProvider } from '../helpers/models'
import { closeSettings } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function agentPreviewPanel(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const markdownName = 'MP19 preview with spaces.md'
  const secondName = 'MP19 second file.md'
  const docxName = 'MP19 selectable document.docx'
  const videoName = 'MP19 native video.mp4'
  const slidesName = 'MP19 presentation.pptx'
  const markdown = '# MP19 preview\n\nSelectable preview quotation MP19.\n'
  await writeFile(join(app.paths.fixtures, markdownName), markdown)
  await writeFile(join(app.paths.fixtures, secondName), '# Second preview\n\nMP19 second attachment.\n')
  await writeFile(
    join(app.paths.fixtures, docxName),
    await Packer.toBuffer(
      new Document({
        sections: [
          { children: Array.from({ length: 60 }, (_, i) => new Paragraph(`MP19 selectable document paragraph ${i}`)) }
        ]
      })
    )
  )
  await copyFile(app.fixturesPath('media', 'sample-5s.mp4'), join(app.paths.fixtures, videoName))
  const slides = new JSZip()
  slides.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>'
  )
  slides.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>'
  )
  slides.file(
    'ppt/presentation.xml',
    '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'
  )
  await writeFile(join(app.paths.fixtures, slidesName), await slides.generateAsync({ type: 'nodebuffer' }))

  // Preview uses real attachments and the configured provider; no response is injected.
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const agentName = app.resourceName('Preview Agent')
  await createAgent(page, {
    name: agentName,
    runtime: 'Pi',
    model: app.config.customProvider.chatModel,
    permission: 'Full Access'
  })
  await startNewAgentTask(page, agentName)
  const view = page.locator('[data-ui~="agent.view"]:visible').first()
  await rm(join(app.paths.workspace, 'TASK.md'), { force: true })
  await selectAgentWorkspace(app, page)
  await openAgentPane(page, 'Files')
  await screenshot('MP-19 initial preview panel')
  await expect(page.getByTestId('artifact-pane-header')).toBeVisible()
  await expect(page.getByRole('treeitem', { name: app.workspaceName, exact: true })).toBeVisible()
  const composer = view.locator('[data-ui~="chat.composer"]:visible')
  const editor = composer.locator('[contenteditable="true"]').first()
  const messages = view.locator('[data-ui~="chat.message"]:visible')
  const overlay = page.getByTestId('artifact-file-preview-overlay')
  const header = page.getByTestId('artifact-pane-header')
  const attachment = (name: string) => messages.getByRole('button', { name: parse(name).name, exact: true })
  const attachAndSend = async (name: string) => {
    await openAttachmentPicker(page, composer)
    chooseNativeFile(app.record.platform, app.paths, join(app.paths.fixtures, name))
    await expect(composer.locator('[data-composer-token-kind="file"]').filter({ hasText: name })).toBeVisible()
    await editor.press('End')
    await editor.pressSequentially(' Reply with only MP19_RECEIVED; do not use tools.')
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(attachment(name)).toBeVisible({ timeout: 30_000 })
    await expect(view.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 90_000 })
  }
  const open = async (name: string) => {
    await attachment(name).click()
    await expect(overlay).toBeVisible()
    await expect(page.getByTestId('artifact-pane-header-title')).toHaveText(parse(name).name)
    await expect(overlay.locator('[contenteditable="true"], textarea')).toHaveCount(0)
  }
  await attachAndSend(markdownName)
  await open(markdownName)
  await expect(overlay).toContainText('Selectable preview quotation MP19.')
  await screenshot('MP-19 markdown read-only preview')
  await overlay.getByRole('radio', { name: 'Source', exact: true }).click()
  await expect(overlay).toContainText('# MP19 preview')
  await overlay.getByRole('radio', { name: 'Preview', exact: true }).click()
  await expect(overlay.getByRole('heading', { name: 'MP19 preview', exact: true })).toBeVisible()
  await header.getByRole('button', { name: 'Copy Content', exact: true }).click()
  await expect
    .poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')))
    .toBe(markdown)
  await writeFile(join(app.paths.fixtures, markdownName), `${markdown}\nMP19 refreshed content\n`)
  await header.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(overlay).toContainText('MP19 refreshed content')
  await header.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(overlay).toBeHidden()
  await attachAndSend(secondName)
  await open(markdownName)
  await open(secondName)
  await open(secondName)
  await header.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByTestId('artifact-pane-header-title')).toHaveText(parse(markdownName).name)
  await header.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(overlay).toBeHidden()

  await attachAndSend(docxName)
  await open(docxName)
  const paragraph = overlay.getByText('MP19 selectable document paragraph 0', { exact: true })
  await expect(paragraph).toBeVisible()
  await paragraph.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  })
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('MP19 selectable document paragraph 0')
  const docxScroll = overlay.getByRole('region', { name: docxName, exact: true })
  await docxScroll.hover()
  await page.mouse.wheel(0, 300)
  await expect.poll(() => docxScroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await screenshot('MP-19 selectable DOCX preview')
  await header.getByRole('button', { name: 'Back', exact: true }).click()
  await attachAndSend(videoName)
  await open(videoName)
  await expect(overlay.locator('video[controls]')).toBeVisible()
  await expect
    .poll(() => overlay.locator('video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(1)
  await header.getByRole('button', { name: 'Back', exact: true }).click()
  await attachAndSend(slidesName)
  await open(slidesName)
  await expect(overlay.getByRole('region', { name: slidesName, exact: true })).toBeVisible()
  await expect(overlay.getByRole('alert')).toContainText('Preview failed')
  await screenshot('MP-19 empty presentation reports a preview error')
  await header.getByRole('button', { name: 'Back', exact: true }).click()

  const preferences = await page.evaluate(async () => ({
    enabled: await window.api.preference.get('chat.input.paste_long_text_as_file'),
    threshold: await window.api.preference.get('chat.input.paste_long_text_threshold')
  }))
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'chat.input.paste_long_text_as_file': true,
        'chat.input.paste_long_text_threshold': 100
      })
    )
    const pasted = Array.from({ length: 20 }, (_, i) => `MP19 pasted line ${i}: text preserved in preview.`).join('\n')
    await page.evaluate((text) => navigator.clipboard.writeText(text), pasted)
    await editor.click()
    await editor.press('ControlOrMeta+v')
    await expect(composer.locator('[data-composer-token-kind="file"]')).toHaveCount(1)
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    await messages.getByRole('button', { name: /Pasted Text/, exact: true }).click()
    await expect(overlay.getByText(/^MP19 pasted line \d+: text preserved in preview\.$/)).toHaveText(
      pasted.split('\n')
    )
    const firstLine = pasted.split('\n')[0]
    const text = overlay.getByText(firstLine, { exact: true })
    await text.evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(firstLine)
    await header.getByRole('button', { name: 'Back', exact: true }).click()
    await editor.click()
    await editor.press('ControlOrMeta+v')
    await expect(composer).toContainText(firstLine)
    testInfo.annotations.push({
      type: 'uncovered',
      description:
        'The text preview plugin has no Quote selection action; selected text is checked through copy and paste.'
    })
    await screenshot('MP-19 selected pasted text copied back to composer')
    await expect(view).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await page.evaluate(
      (preferences) =>
        window.api.preference.setMultiple({
          'chat.input.paste_long_text_as_file': preferences.enabled,
          'chat.input.paste_long_text_threshold': preferences.threshold
        }),
      preferences
    )
  }
}
