import type { Locator, Page } from '@playwright/test'

import { t } from '../utils/i18n'
import { BasePage } from './base.page'

export type CompressionMethod = 'none' | 'cutoff'

/**
 * Page Object for Settings → 网络搜索 (web search).
 *
 * Selector policy: data-testid (ws-default-badge[data-provider-id]) and stable ids
 * (#web-search-*, #websearch-basic-auth-*) first, then role + accessible name / aria-label via
 * `t()`. Provider rows are `[data-slot="menu-item"]` filtered by the provider display name.
 */
export class WebSearchSettingsPage extends BasePage {
  /** Open Settings (tab router) then the 网络搜索 sub-page. */
  async goto(): Promise<void> {
    await this.page.locator('[aria-label="设置"]').first().click()
    await this.page
      .locator('[data-slot="menu-item"]')
      .filter({ hasText: t('settings.tool.websearch.title') })
      .first()
      .click()
  }

  providerMenuItem(name: string): Locator {
    return this.page.locator('[data-slot="menu-item"]').filter({ hasText: name })
  }

  defaultBadge(providerId: string): Locator {
    return this.page.locator(`[data-testid="ws-default-badge"][data-provider-id="${providerId}"]`)
  }

  // ── compression ──────────────────────────────────────────────────────────────
  async selectCompression(method: CompressionMethod): Promise<void> {
    await this.page.locator('#web-search-compression-method').click()
    await this.page
      .getByRole('option', { name: t(`settings.tool.websearch.compression.method.${method}`), exact: true })
      .click()
  }

  get cutoffLimitInput(): Locator {
    return this.page.getByPlaceholder(t('settings.tool.websearch.compression.cutoff.limit.placeholder'))
  }

  // ── max results ──────────────────────────────────────────────────────────────
  get maxResultInput(): Locator {
    return this.page.locator(`[aria-label="${t('settings.tool.websearch.search_max_result.label')}"]`)
  }

  get resetButton(): Locator {
    return this.page.locator(`[aria-label="${t('common.reset')}"]`)
  }

  /** The >20-results InfoTooltip icon (literal aria-label "Information"). */
  get infoIcon(): Locator {
    return this.page.locator('[aria-label="Information"]')
  }

  // ── default keywords provider ────────────────────────────────────────────────
  /** Select a keywords-search default provider by its display name (e.g. Tavily / ExaMCP). */
  async selectKeywordsProvider(displayName: string): Promise<void> {
    await this.page.locator('#web-search-default-keywords-provider').click()
    await this.page.getByRole('option', { name: displayName, exact: true }).click()
  }

  // ── provider sub-panel ───────────────────────────────────────────────────────
  get setAsDefaultButton(): Locator {
    return this.page.getByRole('button', { name: t('settings.tool.websearch.set_as_default'), exact: true })
  }

  get isDefaultButton(): Locator {
    return this.page.getByRole('button', { name: t('settings.tool.websearch.is_default'), exact: true })
  }

  // ── API key management dialog ────────────────────────────────────────────────
  get apiKeyManageButton(): Locator {
    return this.page.locator(`[aria-label="${t('settings.provider.api.key.list.open')}"]`)
  }

  get apiKeyInput(): Locator {
    return this.page.getByPlaceholder(t('settings.provider.api.key.new_key.placeholder'))
  }

  // ── searxng basic auth ───────────────────────────────────────────────────────
  get basicAuthUsername(): Locator {
    return this.page.locator('#websearch-basic-auth-username')
  }

  get basicAuthPassword(): Locator {
    return this.page.locator('#websearch-basic-auth-password')
  }

  // ── blacklist ────────────────────────────────────────────────────────────────
  get blacklistInput(): Locator {
    // The placeholder is a multiline example; match its first line as a substring.
    return this.page.getByPlaceholder(t('settings.tool.websearch.blacklist_tooltip').split('\n')[0])
  }
}
