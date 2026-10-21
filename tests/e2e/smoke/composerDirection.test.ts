import { uiSelector } from '../../../src/renderer/utils/uiContract'
import { expect, test } from './fixtures/electron.fixture'

test('composer follows the first strong character when switching prompt languages', async ({
  mainWindow
}, testInfo) => {
  const input = mainWindow
    .locator(uiSelector({ parts: ['composer-input'] }))
    .filter({ visible: true })
    .first()
  const languageSelect = mainWindow.locator('[data-onboarding-language-select]')
  await expect(input.or(languageSelect).first()).toBeVisible()
  if (await languageSelect.isVisible()) {
    await languageSelect.getByRole('combobox').click()
    await mainWindow.getByRole('option', { name: 'English', exact: false }).click()
    await mainWindow.getByRole('button', { name: 'Set up later', exact: true }).click()
  }

  await input.click()
  const editor = input.locator('[contenteditable]')
  await expect(editor).toBeVisible()

  for (const [text, direction] of [
    ['שלום עולם', 'rtl'],
    ['Hello world', 'ltr'],
    ['123 مرحبا بالعالم', 'rtl'],
    ['שלום hello', 'rtl'],
    ['Hello שלום', 'ltr'],
    ['  (123) שלום', 'rtl']
  ]) {
    await editor.fill('')
    await editor.fill(text)
    await expect(editor).toHaveText(text)
    await expect(editor).toHaveCSS('direction', direction)
    await expect(editor).toHaveCSS('text-align', 'start')
    if (text === 'שלום עולם' || text === 'Hello world') {
      await mainWindow.screenshot({ path: testInfo.outputPath(`${direction}-prompt.png`) })
    }
  }
  await editor.fill('')
  await expect(editor).toHaveCSS('direction', 'ltr')
})
