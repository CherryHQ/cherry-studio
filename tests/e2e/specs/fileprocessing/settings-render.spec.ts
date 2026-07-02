import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { FileProcessingPage } from '../../pages/file-processing.page'
import { t } from '../../utils/i18n'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (fp-l1, light-medium.md §2 FP-L1): the file-processing settings page is reachable; both
 * feature sections (OCR / 文档处理) render; all processor menu items show under each section; the
 * platform filter hides `ovocr` (Win+Intel only) on macOS. Pure read-only, offline.
 */
test.describe('File processing · settings render & platform filter', () => {
  test('renders both sections, all processors, and filters ovocr on macOS', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const fp = new FileProcessingPage(mainWindow)
    await fp.goto()

    // page title + both feature sections
    await expect(fp.pageTitle).toBeVisible()
    await expect(fp.sectionTitle('image_to_text')).toBeVisible()
    await expect(fp.sectionTitle('document_to_markdown')).toBeVisible()

    // document_to_markdown menu items
    for (const id of ['mineru', 'doc2x', 'paddleocr', 'mistral', 'open-mineru']) {
      await expect(fp.menuItem('document_to_markdown', id)).toBeVisible()
    }

    // image_to_text menu items
    for (const id of ['system', 'paddleocr', 'tesseract', 'mistral']) {
      await expect(fp.menuItem('image_to_text', id)).toBeVisible()
    }

    // platform filter: ovocr (Win+Intel) hidden on macOS
    await expect(fp.menuItem('image_to_text', 'ovocr')).toBeHidden()

    // sanity: title literal resolves to the zh-CN golden string
    expect(t('settings.tool.file_processing.title')).toBe('文档解析')
  })
})
