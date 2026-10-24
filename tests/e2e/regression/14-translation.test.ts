import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { saveNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
import { expect, test } from './fixture'
import { ensureCustomChatProvider, selectVisibleModel } from './models'
import { selectSidebarApp } from './navigation'
import { closeSettings, closeOpenSettingsDrawer, openSettingsSection } from './settings'
import { BUILTIN_TRANSLATE_LANGUAGES } from '@shared/data/presets/translateLanguages'
import { createUniqueModelId } from '@shared/data/types/model'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { startTranslationSettingsServer } from './translationSettingsServer'
import { TranslateHistorySchema, type TranslateHistory } from '@shared/data/types/translate'
import type { TranslateHistoryListResponse } from '@shared/data/api/schemas/translate'
import type { AiUsageRecordListResponse } from '@shared/data/api/schemas/aiUsageRecords'
import type { DataResponse } from '@shared/data/api/types'

test(...caseDefinition('MP-81'), async ({ mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const readHistory = async () => {
    const response = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'mp81-list', method: 'GET', path: '/translate/histories' })
    )
    expect(response.status).toBe(200)
    return response.data as { items: TranslateHistory[]; total: number }
  }
  // Clearing must only affect this case's records in the isolated QA profile.
  expect((await readHistory()).total).toBe(0)
  const preferences = await page.evaluate(async () => ({
    source: await window.api.preference.get('feature.translate.page.source_language'),
    target: await window.api.preference.get('feature.translate.page.target_language')
  }))
  const history: TranslateHistory[] = []

  try {
    // Seed completed text pairs through the real DataApi; no model response is under test.
    for (const [sourceText, targetText] of [
      ['MP81 Zebra crosses the road.', 'MP81 斑马穿过马路。'],
      ['MP81 Apple trees bloom.', 'MP81 苹果树开花了。'],
      ['MP81 Morning sunlight fills the room.', 'MP81 晨光洒满房间。']
    ]) {
      const response = await page.evaluate(
        (body) =>
          window.api.dataApi.request({
            id: 'mp81-create',
            method: 'POST',
            path: '/translate/histories',
            body
          }),
        { sourceText, targetText, sourceLanguage: 'en-us', targetLanguage: 'zh-cn' }
      )
      expect(response.status).toBe(201)
      history.push(TranslateHistorySchema.parse(response.data))
    }
    expect(new Set(history.map(({ createdAt }) => createdAt)).size).toBe(3)
    const newestFirst = [...history].reverse()
    expect(newestFirst.map(({ createdAt }) => createdAt)).toEqual(
      history
        .map(({ createdAt }) => createdAt)
        .sort()
        .reverse()
    )

    await selectSidebarApp(page, 'Translation')
    const view = page.locator('[data-ui~="translate.view"]')
    const openHistory = view.getByRole('button', { name: 'Translation History', exact: true })
    await openHistory.click()
    const panel = page.locator('[data-slot="page-side-panel"]')
    const rows = panel.getByRole('button').filter({ has: page.getByRole('button', { name: 'Favorite', exact: true }) })
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Translation History (3)')
    await expect(rows).toHaveCount(3)
    for (const [index, item] of newestFirst.entries()) {
      await expect(rows.nth(index).getByText(item.sourceText, { exact: true })).toBeVisible()
      await expect(rows.nth(index).getByText(item.targetText, { exact: true })).toBeVisible()
    }
    await attachScreenshot('MP-81 newest-first translation history')

    const favorite = rows.nth(1).getByRole('button', { name: 'Favorite', exact: true })
    await rows.nth(1).hover()
    await favorite.click()
    await expect(favorite).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await readHistory()).items.find(({ id }) => id === history[1].id)?.star).toBe(true)
    const starredFilter = panel.getByRole('button', { name: 'Only starred', exact: true })
    await starredFilter.click()
    await expect(starredFilter).toHaveAttribute('aria-pressed', 'true')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(history[1].sourceText)
    await expect(rows.first()).toContainText(history[1].targetText)
    await expect(panel.getByText(history[0].sourceText, { exact: true })).toBeHidden()
    await expect(panel.getByText(history[2].sourceText, { exact: true })).toBeHidden()
    await attachScreenshot('MP-81 favorites filter')

    await rows.first().click()
    await panel.getByRole('button', { name: 'Reuse', exact: true }).click()
    await expect(panel).toBeHidden()
    await expect(view.locator('[data-ui~="translate.input"] textarea')).toHaveValue(history[1].sourceText)
    await expect(view.locator('[data-ui~="translate.output"]')).toContainText(history[1].targetText)
    await attachScreenshot('MP-81 reused source and translation')

    await openHistory.click()
    await panel.getByRole('button', { name: 'Only starred', exact: true }).click()
    await expect(rows).toHaveCount(3)
    await panel.getByText(history[0].sourceText, { exact: true }).click()
    const deleteButton = panel.getByRole('button', { name: 'Delete translation history', exact: true })
    const deleteDialog = page.getByRole('dialog', { name: 'Delete translation history', exact: true })
    await deleteButton.click()
    await expect(deleteDialog).toBeVisible()
    expect((await readHistory()).total).toBe(3)
    await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(deleteDialog).toBeHidden()
    expect((await readHistory()).items.map(({ id }) => id)).toContain(history[0].id)
    await expect(panel.getByText(history[0].sourceText, { exact: true })).toBeVisible()
    await deleteButton.click()
    await deleteDialog.getByRole('button', { name: 'Delete translation history', exact: true }).click()
    await expect(deleteDialog).toBeHidden()
    await expect(rows).toHaveCount(2)
    await expect(panel.getByText(history[0].sourceText, { exact: true })).toBeHidden()
    await expect
      .poll(async () => (await readHistory()).items.map(({ id }) => id))
      .toEqual([history[2].id, history[1].id])

    const clearButton = panel.getByRole('button', { name: 'Clear History', exact: true })
    const clearDialog = page.getByRole('dialog', { name: 'Clear History', exact: true })
    await clearButton.click()
    await expect(clearDialog).toBeVisible()
    await expect(clearDialog).toContainText(
      'Clear history will delete all translation history and reclaim the translated files it produced, continue?'
    )
    expect((await readHistory()).total).toBe(2)
    await clearDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(clearDialog).toBeHidden()
    await expect(rows).toHaveCount(2)
    expect((await readHistory()).total).toBe(2)
    await clearButton.click()
    await attachScreenshot('MP-81 clear confirmation with file reclamation warning')
    await clearDialog.getByRole('button', { name: 'Clear History', exact: true }).click()
    await expect(clearDialog).toBeHidden()
    await expect(panel.getByText('No translation history', { exact: true })).toBeVisible()
    await expect(rows).toHaveCount(0)
    await expect.poll(readHistory).toMatchObject({ items: [], total: 0 })
    await attachScreenshot('MP-81 empty history after clearing')
    await panel.locator('[data-slot="page-side-panel-close"]').click()
    await expect(panel).toBeHidden()
  } finally {
    await page.evaluate(
      async ({ ids, preferences }) => {
        for (const id of ids) {
          await window.api.dataApi.request({ id: 'mp81-cleanup', method: 'DELETE', path: `/translate/histories/${id}` })
        }
        await window.api.preference.setMultiple({
          'feature.translate.page.source_language': preferences.source,
          'feature.translate.page.target_language': preferences.target
        })
      },
      { ids: history.map(({ id }) => id), preferences }
    )
  }
})

