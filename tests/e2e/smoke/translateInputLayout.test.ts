import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('translation input keeps idle dictation and copy beside the first text line', async ({ mainWindow }) => {
  const preferences = await mainWindow.evaluate(async () => {
    const previous = {
      'app.language': await window.api.preference.get('app.language'),
      'app.onboarding.provider_setup.status': await window.api.preference.get('app.onboarding.provider_setup.status')
    }
    await window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.onboarding.provider_setup.status': 'skipped'
    })
    return previous
  })
  const originalViewport = mainWindow.viewportSize()

  try {
    await mainWindow.reload()
    await mainWindow.getByLabel('Translation', { exact: true }).click()
    const pane = uiLocator(mainWindow, 'translate.input')
    const input = pane.getByRole('textbox')
    const dictation = pane.getByRole('button', { name: 'Dictate locally', exact: true })
    const copy = pane.getByRole('button', { name: 'Copy', exact: true })

    for (const width of [800, 1280]) {
      await mainWindow.setViewportSize({ width, height: 700 })
      for (const text of [
        '',
        'Long translation input should wrap without covering the dictation or copy controls. '.repeat(30)
      ]) {
        await test.step(`${width}px: ${text ? 'wrapped text' : 'empty input'}`, async () => {
          await input.fill(text)
          await expect(dictation).toBeInViewport()
          await expect(copy).toBeInViewport()
          await expect
            .poll(async () => {
              const [field, microphone, clipboard] = await Promise.all([
                input.evaluate((element) => {
                  const bounds = element.getBoundingClientRect()
                  const style = getComputedStyle(element)
                  const firstLineTop = bounds.top + parseFloat(style.paddingTop)
                  return {
                    firstLineTop,
                    firstLineBottom: firstLineTop + parseFloat(style.lineHeight),
                    textRight: bounds.right - parseFloat(style.paddingRight)
                  }
                }),
                dictation.boundingBox(),
                copy.boundingBox()
              ])
              if (!microphone || !clipboard) return false

              // Both controls must share the first text line without covering its writable area.
              return (
                [microphone, clipboard].every(
                  (button) => field.firstLineTop < button.y + button.height && field.firstLineBottom > button.y
                ) &&
                field.textRight <= microphone.x &&
                microphone.x + microphone.width <= clipboard.x
              )
            }, 'Idle controls must share the first line and leave room for text')
            .toBe(true)
        })
      }
    }
    await input.fill('')
  } finally {
    if (originalViewport) await mainWindow.setViewportSize(originalViewport)
    await mainWindow.evaluate((previous) => window.api.preference.setMultiple(previous), preferences)
  }
})
