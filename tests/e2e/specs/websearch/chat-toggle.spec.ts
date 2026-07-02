import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatComposerPage } from '../../pages/chat-composer.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-m5): chat composer web search enable/disable toggle. The golden's active model
 * supports web search, so the "+" menu item is enabled; enabling renders a data-active control,
 * clicking which toggles it back off (net-zero). Assumes golden starts with web search OFF.
 */
test.describe('WebSearch · chat toggle', () => {
  test('enables then disables web search from the composer', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatComposerPage(mainWindow)
    await chat.gotoAssistants()

    // initial OFF: no active web search control
    await expect(chat.webSearchActiveControl).toBeHidden()

    // open "+" menu → web search item enabled (model supports it)
    await chat.toolMenuButton.click()
    await expect(chat.webSearchMenuItem).toBeEnabled()

    // enable → control appears in active-tool controls
    await chat.webSearchMenuItem.click()
    await expect(chat.webSearchActiveControl).toBeVisible()

    // disable → back to OFF (net-zero)
    await chat.webSearchActiveControl.click()
    await expect(chat.webSearchActiveControl).toBeHidden()
  })
})
