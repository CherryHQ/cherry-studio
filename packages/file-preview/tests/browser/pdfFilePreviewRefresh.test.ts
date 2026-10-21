import { expect, test } from '@playwright/test'

// Exercises the built public package, its worker and Chromium layout without an Electron profile.
for (const { mixed, offset, wide, responsive } of [
  { mixed: true, offset: 120, wide: false, responsive: true },
  { mixed: false, offset: 120, wide: false, responsive: true },
  { mixed: true, offset: -80, wide: false, responsive: true },
  { mixed: true, offset: 120, wide: true, responsive: false },
  { mixed: true, offset: 120, wide: true, responsive: true }
]) {
  test(`PDF refresh retains a reading anchor: mixed=${mixed}, offset=${offset}, wide=${wide}, responsive=${responsive}`, async ({
    page
  }) => {
    await page.goto(`/tests/browser/index.html?mixed=${mixed}&wide=${wide}&responsive=${responsive}`)
    const indicator = page.getByTestId('pdf-preview-page-indicator').locator('input')
    const container = page.getByTestId('pdfjs-viewer-container')
    const pageTop = () =>
      page.locator('.page[data-page-number="8"]').evaluate((node) => node.getBoundingClientRect().top)
    await expect(indicator).toHaveValue('1')
    for (let number = 2; number <= 8; number++) {
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await expect(indicator).toHaveValue(String(number))
      await expect(page.locator(`.page[data-page-number="${number}"]`)).toHaveAttribute('data-loaded', 'true')
    }
    // Move within the page: retaining just page number would lose this reading offset.
    // A negative offset starts in page 7 although page 8 remains the current page.
    await container.evaluate((node, offset) => {
      node.scrollTop += offset
    }, offset)
    await expect(indicator).toHaveValue('8')
    const beforeTop = await pageTop()
    const zoom = await page.getByTestId('pdf-preview-zoom-value').textContent()
    const oldPage = await page.locator('.page[data-page-number="8"]').elementHandle()
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect.poll(() => oldPage.evaluate((node) => node.isConnected)).toBe(false)
    await expect(indicator).toHaveValue('8')
    await expect(page.locator('.page[data-page-number="8"]')).toHaveAttribute('data-loaded', 'true')
    await expect(page.getByTestId('pdf-preview-zoom-value')).toHaveText(zoom!)
    await expect.poll(async () => Math.abs((await pageTop()) - beforeTop)).toBeLessThan(10)

    await page.getByRole('button', { name: 'Zoom In', exact: true }).click()
    const manualZoom = await page.getByTestId('pdf-preview-zoom-value').textContent()
    await page.getByRole('button', { name: 'Hide', exact: true }).click()
    await expect(container).toBeHidden()
    await page.getByRole('button', { name: 'Show', exact: true }).click()
    await expect(indicator).toHaveValue('8')
    await expect(page.locator('.page[data-page-number="8"]')).toHaveAttribute('data-loaded', 'true')
    await expect(page.getByTestId('pdf-preview-zoom-value')).toHaveText(manualZoom!)
    await page.getByRole('button', { name: 'Width 550', exact: true }).click()
    await expect(page.getByTestId('pdf-preview-zoom-value')).toHaveText(manualZoom!)

    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    // Native fit can change the current page; establish the reading destination before refreshing.
    await indicator.fill('8')
    await indicator.press('Enter')
    await expect(indicator).toHaveValue('8')
    await expect(page.locator('.page[data-page-number="8"]')).toHaveAttribute('data-loaded', 'true')
    const fitZoom = await page.getByTestId('pdf-preview-zoom-value').textContent()
    const fittedPage = await page.locator('.page[data-page-number="8"]').elementHandle()
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect.poll(() => fittedPage.evaluate((node) => node.isConnected)).toBe(false)
    await expect(indicator).toHaveValue('8')
    await expect(page.locator('.page[data-page-number="8"]')).toHaveAttribute('data-loaded', 'true')
    await page.getByRole('button', { name: 'Width 450', exact: true }).click()
    if (responsive) await expect(page.getByTestId('pdf-preview-zoom-value')).not.toHaveText(fitZoom!)
    else await expect(page.getByTestId('pdf-preview-zoom-value')).toHaveText(fitZoom!)
    await page.getByRole('button', { name: 'Shorten', exact: true }).click()
    await expect(page.getByTestId('pdf-preview-page-indicator')).toContainText('/ 3')
    await expect(page.locator('.page[data-page-number="3"]')).toHaveAttribute('data-loaded', 'true')
    await expect(indicator).toHaveValue('3')
  })
}
