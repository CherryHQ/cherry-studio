import type { TiptapEditorHTMLElement } from '@tiptap/core'

import { uiSelector } from '../../../src/renderer/utils/uiContract'
import { expect, test } from '../fixtures/electron.fixture'

test('composer keeps focus and protects the draft across a read-only interval', async ({ mainWindow }) => {
  const input = mainWindow
    .locator(uiSelector({ parts: ['composer-input'] }))
    .filter({ visible: true })
    .first()
  const skipSetup = mainWindow.getByRole('button', { name: /^(稍后设置|Set up later)$/ })
  await expect(input.or(skipSetup).first()).toBeVisible()
  if (await skipSetup.isVisible()) await skipSetup.click()
  await input.click()
  const editor = input.locator('[contenteditable]')
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await expect(editor).toHaveText('')
  await editor.fill('Focus regression draft')
  await expect(editor).toBeFocused()

  // Exercise the real editor's send-time editability transition without a model request.
  const setEditable = (editable: boolean) =>
    editor.evaluate((element, value) => {
      const instance = (element as TiptapEditorHTMLElement).editor
      if (!instance) throw new Error('Composer editor is not mounted')
      instance.setEditable(value, false)
    }, editable)

  try {
    await setEditable(false)
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(editor).toBeFocused()
    await mainWindow.keyboard.type('must not be inserted')
    await mainWindow.keyboard.press('Backspace')
    await expect(editor).toHaveText('Focus regression draft')

    await setEditable(true)
    await expect(editor).toBeFocused()
    await mainWindow.keyboard.type('!')
    await expect(editor).toHaveText('Focus regression draft!')

    await setEditable(false)
    await mainWindow.keyboard.press('Tab')
    await expect(editor).not.toBeFocused()
    const nextFocus = await mainWindow.evaluateHandle(() => document.activeElement)
    await setEditable(true)
    expect(await mainWindow.evaluate((element) => document.activeElement === element, nextFocus)).toBe(true)
    await nextFocus.dispose()
  } finally {
    await setEditable(true)
    await editor.fill('')
  }
})
