import { test } from './fixtures/electron.fixture'
import { verifyComposerOrder } from './utils/composerOrderScenario'

test('preserves interleaved Composer content through send and reload', async ({
  electronApp,
  mainWindow
}, testInfo) => {
  test.setTimeout(180_000)
  const original = await electronApp.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
  try {
    await verifyComposerOrder(
      mainWindow,
      async (filePath) => {
        await electronApp.evaluate(({ dialog }, selected) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
        }, filePath)
      },
      testInfo.outputPath('composer-order')
    )
  } finally {
    await electronApp.evaluate(({ dialog }, saved) => {
      dialog.showOpenDialog = saved
    }, original)
    await original.dispose()
  }
})
