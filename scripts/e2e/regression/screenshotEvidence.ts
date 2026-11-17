import type { Page } from '@playwright/test'

export async function captureMaskedScreenshot(page: Page, sensitiveValues: string[]): Promise<Buffer> {
  return page.screenshot({
    fullPage: true,
    animations: 'disabled',
    mask: [
      page.locator('input, textarea, [contenteditable="true"], iframe'),
      page.getByText(/[^\s@]+@[^\s@]+\.[^\s@]+/),
      ...sensitiveValues.flatMap((value) => (value ? [page.getByText(value, { exact: false })] : []))
    ]
  })
}
