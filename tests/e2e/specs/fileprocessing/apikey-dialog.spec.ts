import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { FileProcessingPage } from '../../pages/file-processing.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (fp-m2, light-medium.md §2 FP-M2): API key list dialog real CRUD enabled by #16494 (the
 * list now reflects add/delete immediately, no close→reopen). Isolation: use `mistral` (no golden
 * key → starts empty) so golden's configured keys are never touched. Net-zero: add → row count 1,
 * delete → back to the empty state. Password masked → assert row count / empty state, never plaintext.
 */
test.describe('File processing · api key dialog CRUD', () => {
  test('adds a key (row +1) then deletes it (back to empty)', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const fp = new FileProcessingPage(mainWindow)
    await fp.goto()

    // open the api-key dialog for mistral (empty golden list)
    await fp.selectProcessor('document_to_markdown', 'mistral')
    await fp.apiKeyListOpen.click()
    // dialog title now carries a processor prefix ('Mistral API 密钥管理') → assert the dialog is
    // mounted (radix mounts [data-slot=dialog-content] only when open) instead of exact i18n text.
    await expect(fp.apiKeyDialog).toBeVisible()
    await expect(fp.apiKeyEmpty).toBeVisible()

    // add + save a fake key → list reflects +1 (saved row), edit input gone
    await fp.apiKeyAddButton.click()
    await fp.apiKeyNewInput.fill('e2e-fake-key-001')
    await fp.apiKeySaveButton.click()
    await expect(fp.apiKeyRows).toHaveCount(1)
    await expect(fp.apiKeyNewInput).toBeHidden()

    // delete the key (confirm modal) → back to empty (net-zero)
    await fp.apiKeyRowDelete.click()
    await fp.confirmButton.click()
    await expect(fp.apiKeyEmpty).toBeVisible()
  })
})
