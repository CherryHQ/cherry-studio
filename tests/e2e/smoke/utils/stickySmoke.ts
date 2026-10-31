import { writeFileSync } from 'node:fs'

import type { ElectronApplication, Locator, Page, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'

import { LATEST_PRIVACY_POLICY_VERSION } from '../../../../src/shared/utils/constants'

export async function stickyWindow(app: ElectronApplication): Promise<Page> {
  let page: Page | undefined
  await expect
    .poll(
      async () => {
        for (const candidate of app.windows()) {
          if ((await candidate.title()) === 'Cherry Studio') page = candidate
        }
        return Boolean(page)
      },
      { timeout: 60_000 }
    )
    .toBe(true)
  return page!
}

export async function prepareStickyShell(page: Page) {
  await page.waitForFunction(() => Boolean(window.api?.preference && window.api?.dataApi))
  await page.evaluate(async (version) => {
    await window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.privacy.policy_version': version
    })
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await waitForStickyShell(page)
}

export async function waitForStickyShell(page: Page) {
  await expect(
    page
      .locator(
        '[data-ui~="chat.view"], [data-ui~="agent.view"], [data-ui~="notes.view"], [data-onboarding-language-select]'
      )
      .first()
  ).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(
      async () => {
        const skip = page.getByRole('button', { name: /Set up later|稍后设置/ })
        if (await skip.isVisible()) await skip.evaluate((el: HTMLElement) => el.click())
        return await page
          .locator('[data-ui~="chat.view"], [data-ui~="agent.view"], [data-ui~="notes.view"]')
          .first()
          .isVisible()
      },
      { timeout: 30_000 }
    )
    .toBe(true)
}

export async function frames(list: Locator) {
  await list.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
}

export async function scroll(list: Locator, target: number) {
  expect(target, 'Requested scroll must be reachable').toBeGreaterThanOrEqual(0)
  expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThanOrEqual(target)
  await list.evaluate((el, value) => {
    el.scrollTop = value
  }, target)
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeCloseTo(target, 0)
  await frames(list)
}

export function namedRow(list: Locator, name: string) {
  return list.getByText(name, { exact: true }).locator('xpath=ancestor::*[@data-index][1]')
}

export async function findRow(list: Locator, name: string) {
  const row = namedRow(list, name)
  for (let step = 0; step < 100; step++) {
    if (await row.count()) return row
    const { current, next } = await list.evaluate((el) => ({
      current: el.scrollTop,
      next: Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + el.clientHeight / 3)
    }))
    if (next <= current) break
    await scroll(list, next)
  }
  throw new Error(`Row ${name} never mounted; inspect sticky-diagnostics.json list text and indexes`)
}

export async function rowState(row: Locator) {
  return row.evaluate((el) => {
    const list = el.closest('.dynamic-virtual-list')!
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const treeitem = el.querySelector<HTMLElement>('[role="treeitem"]')
    return {
      index: Number(el.getAttribute('data-index')),
      text: el.textContent?.trim(),
      top: rect.top - list.getBoundingClientRect().top - list.clientTop,
      height: rect.height,
      z: Number(style.zIndex),
      transform: style.transform,
      background: style.backgroundColor,
      depth: treeitem ? (parseFloat(treeitem.style.paddingLeft) - 8) / 12 : null
    }
  })
}

export async function naturalStart(list: Locator, name: string) {
  await scroll(list, 0)
  const row = await findRow(list, name)
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await rowState(row)
    if (state.top > 64) break
    const current = await list.evaluate((el) => el.scrollTop)
    await scroll(list, Math.max(0, current - 64))
  }
  expect((await rowState(row)).top, `${name} must be below all sticky slots before measuring`).toBeGreaterThan(64)
  const read = async () => (await list.evaluate((el) => el.scrollTop)) + (await rowState(row)).top
  let previous = await read()
  await expect
    .poll(async () => {
      await frames(list)
      const current = await read()
      const delta = Math.abs(current - previous)
      previous = current
      return delta
    })
    .toBeLessThanOrEqual(0.25)
  const a = await read()
  await frames(list)
  expect(Math.abs((await read()) - a)).toBeLessThanOrEqual(0.25)
  return { row, a }
}

export async function hit(list: Locator, offset: number) {
  return list.evaluate((el, y) => {
    const rect = el.getBoundingClientRect()
    const row = document
      .elementFromPoint(rect.left + el.clientLeft + 8, rect.top + el.clientTop + y)
      ?.closest('[data-index]')
    return { index: row ? Number(row.getAttribute('data-index')) : null, text: row?.textContent?.trim() }
  }, offset)
}

export async function mountedRange(list: Locator) {
  return list.locator('[data-index]').evaluateAll((rows) => {
    const indexes = rows.map((row) => Number(row.getAttribute('data-index'))).sort((a, b) => a - b)
    return { startIndex: indexes[0], endIndex: indexes.at(-1), indexes }
  })
}

export async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`sticky-${name}.png`)
  await page.screenshot({ path })
  await info.attach(`sticky-${name}`, { path, contentType: 'image/png' })
}

export async function jsonEvidence(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`)
  writeFileSync(path, JSON.stringify(value, null, 2))
  await info.attach(name, { path, contentType: 'application/json' })
}

export async function failureEvidence(page: Page, info: TestInfo) {
  if (info.status === info.expectedStatus) return
  // Diagnostics must not replace the assertion that failed.
  try {
    await jsonEvidence(info, 'sticky-diagnostics', {
      url: page.url(),
      accessibility: await page.locator('body').ariaSnapshot(),
      lists: await page.locator('.dynamic-virtual-list').evaluateAll((lists) =>
        lists.map((el) => ({
          text: (el as HTMLElement).innerText,
          scrollTop: el.scrollTop,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          rows: [...el.querySelectorAll('[data-index]')].map((row) => ({
            index: row.getAttribute('data-index'),
            text: row.textContent,
            top: row.getBoundingClientRect().top,
            transform: getComputedStyle(row).transform
          }))
        }))
      )
    })
    await screenshot(page, info, 'failure')
  } catch (error) {
    await info.attach('diagnostics-unavailable', { body: String(error), contentType: 'text/plain' })
  }
}
