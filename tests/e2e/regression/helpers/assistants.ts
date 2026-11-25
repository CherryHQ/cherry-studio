import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

import type { RegressionApp } from '../RegressionApp'
import { ensureCustomChatProvider, selectVisibleModel } from './models'
import { selectSidebarApp } from './navigation'
import { closeSettings } from './settings'

export function customAssistantName(app: RegressionApp): string {
  return app.resourceName('Cherry Regression Assistant 31415')
}

/**
 * Create the regression assistant through the manual wizard.
 *
 * The catalog create dialog opens on a quick-entry view (avatar, name, purpose, model) whose footer
 * offers "Manual create" / "Auto create"; the stepped wizard this suite drives lives behind
 * "Manual create". Both views share one form, so entry values carry over into step 1.
 */
export async function ensureCustomAssistant(app: RegressionApp, page: Page): Promise<void> {
  const name = customAssistantName(app)
  const providerId = await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  await selectSidebarApp(page, 'Chat')
  const chatView = page.locator('[data-ui~="chat.view"]:visible').first()
  const assistant = chatView.getByText(name, { exact: true }).first()

  if (!(await assistant.isVisible().catch(() => false))) {
    await chatView.getByRole('button', { name: 'Add Assistant', exact: true }).click({ noWaitAfter: true })
    await page.getByRole('option', { name: 'New Assistant', exact: true }).click()

    // One dialog element whose content swaps between the entry view and the steps view, so hold
    // the locator by role, not by view-specific text.
    const dialog = page.getByRole('dialog').last()
    await expect(dialog).toBeVisible()

    // Entry view. Older builds open straight on step 1 with the same field, so accept both
    // placeholders and treat the purpose box as optional.
    await dialog.getByPlaceholder(/^(Name your assistant|Enter a name)$/).fill(name)
    const purpose = dialog.getByPlaceholder(/^What should it help you with\?/)
    if (await purpose.isVisible().catch(() => false)) {
      await purpose.fill('Cherry Regression Test Assistant')
    }

    const manual = dialog.getByRole('button', { name: 'Manual create', exact: true })
    if (await manual.isVisible().catch(() => false)) {
      await manual.click()
      await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeVisible()
    }

    // Step 1: avatar is cosmetic, so a missing emoji entry must not fail the fixture.
    const avatar = dialog.locator('[aria-label="Choose avatar"]')
    if (await avatar.isVisible().catch(() => false)) {
      await avatar.click()
      const emoji = page.locator('button[aria-label="star-struck"]').first()
      if (await emoji.isVisible().catch(() => false)) await emoji.click()
      else await page.keyboard.press('Escape')
    }
    await dialog.locator('[aria-label="Model"]').click()
    await selectVisibleModel(page, app.config.customProvider.chatModel, providerId)
    await dialog.getByRole('button', { name: 'Next', exact: true }).click()

    // Step 2: system prompt.
    await dialog
      .locator('.cm-content[contenteditable="true"]')
      .fill('You must always include the exact phrase ASSISTANT_PROMPT_PASS in every response.')
    await dialog.getByRole('button', { name: 'Next', exact: true }).click()
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  } else {
    await assistant.click({ noWaitAfter: true })
  }

  await expect(assistant).toBeVisible()
}
