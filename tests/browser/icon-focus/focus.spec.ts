import { expect, test } from '@playwright/test'

test('keyboard-selected icon has a rendered indicator with main-window styles', async ({ page }, testInfo) => {
  // Regression: the main-window outline reset must not erase the keyboard indicator.
  await page.goto('/tests/browser/icon-focus/index.html')
  const search = page.getByRole('textbox', { name: 'Search', exact: true })
  await search.fill('heart')
  const icon = page.getByRole('button').first()
  const selected = await icon.getAttribute('aria-label')
  await expect(icon).toBeVisible()
  const resting = await icon.evaluate((el) => ({
    shadow: getComputedStyle(el).boxShadow,
    background: getComputedStyle(el).backgroundColor
  }))
  await search.press('Tab')
  await expect(icon).toBeFocused()
  const focused = await icon.evaluate((el) => {
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return {
      visible: el.matches(':focus-visible'),
      shadow: style.boxShadow,
      background: style.backgroundColor,
      width: rect.width,
      height: rect.height
    }
  })
  expect(focused.visible).toBe(true)
  expect(focused.width).toBeGreaterThan(0)
  expect(focused.height).toBeGreaterThan(0)
  expect(focused.shadow).not.toBe('none')
  expect(focused.shadow).not.toBe(resting.shadow)
  expect(focused.shadow).not.toContain('rgba(0, 0, 0, 0) 0px 0px 0px 2px inset')
  await page.screenshot({ path: testInfo.outputPath('keyboard-focus.png') })
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Selected icon')).toHaveText(selected!)
})