test(...caseDefinition('MP-82'), async ({ app, mainWindow: page }, testInfo) => {
  // Catches dropped documents losing structure, missing progress/counts, and unavailable or misnamed exports.
  const root = await mkdtemp(join(process.cwd(), 'tests/e2e/regression/mp82-assets-'))
  const documents = join(root, 'test-assets', 'documents')
  await mkdir(documents, { recursive: true })
  const suppliedSample = join(process.cwd(), 'test-assets/documents/sample-chinese.md')
  const sample = (await access(suppliedSample).then(
    () => true,
    () => false
  ))
    ? suppliedSample
    : join(documents, 'sample-chinese.md')
  if (sample !== suppliedSample) {
    await writeFile(
      sample,
      '# 春日旅行\n\n今天我们一起去公园散步，欣赏盛开的鲜花。\n\n## 旅行计划\n\n明天我们将参观博物馆，了解这座城市的历史。\n',
      'utf8'
    )
    testInfo.annotations.push({
      type: 'fixture',
      description: 'Missing checkout sample: generated Chinese Markdown fixture.'
    })
  }
  testInfo.annotations.push({ type: 'provider', description: 'Uses the run-configured real translation provider.' })
  const source = await readFile(sample, 'utf8')
  const oversized = join(documents, 'oversized.md')
  await writeFile(oversized, Buffer.alloc(5 * 1024 * 1024 + 1, 'a'))
  const preferences = await page.evaluate(async () => ({
    bidirectional: await window.api.preference.get('feature.translate.page.bidirectional_enabled'),
    markdown: await window.api.preference.get('feature.translate.page.enable_markdown'),
    detection: await window.api.preference.get('feature.translate.auto_detection_method'),
    target: await window.api.preference.get('feature.translate.page.target_language'),
    model: await window.api.preference.get('feature.translate.model_id')
  }))
  const view = page.locator('[data-ui~="translate.view"]')
  const inputPane = view.locator('[data-ui~="translate.input"]')
  const input = inputPane.getByRole('textbox')
  const output = view.locator('[data-ui~="translate.output"]')
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const drop = async (path: string) => {
    // Browser-backed files preserve the OS path consumed by Electron's webUtils.getPathForFile.
    const handle = await page.evaluateHandle(() => {
      const element = document.createElement('input')
      element.type = 'file'
      document.body.append(element)
      return element
    })
    try {
      await handle.asElement()!.setInputFiles(path)
      await inputPane.evaluate((target, element) => {
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(element.files![0])
        for (const type of ['dragenter', 'dragover', 'drop']) {
          target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
        }
      }, handle)
    } finally {
      await handle.evaluate((element) => element.remove())
      await handle.dispose()
    }
  }
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'feature.translate.page.bidirectional_enabled': false,
        'feature.translate.page.enable_markdown': true,
        'feature.translate.auto_detection_method': 'franc'
      })
    )
    await ensureCustomChatProvider(app, page)
    await closeSettings(page)
    await selectSidebarApp(page, 'Translation')
    await expect(view).toBeVisible()
    await view.locator('[data-selector-shell-root="true"] > button').click()
    await selectVisibleModel(page, app.config.customProvider.chatModel)
    await input.fill('')

    await drop(oversized)
    await expect(page.getByText('File too large (0 ~ 5 MB)', { exact: true })).toBeVisible()
    await expect(input).toHaveValue('')
    await screenshot('MP-82 oversized document limit')

    await drop(sample)
    await expect(input).toHaveValue(source)
    await screenshot('MP-82 document loaded')
    await expect
      .soft(inputPane.getByText(String(source.length), { exact: true }), 'Source character count must be visible')
      .toBeVisible({ timeout: 3_000 })
    const targetLanguage = view.getByRole('button', { name: /^Target Language\b/ })
    await targetLanguage.click()
    await page.getByRole('option').filter({ hasText: 'English' }).click()
    await expect(targetLanguage).toContainText('English')
    await view.getByRole('button', { name: 'Translate', exact: true }).click()
    await expect(output.getByText('Translation in progress...', { exact: true })).toBeVisible()
    await expect(view.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await screenshot('MP-82 translation progress')
    await expect(view.getByRole('button', { name: 'Stop', exact: true })).toBeHidden({ timeout: 120_000 })
    await expect(output.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(output.getByRole('heading', { level: 2 })).toHaveCount(1)
    await expect(output.locator('p')).toHaveCount(2)
    const translation = await output.locator('h1, h2, p').allTextContents()
    expect(translation.every((text) => text.trim().length > 0)).toBe(true)
    expect(translation.join('\n')).not.toMatch(/[\u3400-\u9fff]/)
    await screenshot('MP-82 translated document and export controls')

    const save = view.getByRole('button', {
      name: /save (?:translated|translation|target).*file|save (?:translation )?as|另存译文文件/i
    })
    await expect(save, 'Markdown translation must offer Save translated file as').toBeVisible({ timeout: 3_000 })
    await save.click()
    if (app.record.platform !== 'macos') throw new Error('UNCOVERED: Native save filename inspection requires macOS')
    const fileName = execFileSync(
      'osascript',
      [
        '-e',
        [
          'on run argv',
          'tell application "System Events"',
          'tell (first application process whose unix id is (item 1 of argv as integer))',
          'repeat 100 times',
          'set fields to every UI element of entire contents of window 1 whose role is "AXTextField"',
          'repeat with field in fields',
          'set candidate to value of field as text',
          'if candidate ends with ".md" then return candidate',
          'end repeat',
          'delay 0.1',
          'end repeat',
          'error "Native save filename was not found"',
          'end tell',
          'end tell',
          'end run'
        ].join('\n'),
        '--',
        String(app.record.electronPid)
      ],
      { encoding: 'utf8', timeout: 15_000 }
    ).trim()
    expect(fileName).toBe(basename(fileName))
    expect(fileName).toMatch(/^sample-chinese[_-](?:en(?:[_-]us)?|english)\.md$/i)
    const savedPath = saveNativeFile(app.record.platform, app.paths, join(app.paths.evidence, fileName))
    await expect.poll(() => readFile(savedPath, 'utf8'), { timeout: 15_000 }).toMatch(/^# .+\n/m)
    const saved = await readFile(savedPath, 'utf8')
    expect(saved).toMatch(/^## .+\n/m)
    for (const paragraph of translation) expect(saved).toContain(paragraph)
    await testInfo.attach('MP-82 saved translation', { path: savedPath, contentType: 'text/markdown' })
    await screenshot('MP-82 translation saved')
  } finally {
    await page.evaluate(
      (preferences) =>
        window.api.preference.setMultiple({
          'feature.translate.page.bidirectional_enabled': preferences.bidirectional,
          'feature.translate.page.enable_markdown': preferences.markdown,
          'feature.translate.auto_detection_method': preferences.detection,
          'feature.translate.page.target_language': preferences.target,
          'feature.translate.model_id': preferences.model
        }),
      preferences
    )
    await rm(root, { recursive: true, force: true })
  }
})

test(...caseDefinition('MP-83'), async ({ app, mainWindow: page }, testInfo) => {
  // Catches lost OCR text, translations unrelated to the image, and silent empty OCR results.
  const root = await mkdtemp(join(process.cwd(), 'tests/e2e/regression/mp83-assets-'))
  const images = join(root, 'test-assets/images')
  await mkdir(images, { recursive: true })
  const suppliedSample = join(process.cwd(), 'test-assets/images/sample.png')
  const supplied = await access(suppliedSample).then(
    () => true,
    () => false
  )
  const sample = supplied ? suppliedSample : join(images, 'sample.png')
  const blank = join(images, 'no-text.png')
  const pngs = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 400
    const context = canvas.getContext('2d')!
    context.fillStyle = 'white'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const blank = canvas.toDataURL('image/png').split(',')[1]
    context.fillStyle = 'black'
    context.font = '48px Arial'
    context.fillText('The red apple is on the table.', 60, 140)
    context.fillText('There are seven blue books.', 60, 240)
    return { blank, sample: canvas.toDataURL('image/png').split(',')[1] }
  })
  if (!supplied) {
    await writeFile(sample, Buffer.from(pngs.sample, 'base64'))
    testInfo.annotations.push({ type: 'fixture', description: 'Missing sample.png: generated known English image.' })
  }
  await writeFile(blank, Buffer.from(pngs.blank, 'base64'))
  await testInfo.attach('MP-83 source image', { path: sample, contentType: 'image/png' })
  await testInfo.attach('MP-83 no-text image', { path: blank, contentType: 'image/png' })
  testInfo.annotations.push({
    type: 'provider',
    description: 'Real system OCR and run-configured translation provider.'
  })
  const preferences = await page.evaluate(async () => ({
    ocr: await window.api.preference.get('feature.file_processing.default_image_to_text'),
    bidirectional: await window.api.preference.get('feature.translate.page.bidirectional_enabled'),
    detection: await window.api.preference.get('feature.translate.auto_detection_method'),
    source: await window.api.preference.get('feature.translate.page.source_language'),
    target: await window.api.preference.get('feature.translate.page.target_language'),
    model: await window.api.preference.get('feature.translate.model_id')
  }))
  const view = page.locator('[data-ui~="translate.view"]')
  const inputPane = view.locator('[data-ui~="translate.input"]')
  const input = inputPane.getByRole('textbox')
  const output = view.locator('[data-ui~="translate.output"]')
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const drop = async (path: string) => {
    // Browser-backed files retain the native path required by Electron's drop handler.
    const handle = await page.evaluateHandle(() => {
      const element = document.createElement('input')
      element.type = 'file'
      document.body.append(element)
      return element
    })
    try {
      await handle.asElement()!.setInputFiles(path)
      await inputPane.evaluate((target, element) => {
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(element.files![0])
        for (const type of ['dragenter', 'dragover', 'drop']) {
          target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
        }
      }, handle)
    } finally {
      await handle.evaluate((element) => element.remove())
      await handle.dispose()
    }
  }
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'feature.file_processing.default_image_to_text': 'system',
        'feature.translate.page.bidirectional_enabled': false,
        'feature.translate.auto_detection_method': 'franc',
        'feature.translate.page.source_language': 'en-us',
        'feature.translate.page.target_language': 'zh-cn'
      })
    )
    await ensureCustomChatProvider(app, page)
    await closeSettings(page)
    await selectSidebarApp(page, 'Translation')
    await expect(view).toBeVisible()
    await view.locator('[data-selector-shell-root="true"] > button').click()
    await selectVisibleModel(page, app.config.customProvider.chatModel)
    await input.fill('')
    await drop(sample)
    await expect(page.getByText('Image OCR complete', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(input).not.toHaveValue('')
    const recognized = await input.inputValue()
    expect(recognized).toMatch(/[a-z]{3,}/i)
    if (!supplied) {
      expect(recognized).toMatch(/red apple.*table/is)
      expect(recognized).toMatch(/seven blue books/is)
    }
    await screenshot('MP-83 recognized English and OCR completion')
    await view.getByRole('button', { name: 'Translate', exact: true }).click()
    await expect(output).toContainText(/[\u3400-\u9fff]/, { timeout: 120_000 })
    await expect(view.getByRole('button', { name: 'Stop', exact: true })).toBeHidden({ timeout: 120_000 })
    if (!supplied) {
      await expect(output).toContainText(/红.*苹果/)
      await expect(output).toContainText(/桌/)
      await expect(output).toContainText(/七|7/)
      await expect(output).toContainText(/蓝.*书/)
    } else {
      throw new Error('Supplied sample.png needs a reviewed expected transcription and translation before it can pass')
    }
    await expect(input).toHaveValue(recognized)
    await screenshot('MP-83 translation corresponding to recognized text')

    await input.fill('')
    await drop(blank)
    await expect(input).toBeEditable({ timeout: 60_000 })
    await screenshot('MP-83 no-text image OCR outcome')
    await expect(
      page.getByText(
        /no (?:text|words).*?(?:found|detected|recogniz)|(?:cannot|could not|unable to) (?:detect|recogniz).*text|识别不到文字|未识别到文字|未检测到文字/i
      )
    ).toBeVisible({ timeout: 10_000 })
    await expect(input).toHaveValue('')
    await screenshot('MP-83 readable no-text explanation')
  } catch (error) {
    await screenshot('MP-83 failure with application state')
    throw error
  } finally {
    await page.evaluate(
      (preferences) =>
        window.api.preference.setMultiple({
          'feature.file_processing.default_image_to_text': preferences.ocr,
          'feature.translate.page.bidirectional_enabled': preferences.bidirectional,
          'feature.translate.auto_detection_method': preferences.detection,
          'feature.translate.page.source_language': preferences.source,
          'feature.translate.page.target_language': preferences.target,
          'feature.translate.model_id': preferences.model
        }),
      preferences
    )
    await rm(root, { recursive: true, force: true })
  }
})

