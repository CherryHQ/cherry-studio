import en from '../../../src/renderer/i18n/locales/en-us.json'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test } from './fixtures/electron.fixture'
import { openSettings } from './utils/navigation'

test('allows choosing optional report attachments without submitting', async ({ mainWindow: page }, testInfo) => {
  await page.evaluate(async (policyVersion) => {
    await window.api.preference.set('app.privacy.policy_version', policyVersion)
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.language', 'en-US')
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await expect(page.locator('[data-ui~="app.content"]').first()).toBeVisible({ timeout: 60000 })

  await openSettings(page)
  const settings = page.locator('[data-ui~="settings.view"]').filter({ visible: true })
  await settings
    .locator('[data-ui~="settings.navigation"]')
    .getByRole('button', { name: en['settings.about.label'], exact: true })
    .click()
  await settings
    .locator('[data-ui~="settings.content"]')
    .getByRole('button', { name: en['settings.about.feedback.button'], exact: true })
    .click()

  const chooser = page.getByRole('dialog', { name: en['settings.about.feedback.dialog.title'], exact: true })
  await chooser.getByRole('button', { name: en['settings.about.feedback.diagnostics.title'] }).click()

  const report = page.getByRole('dialog', { name: en['settings.doctor.panels.report'], exact: true })
  await expect(report).toBeVisible()
  await expect(
    report.getByText(en['settings.about.diagnostics.report.attachments_description'], { exact: true })
  ).toBeVisible()

  const system = report.getByRole('switch', { name: en['settings.about.diagnostics.sources.system.title'] })
  await expect(system).toBeVisible()
  await expect(system).toBeChecked()
  await expect(system).toBeDisabled()
  await expect(
    report.getByText(en['settings.about.diagnostics.report.system_always_included'], { exact: true })
  ).toBeVisible()

  const optionalSources = [
    en['settings.about.diagnostics.sources.logs.title'],
    en['settings.about.diagnostics.sources.traces.title'],
    en['settings.about.diagnostics.sources.chat_records.title']
  ]
  for (const name of optionalSources) {
    const source = report.getByRole('switch', { name, exact: true })
    await expect(source).toBeVisible()
    await expect(source).toBeChecked()
    await expect(source).toBeEnabled()
  }
  const acknowledgement = report.getByRole('checkbox', {
    name: en['settings.about.diagnostics.report.acknowledgement'],
    exact: true
  })
  await expect(acknowledgement).toBeVisible()
  await expect(acknowledgement).toBeChecked()
  await expect(report.getByText(en['settings.about.diagnostics.range_title'], { exact: true })).toHaveCount(0)
  await expect(report.getByRole('radiogroup')).toHaveCount(0)
  await expect(report.getByRole('radio')).toHaveCount(0)

  const chatRecords = report.getByRole('switch', {
    name: en['settings.about.diagnostics.sources.chat_records.title'],
    exact: true
  })
  await chatRecords.scrollIntoViewIfNeeded()
  await expect(chatRecords).toBeInViewport({ ratio: 1 })
  for (const name of optionalSources) {
    await expect(report.getByRole('switch', { name, exact: true })).toBeInViewport({ ratio: 1 })
    await expect(report.getByText(name, { exact: true })).toBeInViewport({ ratio: 1 })
  }
  const sourcesPath = testInfo.outputPath('report-sources.png')
  await page.bringToFront()
  await page.waitForTimeout(250)
  await page.screenshot({ path: sourcesPath })
  await testInfo.attach('report-sources', { path: sourcesPath, contentType: 'image/png' })

  await acknowledgement.scrollIntoViewIfNeeded()
  await expect(acknowledgement).toBeInViewport({ ratio: 1 })
  await expect(
    report.getByText(en['settings.about.diagnostics.report.acknowledgement'], { exact: true })
  ).toBeInViewport({ ratio: 1 })
  const consentPath = testInfo.outputPath('report-consent.png')
  await page.bringToFront()
  await page.waitForTimeout(250)
  await page.screenshot({ path: consentPath })
  await testInfo.attach('report-consent', { path: consentPath, contentType: 'image/png' })

  for (const name of optionalSources) {
    const source = report.getByRole('switch', { name, exact: true })
    await source.uncheck()
    await expect(source).not.toBeChecked()
  }
  await expect(report.getByRole('checkbox')).toHaveCount(0)
  await expect(system).toBeVisible()
  await expect(system).toBeChecked()
  await expect(system).toBeDisabled()

  const description = report.getByRole('textbox', {
    name: en['settings.about.diagnostics.report.description_label'],
    exact: true
  })
  await description.fill('Allow rearranging the settings sections.')
  await expect(description).toHaveValue('Allow rearranging the settings sections.')
  const submit = report.getByRole('button', {
    name: en['settings.about.diagnostics.upload.actions.consent_upload'],
    exact: true
  })
  await expect(submit).toBeEnabled()

  await chatRecords.scrollIntoViewIfNeeded()
  await expect(chatRecords).toBeInViewport({ ratio: 1 })
  for (const name of optionalSources) {
    await expect(report.getByRole('switch', { name, exact: true })).toBeInViewport({ ratio: 1 })
    await expect(report.getByText(name, { exact: true })).toBeInViewport({ ratio: 1 })
  }
  await expect(system).toBeInViewport({ ratio: 1 })
  await expect(description).toBeInViewport()
  await expect(submit).toBeInViewport({ ratio: 1 })
  const noAttachmentsPath = testInfo.outputPath('report-no-attachments.png')
  await page.bringToFront()
  await page.waitForTimeout(250)
  await page.screenshot({ path: noAttachmentsPath })
  await testInfo.attach('report-no-attachments', { path: noAttachmentsPath, contentType: 'image/png' })

  const traces = report.getByRole('switch', {
    name: en['settings.about.diagnostics.sources.traces.title'],
    exact: true
  })
  await traces.check()
  await expect(traces).toBeChecked()
  await expect(acknowledgement).toBeVisible()
  await expect(acknowledgement).toBeChecked()
  await expect(submit).toBeEnabled()
})
