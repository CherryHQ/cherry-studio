import type { Locator, Page } from '@playwright/test'

import { t } from '../utils/i18n'
import { BasePage } from './base.page'

export type FileFeature = 'image_to_text' | 'document_to_markdown'

/**
 * Page Object for the File Processing settings page (`/settings/file-processing`).
 *
 * Selector policy: locale-free `#fp-item-<feature>-<processorId>` menu ids and
 * `data-testid` (fp-menu-default-badge / fp-panel-default-badge / fp-apikey-row) first,
 * then role + accessible name, then placeholder / aria-label via `t()` (zh-CN golden).
 * The two `paddleocr` / `mistral` menu entries (one per feature section) are disambiguated
 * by the feature-scoped `id`.
 */
export class FileProcessingPage extends BasePage {
  constructor(page: Page) {
    super(page)
  }

  // ── Navigation ───────────────────────────────────────────────────────────────
  /** Bottom-left "设置" button → settings; then the "文档解析" submenu entry. */
  async goto(): Promise<void> {
    await this.page
      .locator(`[aria-label="${t('settings.title')}"]`)
      .first()
      .click()
    await this.page.getByText(t('settings.tool.file_processing.title'), { exact: true }).first().click()
  }

  // ── Page header / sections ─────────────────────────────────────────────────────
  get pageTitle(): Locator {
    return this.page.getByText(t('settings.tool.file_processing.title'), { exact: true })
  }

  /** Section heading for a feature ("OCR" / "文档处理"). */
  sectionTitle(feature: FileFeature): Locator {
    return this.page.getByText(t(`settings.tool.file_processing.features.${feature}.title`), { exact: true })
  }

  // ── Left menu (processor list) ─────────────────────────────────────────────────
  /** Menu item for a processor under a feature section (locale-free id). */
  menuItem(feature: FileFeature, processorId: string): Locator {
    return this.page.locator(`#fp-item-${feature}-${processorId}`)
  }

  async selectProcessor(feature: FileFeature, processorId: string): Promise<void> {
    await this.menuItem(feature, processorId).click()
  }

  /** Default Badge in the left menu, scoped by feature + processor (locale-free data-*). */
  menuDefaultBadge(feature: FileFeature, processorId: string): Locator {
    return this.page.locator(
      `[data-testid="fp-menu-default-badge"][data-feature="${feature}"][data-processor-id="${processorId}"]`
    )
  }

  // ── Right panel (ProcessorPanel) ────────────────────────────────────────────────
  /** Default Badge in the panel header; processor-id optional. */
  panelDefaultBadge(processorId?: string): Locator {
    const sel = processorId
      ? `[data-testid="fp-panel-default-badge"][data-processor-id="${processorId}"]`
      : '[data-testid="fp-panel-default-badge"]'
    return this.page.locator(sel)
  }

  get setDefaultButton(): Locator {
    return this.page.getByRole('button', {
      name: t('settings.tool.file_processing.actions.set_as_default'),
      exact: true
    })
  }

  /** API key (comma-separated) input, present only for api processors (type=password). */
  get apiKeysInput(): Locator {
    return this.page.getByPlaceholder(t('settings.tool.file_processing.fields.api_keys_placeholder'))
  }

  /** Button (aria-label) that opens the API key management dialog. */
  get apiKeyListOpen(): Locator {
    return this.page.locator(`[aria-label="${t('settings.provider.api.key.list.open')}"]`)
  }

  /** API host (api_base_url) input, present only for api processors. */
  get apiHostInput(): Locator {
    return this.page.getByPlaceholder(t('settings.provider.api_host'))
  }

  /** Builtin system OCR status block ("...引擎可用。"). */
  get systemStatusAvailable(): Locator {
    return this.page.getByText(t('settings.tool.file_processing.processors.system.status.available'))
  }

  /** Language-pack row title ("语言"), present for tesseract / system (Windows). */
  get languagesRow(): Locator {
    return this.page.getByText(t('settings.tool.file_processing.fields.languages'), { exact: true })
  }

  // ── PaddleOCR parse-model select ────────────────────────────────────────────────
  get parseModelTrigger(): Locator {
    return this.page.locator(
      `[aria-label="${t('settings.tool.file_processing.processors.paddleocr.fields.parse_model')}"]`
    )
  }

  parseModelOption(model: string): Locator {
    return this.page.getByRole('option', { name: model, exact: true })
  }

  /** Open the parse-model select, pick a model, wait for the menu to close. */
  async selectParseModel(model: string): Promise<void> {
    await this.parseModelTrigger.click()
    await this.parseModelOption(model).click()
  }

  // ── API key list dialog (FileProcessingApiKeyList) ─────────────────────────────
  get apiKeyDialog(): Locator {
    return this.page.locator('[data-slot="dialog-content"]')
  }

  get apiKeyEmpty(): Locator {
    return this.page.getByText(t('error.no_api_key'))
  }

  get apiKeyAddButton(): Locator {
    return this.page.getByRole('button', { name: t('common.add'), exact: true })
  }

  /** New-key input inside an editing row (type=password). */
  get apiKeyNewInput(): Locator {
    return this.page.getByPlaceholder(t('settings.provider.api.key.new_key.placeholder'))
  }

  get apiKeySaveButton(): Locator {
    return this.page.locator(`[aria-label="${t('common.save')}"]`)
  }

  get apiKeyRows(): Locator {
    return this.page.locator('[data-testid="fp-apikey-row"]')
  }

  /** Per-row delete (Minus) button. */
  get apiKeyRowDelete(): Locator {
    return this.page.locator(`[data-testid="fp-apikey-row"] [aria-label="${t('common.delete')}"]`)
  }

  /** window.modal.confirm "确认" button (delete confirmation). */
  get confirmButton(): Locator {
    return this.page.getByRole('button', { name: t('common.confirm'), exact: true })
  }
}