test(...caseDefinition('MP-85'), async ({ mainWindow: page }, testInfo) => {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    'feature.translate.model_id': await window.api.preference.get('feature.translate.model_id'),
    'feature.translate.page.source_language': await window.api.preference.get('feature.translate.page.source_language'),
    'feature.translate.page.target_language': await window.api.preference.get('feature.translate.page.target_language'),
    'feature.translate.page.bidirectional_enabled': await window.api.preference.get(
      'feature.translate.page.bidirectional_enabled'
    ),
    'feature.translate.model_prompt': await window.api.preference.get('feature.translate.model_prompt')
  }))
  const readLanguages = async () => {
    const result = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'mp85-languages', method: 'GET', path: '/translate/languages' })
    )
    expect(result.status).toBe(200)
    return result.data as TranslateLanguage[]
  }
  const before = await readLanguages()
  const langCode = 'qaa-qa'
  const name = 'MP85 Elvish'
  expect(before.some((language) => language.langCode === langCode)).toBe(false)
  const server = await startMockChatServer()
  const providerId = `regression-mp85-${Date.now()}`
  const panel = page.getByRole('dialog', { name: 'Translation Settings', exact: true })
  const customSection = panel.getByText('Custom language', { exact: true }).locator('../..')
  const row = customSection.locator('div.group').filter({ hasText: name })
  const target = page.getByRole('button', { name: /^Target Language\b/ })
  const openSettings = async () => {
    await page.getByRole('button', { name: 'Translation Settings', exact: true }).click()
    await expect(panel).toBeVisible()
  }
  const closeSettings = async () => {
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(panel).toBeHidden()
  }
  const addLanguage = async (displayName: string, code: string) => {
    await panel.getByRole('button', { name: 'Add Language', exact: true }).click()
    await panel.getByRole('textbox', { name: 'Language name', exact: true }).fill(displayName)
    await panel.getByRole('textbox', { name: 'Language code', exact: true }).fill(code)
    await panel.getByRole('button', { name: 'Add', exact: true }).click()
  }

  try {
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: 'mp85-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP85 translation mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp85-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      ({ providerId, modelId }) =>
        window.api.dataApi.request({
          id: 'mp85-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    await page.evaluate(
      (modelId) =>
        window.api.preference.setMultiple({
          'feature.translate.model_id': modelId,
          'feature.translate.page.source_language': 'en-us',
          'feature.translate.page.bidirectional_enabled': false,
          'feature.translate.model_prompt': 'Translate this text into {{target_language}}: {{text}}'
        }),
      createUniqueModelId(providerId, server.modelId)
    )
    await selectSidebarApp(page, 'Translation')
    await openSettings()
    await addLanguage(name, langCode)
    await expect(row).toBeVisible()
    await expect(row).toContainText(langCode)
    await expect
      .poll(async () => (await readLanguages()).filter((language) => language.langCode === langCode))
      .toEqual([expect.objectContaining({ langCode, value: name })])
    await screenshot('MP-85 custom language added')
    await closeSettings()

    await target.click()
    await page.getByRole('option').filter({ hasText: name }).click()
    await expect(target).toContainText(name)
    const input = 'Good morning, my friend. MP85 translation source.'
    const answer = 'Aear calad, mellon nin. MP85 translated result.'
    await page.locator('[data-ui="translate.input"] textarea').fill(input)
    // The real HTTP request must carry the selected custom language, not just return a canned success.
    await Promise.all([
      page.locator('[data-ui="translate.view"]').getByRole('button', { name: 'Translate', exact: true }).click(),
      (async () => {
        const request = await server.nextRequest(30_000)
        expect(request.body.model).toBe(server.modelId)
        expect(JSON.stringify(request.body.messages)).toContain(name)
        expect(JSON.stringify(request.body.messages)).toContain(input)
        request.complete(answer)
      })()
    ])
    await expect(page.locator('[data-ui="translate.output"]')).toContainText(answer)
    await screenshot('MP-85 custom target translation via HTTP mock')

    await openSettings()
    await addLanguage('MP85 duplicate', langCode)
    await expect(panel.getByText('The language already exists', { exact: true })).toBeVisible()
    await expect(panel.getByRole('textbox', { name: 'Language code', exact: true })).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect((await readLanguages()).filter((language) => language.langCode === langCode)).toEqual([
      expect.objectContaining({ value: name })
    ])
    await screenshot('MP-85 duplicate code rejected')
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click()

    for (const builtin of BUILTIN_TRANSLATE_LANGUAGES) {
      await expect(customSection.getByText(builtin.langCode, { exact: true })).toHaveCount(0)
    }
    await row.hover()
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Delete custom language', exact: true })
    await expect(confirmation).toBeVisible()
    expect((await readLanguages()).some((language) => language.langCode === langCode)).toBe(true)
    await screenshot('MP-85 delete confirmation')
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(confirmation).toBeHidden()
    await expect(row).toBeVisible()
    await row.hover()
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(confirmation).toBeHidden()
    await expect(row).toHaveCount(0)
    await expect
      .poll(async () => (await readLanguages()).some((language) => language.langCode === langCode))
      .toBe(false)
    expect(await readLanguages()).toEqual(before)
    await screenshot('MP-85 custom language removed and builtins protected')
    await closeSettings()
    await target.click()
    await expect(page.getByRole('option').filter({ hasText: name })).toHaveCount(0)
    const english = page.getByRole('option').filter({ hasText: 'English' })
    await expect(english).toBeVisible()
    await expect(english.getByRole('button', { name: /delete/i })).toHaveCount(0)
    await english.click()
    await expect(target).toContainText('English')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ preferences, providerId, langCode }) => {
        await window.api.preference.setMultiple(preferences)
        await window.api.dataApi.request({
          id: 'mp85-clean-language',
          method: 'DELETE',
          path: `/translate/languages/${langCode}`
        })
        await window.api.dataApi.request({
          id: 'mp85-clean-provider',
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { preferences, providerId, langCode }
    )
  }
})

