import { expect } from '@playwright/test'

import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'
import type { Assistant } from '../../../../src/shared/data/types/assistant'

export default async function conversationScrollbar(context: ScenarioContext): Promise<void> {
  const { page } = context
  await context.ensureChinese()
  await page.evaluate(() =>
    window.api.preference.setMultiple({
      'app.onboarding.provider_setup.status': 'skipped',
      'app.privacy.data_collection.enabled': false,
      'topic.tab.show': true,
      'topic.tab.display_mode': 'time',
      'topic.tab.position': 'left'
    })
  )
  await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible({ timeout: 30_000 })
  const prefix = '滚动条验证'
  await page.evaluate(async (prefix) => {
    const assistants = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'GET',
      path: '/assistants'
    })
    const assistantId = (assistants.data as { items: Assistant[] }).items[0].id
    for (let index = 0; index < 85; index++) {
      const topic = await window.api.dataApi.request({
        id: crypto.randomUUID(),
        method: 'POST',
        path: '/topics',
        body: { name: `${prefix} ${index} — 长标题侧栏测试`, assistantId }
      })
      if (topic.status !== 201) throw new Error(`Could not seed topic: ${topic.status}`)
    }
  }, prefix)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.bringToFront()
  await page.locator('button[aria-label="对话"][data-dnd-row-control=true]').click()
  const showSidebar = page.getByRole('button', { name: '显示侧边栏', exact: true }).first()
  const hideSidebar = page.getByRole('button', { name: '隐藏侧边栏', exact: true }).first()
  await expect(showSidebar.or(hideSidebar).first()).toBeVisible()
  if (await showSidebar.isVisible()) await showSidebar.click()

  const selector = '[data-resource-list-presentation] [data-slot=scroll-area-viewport][role=listbox]:visible'
  await context.runSteps([{ verb: 'expectVisible', selector }])
  const list = page.locator(selector)
  await expect(list.getByRole('option').filter({ hasText: prefix }).first()).toBeVisible({ timeout: 20000 })
  const root = list.locator('..')
  const track = root.locator('[data-slot=scroll-area-scrollbar][data-orientation=vertical]')
  const thumb = track.locator('[data-slot=scroll-area-thumb]')
  const bounds = async () => {
    const box = await list.boundingBox()
    if (!box) throw new Error('Sidebar viewport has no bounds')
    return box
  }
  const measure = () =>
    list.evaluate((element, prefix) => {
      const frame = element.closest('[data-resource-list-presentation]')!.getBoundingClientRect()
      const viewport = element.getBoundingClientRect()
      const row = [...element.querySelectorAll('[role=option]')]
        .filter((option) => option.textContent?.includes(prefix))
        .map((option) => option.getBoundingClientRect())
        .find((rect) => rect.top >= viewport.top && rect.bottom <= viewport.bottom)!
      return {
        left: row.left - frame.left,
        right: frame.right - row.right,
        width: row.width,
        frameWidth: frame.width,
        viewportWidth: viewport.width,
        top: element.scrollTop,
        gutter: (element as HTMLElement).offsetWidth - element.clientWidth,
        overflowX: element.scrollWidth - element.clientWidth,
        overflowY: element.scrollHeight - element.clientHeight,
        nativeScrollbar: getComputedStyle(element).scrollbarWidth
      }
    }, prefix)
  const idle = await measure()
  expect(idle.left).toBeCloseTo(6, 1)
  expect(Math.abs(idle.right - 6.5)).toBeLessThanOrEqual(0.5)
  expect(idle.gutter).toBe(0)
  expect(idle.overflowX).toBe(0)
  expect(idle.overflowY).toBeGreaterThan(600)
  expect(idle.nativeScrollbar).toBe('none')
  const expectSameWidth = async () => {
    const sample = await measure()
    expect(sample.left).toBeCloseTo(idle.left, 2)
    expect(sample.right).toBeCloseTo(idle.right, 2)
    expect(sample.width).toBeCloseTo(idle.width, 2)
    expect(sample.viewportWidth).toBeCloseTo(idle.viewportWidth, 2)
    expect(sample.gutter).toBe(0)
    return sample
  }
  await context.screenshot('idle')

  const viewport = await bounds()
  await page.mouse.move(viewport.x + 50, viewport.y + viewport.height / 2)
  await page.mouse.wheel(0, 500)
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(idle.top)
  const scrolled = await expectSameWidth()
  const paintedWidth = () =>
    thumb.evaluate((element) => {
      const style = getComputedStyle(element)
      return (
        element.getBoundingClientRect().width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
      )
    })
  await expect.poll(paintedWidth).toBeCloseTo(4, 1)
  const thin = await paintedWidth()
  const trackBox = await track.boundingBox()
  if (!trackBox) throw new Error('Scrollbar track has no bounds')
  await page.mouse.move(trackBox.x + trackBox.width / 2, trackBox.y + trackBox.height / 2)
  await expect.poll(paintedWidth).toBeCloseTo(10, 1)
  const wide = await paintedWidth()
  await expect(thumb).toHaveCSS('background-image', 'none')
  await expectSameWidth()
  await context.screenshot('hover-expanded')

  const thumbBox = await thumb.boundingBox()
  if (!thumbBox) throw new Error('Scrollbar thumb has no bounds')
  const x = thumbBox.x + thumbBox.width / 2
  const y = thumbBox.y + thumbBox.height / 2
  const beforeDrag = await list.evaluate((element) => element.scrollTop)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 32, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeDrag)
  const dragged = await expectSameWidth()

  await page.mouse.move(viewport.x + viewport.width + 40, viewport.y + 30)
  const samples: number[] = []
  await expect
    .poll(
      async () => {
        const opacity = await track.evaluateAll(([element]) =>
          element ? Number(getComputedStyle(element).opacity) : 0
        )
        samples.push(opacity)
        return opacity
      },
      { intervals: [15], timeout: 5000 }
    )
    .toBe(0)
  expect(samples.some((value) => value > 0 && value < 1)).toBe(true)
  await expect(track).toHaveCount(0)
  const hidden = await expectSameWidth()
  await context.screenshot('faded')
  const handle = page.getByRole('separator', { name: '调整面板宽度' })
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('Sidebar resize handle has no bounds')
  const handleX = handleBox.x + handleBox.width / 2
  const handleY = handleBox.y + handleBox.height / 2
  await page.mouse.move(handleX, handleY)
  await page.mouse.down()
  await page.mouse.move(handleX + 65, handleY, { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => (await measure()).frameWidth).toBeGreaterThan(idle.frameWidth + 35)
  const resized = await measure()
  expect(resized.left).toBeCloseTo(idle.left, 2)
  expect(resized.right).toBeCloseTo(idle.right, 2)
  expect(resized.gutter).toBe(0)
  expect(resized.overflowX).toBe(0)
  await context.screenshot('resized')
  process.stdout.write(
    `Conversation scrollbar evidence ${JSON.stringify({ idle, scrolled, dragged, hidden, resized, thin, wide, samples })}\n`
  )
}
