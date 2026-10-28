import { expect, type Page, test } from '@playwright/test'

async function stableReadingPosition(page: Page) {
  let position: { page: number; top: number; left: number; zoom: string } | null = null
  await expect
    .poll(async () => {
      position = await page.getByTestId('pdfjs-viewer-container').evaluate(async (container) => {
        const measure = () => {
          const bounds = container.getBoundingClientRect()
          const visible = Array.from(container.querySelectorAll<HTMLElement>('.page')).filter((node) => {
            const rect = node.getBoundingClientRect()
            return rect.bottom > bounds.top && rect.top < bounds.bottom
          })
          if (!visible.length || visible.some((node) => node.dataset.loaded !== 'true')) return null
          const first = visible[0]
          const rect = first.getBoundingClientRect()
          return {
            page: Number(first.dataset.pageNumber),
            top: rect.top - bounds.top,
            left: rect.left - bounds.left,
            zoom: document.querySelector('[data-testid="pdf-preview-zoom-value"]')!.textContent,
            geometry: visible.map((node) => [node.offsetTop, node.offsetWidth, node.offsetHeight]),
            scroll: [container.scrollTop, container.scrollLeft, container.clientWidth, container.clientHeight]
          }
        }
        const before = measure()
        if (!before) return null
        for (let frame = 0; frame < 3; frame++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          if (JSON.stringify(measure()) !== JSON.stringify(before)) return null
        }
        return before
      })
      return position !== null
    })
    .toBe(true)
  return position!
}

test('PDF refresh clamps the reading anchor when its page becomes shorter', async ({ page }) => {
  await page.goto('/tests/browser/index.html')
  const indicator = page.getByTestId('pdf-preview-page-indicator').locator('input')
  const container = page.getByTestId('pdfjs-viewer-container')
  await expect(indicator).toHaveValue('1')
  for (let number = 2; number <= 8; number++) {
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(indicator).toHaveValue(String(number))
    await expect(page.locator(`.page[data-page-number="${number}"]`)).toHaveAttribute('data-loaded', 'true')
  }
  await container.evaluate((node) => {
    node.scrollTop += 120
  })
  const before = await stableReadingPosition(page)
  expect(before.page).toBe(8)
  const oldPage = await page.locator('.page[data-page-number="8"]').elementHandle()
  await page.getByRole('button', { name: 'Shrink reading page', exact: true }).click()
  await expect.poll(() => oldPage.evaluate((node) => node.isConnected)).toBe(false)
  const after = await stableReadingPosition(page)
  expect(after.page).toBe(8)
  expect(after.zoom).toBe(before.zoom)
  expect(Math.abs(after.top)).toBeLessThan(10)
})

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
    await stableReadingPosition(page)
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
    await stableReadingPosition(page)
    // Fit and document-end clamping may leave page 8 above the first visible reading anchor.
    await indicator.fill('8')
    await indicator.press('Enter')
    const fittedPosition = await stableReadingPosition(page)
    const fitZoom = fittedPosition.zoom
    const fittedPage = await page.locator('.page[data-page-number="8"]').elementHandle()
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect.poll(() => fittedPage.evaluate((node) => node.isConnected)).toBe(false)
    const restoredPosition = await stableReadingPosition(page)
    expect(restoredPosition.page).toBe(fittedPosition.page)
    expect(restoredPosition.zoom).toBe(fittedPosition.zoom)
    expect(Math.abs(restoredPosition.top - fittedPosition.top)).toBeLessThan(10)
    expect(Math.abs(restoredPosition.left - fittedPosition.left)).toBeLessThan(10)
    await page.getByRole('button', { name: 'Width 450', exact: true }).click()
    if (responsive) await expect(page.getByTestId('pdf-preview-zoom-value')).not.toHaveText(fitZoom)
    else await expect(page.getByTestId('pdf-preview-zoom-value')).toHaveText(fitZoom)
    await page.getByRole('button', { name: 'Shorten', exact: true }).click()
    await expect(page.getByTestId('pdf-preview-page-indicator')).toContainText('/ 3')
    await expect(page.locator('.page[data-page-number="3"]')).toHaveAttribute('data-loaded', 'true')
    await expect(indicator).toHaveValue('3')
  })
}