test(...caseDefinition('MP-86'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const keys = [
    'feature.translate.model_id',
    'feature.quick_assistant.model_id',
    'feature.translate.page.auto_copy',
    'feature.translate.auto_detection_method',
    'feature.translate.page.source_language',
    'feature.translate.page.target_language',
    'feature.translate.page.bidirectional_enabled'
  ] as const
  const preferences = await page.evaluate(
    async (keys) =>
      Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await window.api.preference.get(key)]))),
    keys
  )
  const server = await startTranslationSettingsServer()
  const providerId = `regression-mp86-${Date.now()}`
  const modelIds = ['mp86-model-a', 'mp86-model-b']
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const selectModel = async (modelId: string) => {
    await openSettingsSection(page, 'Default Model')
    const row = page.locator('#setting-model-translate-model')
    await row.locator('[data-selector-shell-root="true"] > button').click()
    await selectVisibleModel(page, modelId)
    await expect(row).toContainText(modelId)
    await expect
      .poll(() => page.evaluate(() => window.api.preference.get('feature.translate.model_id')))
      .toBe(createUniqueModelId(providerId, modelId))
    await selectSidebarApp(page, 'Translation')
  }
  const openTranslationSettings = async () => {
    await page.getByRole('button', { name: 'Translation Settings', exact: true }).click()
    const panel = page.locator('[data-slot="page-side-panel"][role="dialog"]:visible')
    await expect(panel).toBeVisible()
    return panel
  }
  try {
    const created = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: 'mp86-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-86 HTTP fixture',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(created.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp86-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      ({ providerId, modelIds }) =>
        window.api.dataApi.request({
          id: 'mp86-models',
          method: 'POST',
          path: '/models',
          body: modelIds.map((modelId) => ({ providerId, modelId, endpointTypes: ['openai-chat-completions'] }))
        }),
      { providerId, modelIds }
    )
    expect(models.status).toBe(201)
    await page.evaluate(
      (quickModelId) =>
        window.api.preference.setMultiple({
          'feature.quick_assistant.model_id': quickModelId,
          'feature.translate.page.auto_copy': false,
          'feature.translate.auto_detection_method': 'auto',
          'feature.translate.page.source_language': 'auto',
          'feature.translate.page.target_language': 'en-us',
          'feature.translate.page.bidirectional_enabled': false
        }),
      createUniqueModelId(providerId, modelIds[0])
    )
    await page.reload()
    await selectModel(modelIds[0])
    let panel = await openTranslationSettings()
    const copyRow = panel.locator('[data-ui="ui.page-side-panel-item"]').filter({ hasText: 'Copy after translation' })
    await copyRow.getByRole('switch').check()
    await expect(copyRow.getByRole('switch')).toBeChecked()
    await screenshot('MP-86 auto copy enabled')
    await closeOpenSettingsDrawer(page)

    for (const [index, method] of ['auto', 'franc', 'llm'].entries()) {
      if (index === 1) await selectModel(modelIds[1])
      panel = await openTranslationSettings()
      await panel.getByRole('radio', { name: ['Automatic', 'algorithm', 'LLM'][index], exact: true }).click()
      await expect
        .poll(() => page.evaluate(() => window.api.preference.get('feature.translate.auto_detection_method')))
        .toBe(method)
      await closeOpenSettingsDrawer(page)
      await page.bringToFront()
      await page.evaluate(() => navigator.clipboard.writeText('MP86 clipboard sentinel'))
      const requestOffset = server.requests.length
      const view = page.locator('[data-ui="translate.view"]')
      await view.locator('[data-ui="translate.input"] textarea').fill(server.inputs[index])
      await view.getByRole('button', { name: 'Translate', exact: true }).click()
      await expect(
        view.locator('[data-ui="translate.output"]').getByText(server.answers[index], { exact: true })
      ).toBeVisible({ timeout: 30_000 })
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(server.answers[index])
      await expect
        .poll(async () => {
          const histories = await page.evaluate(
            (search) =>
              window.api.dataApi.request({
                id: 'mp86-history',
                method: 'GET',
                path: '/translate/histories',
                params: { search }
              }) as Promise<DataResponse<TranslateHistoryListResponse>>,
            server.inputs[index]
          )
          expect(histories.status).toBe(200)
          return histories.data?.items.find((item) => item.sourceText === server.inputs[index])
        })
        .toMatchObject({ sourceLanguage: 'zh-cn', targetLanguage: 'en-us', targetText: server.answers[index] })
      const requests = server.requests.slice(requestOffset)
      const translation = requests.filter((request) => request.stream)
      expect(translation).toHaveLength(1)
      expect(translation[0].model).toBe(modelIds[index === 0 ? 0 : 1])
      expect(JSON.stringify(translation[0].messages)).toContain(server.inputs[index])
      const detections = requests.filter((request) => !request.stream)
      expect(detections).toHaveLength(method === 'franc' ? 0 : 1)
      for (const detection of detections) {
        expect(detection.model).toBe(modelIds[0])
        expect(JSON.stringify(detection.messages)).toContain('precisely identify the language')
        expect(JSON.stringify(detection.messages)).toContain(server.inputs[index])
      }
      await screenshot(`MP-86 ${method} translation and clipboard verified`)
    }

    await expect
      .poll(async () => {
        const usage = await page.evaluate(() =>
          window.api.dataApi.request({
            id: 'mp86-usage',
            method: 'GET',
            path: '/ai-usage-records',
            params: { limit: 100 }
          }) as Promise<DataResponse<AiUsageRecordListResponse>>
        )
        expect(usage.status).toBe(200)
        return usage.data?.items.filter(
          (item) => item.providerId === providerId && item.inputTokens === 17 && item.outputTokens === 3
        ).length
      })
      .toBe(2)
    await openSettingsSection(page, 'Usage')
    const usageRows = page.getByRole('row').filter({ hasText: modelIds[0] })
    await expect(usageRows.filter({ has: page.getByRole('cell', { name: '20', exact: true }) })).toHaveCount(2)
    await screenshot('MP-86 LLM detection token usage')

    page = await app.restart('authenticated')
    expect(await page.evaluate(() => window.api.preference.get('feature.translate.model_id'))).toBe(
      createUniqueModelId(providerId, modelIds[1])
    )
    expect(await page.evaluate(() => window.api.preference.get('feature.translate.page.auto_copy'))).toBe(true)
    expect(await page.evaluate(() => window.api.preference.get('feature.translate.auto_detection_method'))).toBe('llm')
    await openSettingsSection(page, 'Default Model')
    await expect(page.locator('#setting-model-translate-model')).toContainText(modelIds[1])
    await selectSidebarApp(page, 'Translation')
    panel = await openTranslationSettings()
    await expect(panel.getByRole('radio', { name: 'LLM', exact: true })).toBeChecked()
    await expect(
      panel
        .locator('[data-ui="ui.page-side-panel-item"]')
        .filter({ hasText: 'Copy after translation' })
        .getByRole('switch')
    ).toBeChecked()
    await screenshot('MP-86 settings persisted after restart')
  } finally {
    await server.close()
    page = await app.mainWindow()
    await page.evaluate(
      async ({ preferences, providerId }) => {
        await window.api.preference.setMultiple(preferences)
        await window.api.dataApi.request({ id: 'mp86-delete', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { preferences, providerId }
    )
  }
})
