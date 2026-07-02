import type { Locator, Page } from '@playwright/test'

import { t } from '../utils/i18n'
import { BasePage } from './base.page'

/**
 * Page Object for the chat composer (assistants page) — the bits needed for the web search
 * enable/disable toggle. The "+" tool menu carries the web search menuitem; once enabled it
 * renders as a `data-active` button in the composer's active-tool controls.
 */
export class ChatComposerPage extends BasePage {
  async gotoAssistants(): Promise<void> {
    await this.page.locator('[data-testid="sidebar-nav-assistants"]').click()
  }

  /** The composer "+" tool menu trigger (aria-label = 添加). */
  get toolMenuButton(): Locator {
    return this.page.locator(`[aria-label="${t('common.add')}"]`)
  }

  /** Web search item inside the "+" tool menu. */
  get webSearchMenuItem(): Locator {
    return this.page.getByRole('menuitem', { name: t('chat.input.web_search.label') })
  }

  /** Web search control once enabled (active-tool controls, carries data-active). */
  get webSearchActiveControl(): Locator {
    return this.page.locator(`[aria-label="${t('chat.input.web_search.label')}"][data-active]`)
  }
}
