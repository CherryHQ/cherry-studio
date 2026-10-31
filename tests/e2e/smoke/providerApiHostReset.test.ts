import { rm } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
      timeout: 60000
    })
    try {
      await electronApp.context().tracing.start({ screenshots: true, snapshots: true })
      await use(electronApp)
    } finally {
      try {
        const path = testInfo.outputPath('provider-api-host-reset-trace.zip')
        await electronApp.context().tracing.stop({ path })
        await testInfo.attach('provider-api-host-reset-trace', { path, contentType: 'application/zip' })
      } finally {
        try {
          await electronApp.close()
        } finally {
          await rm(profile, { recursive: true, force: true })
        }
      }
    }
  }
})

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

test('confirms provider API host reset and keeps edits on cancel', async ({ mainWindow }, testInfo) => {
  await mainWindow.evaluate(async (policyVersion) => {
    await window.api.preference.set('app.privacy.policy_version', policyVersion)
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.language', 'en-US')
  }, LATEST_PRIVACY_POLICY_VERSION)
  await mainWindow.reload()
  await expect(mainWindow.locator('[data-ui~="app.shell"]').first(), 'Setup: app shell must load').toBeVisible({
    timeout: 60000
  })
  await expect(
    mainWindow.getByRole('dialog', { name: en['privacy_policy_update.title'], exact: true }),
    'Setup: the current privacy policy gate must not block provider settings'
  ).toHaveCount(0)

  const sidebar = mainWindow.locator('[data-ui~="app.sidebar"]').filter({ visible: true })
  await sidebar.getByRole('button', { name: en['settings.title'], exact: true }).click()
  const settings = mainWindow.locator('[data-ui~="settings.view"]').filter({ visible: true })
  await expect(settings, 'Setup: Settings must open in exactly one visible view').toHaveCount(1)
  const navigation = settings.locator('[data-ui~="settings.navigation"]')
  const detail = settings.getByTestId('provider-detail-shell')

  const openDeepseek = async () => {
    await navigation.getByRole('button', { name: en['settings.provider.title'], exact: true }).click()
    const search = settings.getByPlaceholder(en['settings.provider.search'], { exact: true })
    await expect(search, 'Setup: the provider list must load before selecting deepseek').toBeVisible()
    const row = settings.getByTestId('provider-list-item-deepseek')
    if (!(await row.isVisible())) {
      await search.fill('')
      if (!(await row.isVisible())) {
        await settings.getByRole('button', { name: en['settings.provider.filter.label'], exact: true }).click()
        await mainWindow.getByRole('button', { name: en['settings.provider.filter.all'], exact: true }).click()
      }
    }
    await expect(row, 'Setup: provider id "deepseek" is missing or hidden after clearing filters').toBeVisible()
    await row.click()
    const field = detail.locator('#setting-provider-api-host')
    const controls = {
      input: field.getByRole('textbox', { name: en['settings.provider.api_host'], exact: true }),
      reset: field.getByRole('button', { name: en['settings.provider.api.url.reset'], exact: true })
    }
    await expect(controls.input, 'Setup: provider deepseek must expose its primary API Host input').toBeVisible()
    return controls
  }

  const reopenDeepseek = async () => {
    await navigation.getByRole('button', { name: en['settings.appearance.title'], exact: true }).click()
    await expect(detail, 'Persistence check must leave the provider detail before reopening it').toHaveCount(0)
    return openDeepseek()
  }

  let { input, reset } = await openDeepseek()
  const defaultHost = await input.inputValue()
  expect(defaultHost.trim(), 'Setup: provider deepseek must have a non-empty registry default API host').not.toBe('')
  const customHost = 'https://undo-22892.example/v1'
  expect(customHost, 'Setup: the custom host must differ from the default to exercise reset').not.toBe(defaultHost)
  await input.fill(customHost)
  await input.press('Tab')
  ;({ input, reset } = await reopenDeepseek())
  await expect(input, 'Issue #22892: the custom host must be saved before exercising reset').toHaveValue(customHost)
  await expect(reset, 'Issue #22892: a saved custom host must offer Reset').toBeVisible()

  const dialog = mainWindow.getByRole('dialog', { name: en['common.reset'], exact: true })
  const cancel = dialog.getByRole('button', { name: en['common.cancel'], exact: true })
  const confirm = dialog.getByRole('button', { name: en['common.reset'], exact: true })
  const content = dialog.getByText(en['settings.provider.api.url.reset_confirm'], { exact: true })
  await reset.click()
  await expect(dialog, 'Issue #22892: Reset must ask for approval before replacing a saved custom host').toBeVisible()
  await expect(content, 'Issue #22892: confirmation must explain that reset replaces the custom URL').toBeVisible()
  await expect(cancel, 'Issue #22892: confirmation must offer a way to keep the custom host').toBeVisible()
  await expect(confirm, 'Issue #22892: confirmation must label the destructive action as Reset').toBeVisible()
  const dialogLabels = {
    title: await dialog.getByRole('heading', { name: en['common.reset'], exact: true }).innerText(),
    content: await content.innerText(),
    cancel: await cancel.innerText(),
    reset: await confirm.innerText()
  }
  const backgroundInput = detail
    .locator('#setting-provider-api-host')
    .getByRole('textbox', { name: en['settings.provider.api_host'], exact: true, includeHidden: true })
  await expect(backgroundInput, 'Issue #22892: opening confirmation must preserve custom host').toHaveValue(customHost)
  const valueBehindDialog = await backgroundInput.inputValue()
  await attachScreenshot(mainWindow, testInfo, '22892-confirm-before-reset')

  await cancel.click()
  await expect(dialog, 'Issue #22892: Cancel must dismiss confirmation without resetting').toBeHidden()
  await expect(input, 'Issue #22892: Cancel must preserve the saved custom host').toHaveValue(customHost)
  const valueAfterCancel = await input.inputValue()
  await expect(reset, 'Issue #22892: Cancel must leave the custom host resettable').toBeVisible()
  await attachScreenshot(mainWindow, testInfo, '22892-cancel-keeps-custom-host')

  await reset.click()
  await expect(dialog, 'Issue #22892: Reset must still require confirmation after cancellation').toBeVisible()
  await confirm.click()
  await expect(dialog, 'Issue #22892: a successful confirmed reset must close the dialog').toBeHidden()
  await expect(input, 'Issue #22892: confirmation must restore the captured registry default').toHaveValue(defaultHost)
  const valueAfterConfirm = await input.inputValue()
  await expect(reset, 'Issue #22892: the default host must no longer offer Reset').toHaveCount(0)
  await attachScreenshot(mainWindow, testInfo, '22892-confirmed-default')

  ;({ input, reset } = await reopenDeepseek())
  await expect(input, 'Issue #22892: the confirmed default must persist after reopening').toHaveValue(defaultHost)
  await expect(reset, 'Issue #22892: a persisted default must remain non-resettable').toHaveCount(0)
  const defaultAfterReopen = await input.inputValue()
  const secondCustomHost = 'https://edit-after-reset-22892.example/v1'
  expect(secondCustomHost, 'Setup: the second edit must differ from the default').not.toBe(defaultHost)
  await input.fill(secondCustomHost)
  await input.press('Tab')
  await expect(input, 'Issue #22892: ordinary editing must still work after reset').toHaveValue(secondCustomHost)
  await expect(reset, 'Issue #22892: an ordinary edit after reset must offer Reset again').toBeVisible()

  await testInfo.attach('22892-provider-api-host-reset-evidence.json', {
    body: JSON.stringify(
      {
        providerId: 'deepseek',
        defaultHost,
        customHost,
        valueBehindDialog,
        valueAfterCancel,
        valueAfterConfirm,
        defaultAfterReopen,
        secondCustomHost,
        valueAfterSecondEdit: await input.inputValue(),
        dialogLabels
      },
      null,
      2
    ),
    contentType: 'application/json'
  })
})
