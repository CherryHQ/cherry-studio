import { expect, test } from './fixtures/electron.fixture'

test('manually added StepFun preview exposes low, medium and high reasoning effort', async ({
  mainWindow
}, testInfo) => {
  const composer = mainWindow.locator('[data-ui~="chat.composer"]').filter({ visible: true }).first()
  const language = mainWindow.getByRole('combobox')
  await expect(composer.or(language).first()).toBeVisible()
  if (await language.isVisible()) {
    await language.click()
    await mainWindow.getByRole('option', { name: 'English', exact: false }).click()
    await mainWindow.getByRole('button', { name: 'Set up later', exact: true }).click()
  }

  await mainWindow.getByRole('button', { name: 'Settings', exact: true }).first().click()
  await mainWindow
    .locator('[data-ui~="settings.navigation"]')
    .getByRole('button', { name: 'Model Provider', exact: true })
    .click()
  await mainWindow.getByTestId('provider-list-item-stepfun').click()
  const enabled = mainWindow.getByTestId('provider-detail-shell').getByRole('switch').last()
  if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click()
  await expect(enabled).toBeChecked()
  await mainWindow.getByRole('button', { name: 'Add model manually', exact: true }).click()
  const dialog = mainWindow.getByTestId('provider-settings-model-add-dialog')
  await dialog.getByRole('textbox', { name: 'Model ID', exact: true }).fill('step-5-preview')
  await dialog.getByRole('button', { name: 'More Settings', exact: true }).click()
  const reasoning = dialog
    .locator('[data-ui~="settings.model-classification-controls"]')
    .getByRole('button', { name: 'Reasoning', exact: true })
  await reasoning.click()
  await expect(reasoning).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'Add Model', exact: true }).click()
  await expect(dialog).toBeHidden()

  await mainWindow.getByRole('button', { name: 'Back', exact: true }).first().click()
  await mainWindow.getByRole('button', { name: 'Chat', exact: true }).first().click()
  await expect(composer).toBeVisible()
  await mainWindow.getByRole('button', { name: 'Selected models', exact: true }).click()
  const selector = mainWindow.getByTestId('model-selector-content').filter({ visible: true })
  await selector.getByTestId('model-selector-search').fill('step-5-preview')
  await selector.getByTestId('model-selector-item-stepfun::step-5-preview').click()
  await expect(selector).toBeHidden()
  await composer.getByRole('button', { name: 'Response settings', exact: true }).click()

  const slider = mainWindow.getByRole('slider', { name: 'Effort', exact: true })
  const label = mainWindow.locator('[data-ui~="ui.model-speed-control.model-speed-effort-label"]')
  await expect(slider).toBeVisible()
  await expect(slider).toHaveAttribute('aria-valuemin', '0')
  await expect(slider).toHaveAttribute('aria-valuemax', '2')
  await slider.focus()
  await slider.press('End')
  await expect(label).toHaveText('High')
  await slider.press('ArrowLeft')
  await expect(label).toHaveText('Medium')
  await slider.press('ArrowLeft')
  await expect(label).toHaveText('Low')

  const screenshotPath = testInfo.outputPath('stepfun-custom-model-effort.png')
  await mainWindow.screenshot({ path: screenshotPath })
  await testInfo.attach('StepFun custom model effort', { path: screenshotPath, contentType: 'image/png' })
})
