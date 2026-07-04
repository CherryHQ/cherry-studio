import type { Locator, Page } from '@playwright/test'

import { t } from '../utils/i18n'
import { BasePage } from './base.page'

export type DataSourceType = 'file' | 'url' | 'note'
export type SearchMode = 'vector' | 'hybrid' | 'bm25'

/**
 * Page Object for the Knowledge section.
 *
 * Selector policy: data-testid first (kb-base-row / kb-item-row / sidebar-nav-knowledge /
 * kb-base-status / kb-chunk-*), then role + accessible name, then stable ids the app exposes
 * for KB form fields (#knowledge-create-name, #kb-rag-*). All user-visible strings come from
 * `t()` (zh-CN locale) so the POM tracks i18n changes; the golden profile is zh-CN.
 */
export class KnowledgePage extends BasePage {
  readonly baseRows: Locator
  readonly itemRows: Locator
  readonly dialog: Locator
  readonly dialogSubmit: Locator

  constructor(page: Page) {
    super(page)
    this.baseRows = page.locator('[data-testid="kb-base-row"]')
    this.itemRows = page.locator('[data-testid="kb-item-row"]')
    this.dialog = page.getByRole('dialog')
    this.dialogSubmit = page.locator('[role="dialog"] button[type="submit"]')
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  async goto(): Promise<void> {
    await this.page.locator('[data-testid="sidebar-nav-knowledge"]').click()
  }

  /** Open the Knowledge section and select a base by its display name. */
  async openBase(name: string): Promise<void> {
    await this.goto()
    await this.baseRow(name).first().click()
  }

  baseRow(name: string): Locator {
    return this.baseRows.filter({ hasText: name })
  }

  // ── Navigator header (aside) ─────────────────────────────────────────────────
  /** The "+" button in the navigator header (opens a menu: new base / new group). */
  get navigatorAdd(): Locator {
    return this.page.locator('aside').getByRole('button', { name: t('common.add'), exact: true })
  }

  async openCreateBaseDialog(): Promise<void> {
    await this.navigatorAdd.click()
    await this.page.getByRole('menuitem', { name: t('knowledge.add.title'), exact: true }).click()
  }

  async openCreateGroupDialog(): Promise<void> {
    await this.navigatorAdd.click()
    await this.page.getByRole('menuitem', { name: t('knowledge.groups.add'), exact: true }).click()
  }

  // ── Create / entity dialogs ──────────────────────────────────────────────────
  get createNameInput(): Locator {
    return this.page.locator('#knowledge-create-name')
  }

  /** Group/base rename + create-group dialogs share this field. */
  get entityNameInput(): Locator {
    return this.page.locator('#knowledge-entity-name')
  }

  // ── Data sources (detail pane) ───────────────────────────────────────────────
  get addSourceButton(): Locator {
    return this.page.getByRole('button', { name: t('knowledge.data_source.toolbar.add') })
  }

  /** Open the add-source dialog for a given source type via the toolbar menu. */
  async openAddSource(type: DataSourceType): Promise<void> {
    await this.addSourceButton.first().click()
    await this.page
      .getByRole('menuitem', { name: t(`knowledge.data_source.add_dialog.sources.${type}`), exact: true })
      .click()
  }

  /** The "添加" confirm button INSIDE the add-source dialog (not the toolbar "添加数据源"). */
  get dialogAddButton(): Locator {
    return this.dialog.getByRole('button', { name: t('common.add'), exact: true })
  }

  /**
   * Add a file data source. The caller MUST stub the native picker first (see `picker.stub()`):
   * the OS dialog opens on menu click and the add-source dialog auto-submits the picked files.
   */
  async addFileSource(): Promise<void> {
    await this.openAddSource('file')
  }

  itemRow(name: string): Locator {
    return this.itemRows.filter({ hasText: name })
  }

  itemRowByStatus(status: string): Locator {
    return this.page.locator(`[data-testid="kb-item-row"][data-status="${status}"]`)
  }

  get baseStatus(): Locator {
    return this.page.locator('[data-testid="kb-base-status"]')
  }

  detailTitle(name: string): Locator {
    return this.page.locator('h1').filter({ hasText: name })
  }

  // ── Model picker (create dialog / RAG config) ────────────────────────────────
  /**
   * Pick a model: click the field trigger (by its aria-label) then the model item by id.
   * Model items are keyed `model-selector-item-<providerId::modelId>`.
   */
  async pickModel(triggerLabelKey: string, modelId: string): Promise<void> {
    await this.page
      .locator(`[aria-label="${t(triggerLabelKey)}"]`)
      .first()
      .click()
    await this.page.locator(`[data-testid="model-selector-item-${modelId}"]`).click()
  }

  // ── RAG config panel ─────────────────────────────────────────────────────────
  async openRagConfig(): Promise<void> {
    await this.page.getByRole('button', { name: t('knowledge.tabs.rag_config') }).click()
  }

  get ragChunkSize(): Locator {
    return this.page.locator('#kb-rag-chunk-size')
  }

  get ragChunkOverlap(): Locator {
    return this.page.locator('#kb-rag-chunk-overlap')
  }

  get ragSaveButton(): Locator {
    return this.dialog.getByRole('button', { name: t('knowledge.rag.save_action'), exact: true })
  }

  /** Slider by its aria-label i18n key (document_count / threshold / hybrid_alpha). */
  ragSlider(labelKey: string): Locator {
    return this.page.locator(`[data-slot="slider"][aria-label="${t(labelKey)}"]`)
  }

  async selectSearchMode(mode: SearchMode): Promise<void> {
    await this.page.locator('#kb-rag-search-mode').click()
    await this.page.getByRole('option', { name: t(`knowledge.rag.search_mode.${mode}`), exact: true }).click()
  }

  // ── Recall test panel ────────────────────────────────────────────────────────
  async openRecallTest(): Promise<void> {
    await this.page.getByRole('button', { name: t('knowledge.tabs.recall_test') }).click()
  }

  get recallInput(): Locator {
    return this.page.getByPlaceholder(t('knowledge.recall.placeholder'))
  }

  get recallSubmit(): Locator {
    return this.page.getByRole('button', { name: t('knowledge.recall.submit'), exact: true })
  }

  get recallHistory(): Locator {
    return this.page.locator('[data-recall-history]')
  }

  recallHistoryItem(text: string): Locator {
    return this.recallHistory.locator('[class*="group/hist"]').filter({ hasText: text })
  }

  /** Toggle button that re-opens the history panel (aria-label = history title). */
  get recallHistoryToggle(): Locator {
    return this.page.locator(`[aria-label="${t('knowledge.recall.history_title')}"]`)
  }

  // ── Navigator: base-row context menu, groups, search ─────────────────────────
  /** Open a base row's context menu. */
  async openBaseRowMenu(name: string): Promise<void> {
    const row = this.baseRow(name)
    await row.click({ button: 'right' })
  }

  group(name: string): Locator {
    return this.page.locator('[class*="group/grp"]').filter({ hasText: name })
  }

  async expandGroup(name: string): Promise<void> {
    await this.group(name).locator('button[data-slot="accordion-trigger"]').first().click()
  }

  get searchInput(): Locator {
    return this.page.getByPlaceholder(t('knowledge.search'))
  }

  get clearSearch(): Locator {
    return this.page.locator(`[aria-label="${t('common.clear')}"]`)
  }
}
