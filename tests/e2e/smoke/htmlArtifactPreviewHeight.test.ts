import { rm } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'

import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, runTest, testInfo) => {
    const profileRoot = testInfo.outputPath('profile')
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profileRoot },
      timeout: 60000
    })
    await runTest(electronApp)
    await electronApp.close()
    await rm(profileRoot, { recursive: true, force: true, maxRetries: 3 })
  }
})

const MARKDOWN = [
  'before-block-marker',
  '',
  '```html',
  '<iframe src="https://example.invalid/x" height="120"></iframe>',
  '```',
  '',
  'after-block-marker'
].join('\n')

test('inline HTML iframe preview settles and stays stable across scrolling', async ({ mainWindow: page }, testInfo) => {
  await page.evaluate(async () => {
    await window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.onboarding.provider_setup.status': 'skipped',
      'app.privacy.policy_version': '20260820'
    })
  })
  await page.reload()
  await page.waitForSelector('#root')

  const topicId = await page.evaluate(async (markdown) => {
    const assistantResponse = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'POST',
      path: '/assistants',
      body: { name: `HTML preview height ${Date.now()}` }
    })
    if (assistantResponse.error) throw new Error(assistantResponse.error.message)
    const assistant = assistantResponse.data as { id: string }
    const topicResponse = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'POST',
      path: '/topics',
      body: { name: `HTML preview height ${Date.now()}`, assistantId: assistant.id }
    })
    if (topicResponse.error) throw new Error(topicResponse.error.message)
    const topic = topicResponse.data as { id: string }
    const surroundingMessages = (count: number) =>
      Array.from({ length: count }, (_, index) => `Scroll space ${index}\n\nSurrounding message`)
    for (const text of [...surroundingMessages(6), markdown, ...surroundingMessages(16)]) {
      const message = await window.api.dataApi.request({
        id: crypto.randomUUID(),
        method: 'POST',
        path: `/topics/${topic.id}/messages`,
        body: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text }] } }
      })
      if (message.error) throw new Error(message.error.message)
    }
    return topic.id
  }, MARKDOWN)

  await page.reload()
  await page.waitForSelector('#root')
  await page.evaluate(
    (id) => window.api.ipcApi.request('navigation.open_route_in_main', { path: `/app/chat?topicId=${id}` }),
    topicId
  )
  const messageList = page.locator('[data-message-virtual-list-scroller]').filter({ visible: true }).first()
  await messageList.hover()
  await page.mouse.wheel(0, -10000)
  const artifact = page.getByTestId('message-html-artifact').first()
  await artifact.waitFor({ state: 'attached' })
  await artifact.scrollIntoViewIfNeeded()
  await expect(artifact).toBeVisible()
  const sampling = await page.evaluateHandle(async () => {
    const surface = document.querySelector<HTMLElement>('[data-testid="html-artifact-surface"]')
    const marker = Array.from(document.querySelectorAll('p')).find((p) => p.textContent === 'after-block-marker')
    const frame = surface?.querySelector('iframe')
    if (!surface || !marker || !frame) throw new Error('Expected artifact surface, frame and following paragraph')
    const scroller = surface.closest<HTMLElement>('[data-message-virtual-list-scroller]')
    if (!scroller) throw new Error('Expected message-list scroller')
    let styleMutations = 0
    const observer = new MutationObserver((records) => {
      styleMutations += records.length
    })
    observer.observe(surface, { attributes: true, attributeFilter: ['style'] })
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const read = () => ({
      styleHeight: surface.style.height,
      height: surface.getBoundingClientRect().height,
      paragraphTop: marker.getBoundingClientRect().top,
      scrollTop: scroller.scrollTop,
      rootOverflow: frame.contentDocument!.documentElement.scrollHeight - frame.clientHeight
    })
    const samples: ReturnType<typeof read>[] = []
    try {
      const deadline = performance.now() + 10000
      let quietSince = performance.now()
      let previous = ''
      let ready = false
      while (performance.now() < deadline) {
        await nextFrame()
        const doc = frame.contentDocument
        const intendedDocument =
          doc?.URL !== 'about:blank' &&
          doc?.querySelector('iframe[src="https://example.invalid/x"]') &&
          doc.readyState === 'complete' &&
          doc.fonts.status === 'loaded'
        const current = intendedDocument ? JSON.stringify({ ...read(), styleMutations }) : ''
        if (!current || current !== previous) quietSince = performance.now()
        previous = current
        if (current && performance.now() - quietSince >= 500) {
          ready = true
          break
        }
      }
      if (!ready) throw new Error('Intended loaded document did not remain unchanged for 500 ms within 10 s')
      const effectiveCap = 0.72 * scroller.clientHeight
      const settledSurfaceHeight = surface.getBoundingClientRect().height
      if (effectiveCap <= settledSurfaceHeight + 8) {
        throw new Error(
          `Effective preview cap ${effectiveCap} CSS px must exceed settled surface height ${settledSurfaceHeight} CSS px by more than 8 CSS px`
        )
      }
      styleMutations = 0
      observer.takeRecords()
      const started = performance.now()
      do {
        await nextFrame()
        samples.push(read())
      } while (performance.now() - started < 1500 || samples.length < 30)
      const elapsed = performance.now() - started
      const samplingMutations = styleMutations + observer.takeRecords().length
      const sampledSurfaceTop = surface.getBoundingClientRect().top
      return {
        measurements: { effectiveCap, elapsed, samples, samplingMutations, sampledSurfaceTop },
        finish: () => {
          const sameSurface =
            surface.isConnected && surface === document.querySelector('[data-testid="html-artifact-surface"]')
          const returned = sameSurface ? read() : null
          const totalMutations = styleMutations + observer.takeRecords().length
          observer.disconnect()
          return { sameSurface, returned, totalMutations }
        }
      }
    } catch (error) {
      observer.disconnect()
      throw error
    }
  })
  const sampled = await sampling.evaluate((state) => state.measurements)
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
  expect(sampled.elapsed).toBeGreaterThanOrEqual(1500)
  expect(sampled.samples.length).toBeGreaterThanOrEqual(30)
  expect(new Set(sampled.samples.map((sample) => sample.styleHeight)).size).toBe(1)
  expect(spread(sampled.samples.map((sample) => sample.height))).toBeLessThanOrEqual(0.25)
  expect(spread(sampled.samples.map((sample) => sample.paragraphTop))).toBeLessThanOrEqual(0.25)
  expect(new Set(sampled.samples.map((sample) => sample.scrollTop)).size).toBe(1)
  expect(Math.max(...sampled.samples.map((sample) => sample.rootOverflow))).toBeLessThanOrEqual(1)
  expect(sampled.samplingMutations).toBe(0)

  const list = page.locator('[data-message-virtual-list-scroller]').filter({ visible: true }).first()
  await list.hover()
  const geometry = () =>
    page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>('[data-testid="html-artifact-surface"]')!
      const scroller = surface.closest<HTMLElement>('[data-message-virtual-list-scroller]')!
      return {
        scrollTop: scroller.scrollTop,
        height: surface.getBoundingClientRect().height,
        top: surface.getBoundingClientRect().top,
        bottom: surface.getBoundingClientRect().bottom,
        scrollerTop: scroller.getBoundingClientRect().top,
        scrollerClientHeight: scroller.clientHeight
      }
    })
  for (let step = 0; step < 25; step += 1) {
    await page.mouse.wheel(0, 400)
    await page.waitForTimeout(120)
    const info = await geometry()
    if (info.bottom < info.scrollerTop) break
  }
  const away = await geometry()
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(120)
    const info = await geometry()
    if (info.top > info.scrollerTop && info.bottom < info.scrollerTop + info.scrollerClientHeight) break
  }
  await page.waitForTimeout(600)
  const back = await geometry()
  const roundTrip = await sampling.evaluate((state) => state.finish())
  await sampling.dispose()
  const measurements = { ...sampled, away, back, ...roundTrip }
  await testInfo.attach('height-measurements', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json'
  })
  expect(measurements.sameSurface).toBe(true)
  expect(away.bottom).toBeLessThan(away.scrollerTop)
  expect(back.top).toBeGreaterThan(back.scrollerTop)
  expect(back.bottom).toBeLessThan(back.scrollerTop + back.scrollerClientHeight)
  expect(back.height).toBe(measurements.samples[0].height)
  expect(measurements.returned!.styleHeight).toBe(measurements.samples[0].styleHeight)
  expect(Math.abs(measurements.returned!.height - measurements.samples[0].height)).toBeLessThanOrEqual(0.25)
  expect(
    Math.abs(
      measurements.returned!.paragraphTop -
        back.top -
        (measurements.samples[0].paragraphTop - measurements.sampledSurfaceTop)
    )
  ).toBeLessThanOrEqual(0.25)
  expect(measurements.totalMutations).toBe(0)

  const screenshotPath = testInfo.outputPath('html-artifact-preview-height.png')
  await page.bringToFront()
  await page.waitForTimeout(250)
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('html-artifact-preview-height', { path: screenshotPath, contentType: 'image/png' })
})
