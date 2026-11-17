import { expect, test } from './fixtures/electron.fixture'

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
  await expect
    .poll(() =>
      messageList.evaluate(
        (element) => element.scrollTop > 0 && element.scrollHeight - element.clientHeight - element.scrollTop <= 2
      )
    )
    .toBe(true)
  const geometry = () =>
    messageList.evaluate((scroller) => {
      const surface = scroller.querySelector<HTMLElement>('[data-testid="html-artifact-surface"]')
      const bounds = surface?.getBoundingClientRect()
      return {
        scrollTop: scroller.scrollTop,
        surface: bounds ? { height: bounds.height, top: bounds.top, bottom: bounds.bottom } : null,
        scrollerTop: scroller.getBoundingClientRect().top,
        scrollerClientHeight: scroller.clientHeight
      }
    })
  const listBounds = await messageList.boundingBox()
  if (!listBounds) throw new Error('Expected a visible message-list scroller')
  const wheelPoint = { x: listBounds.x + 24, y: listBounds.y + listBounds.height / 2 }
  await expect
    .poll(() =>
      messageList.evaluate(
        (scroller, point) =>
          scroller.contains(document.elementFromPoint(point.x, point.y)) &&
          !document.elementFromPoint(point.x, point.y)?.closest('iframe'),
        wheelPoint
      )
    )
    .toBe(true)
  await page.mouse.move(wheelPoint.x, wheelPoint.y)
  const artifact = messageList.getByTestId('message-html-artifact').first()
  const preview = artifact.getByTestId('html-artifact-surface')
  for (let step = 0; step < 60; step += 1) {
    const info = await geometry()
    if (
      info.surface &&
      info.surface.top > info.scrollerTop &&
      info.surface.bottom < info.scrollerTop + info.scrollerClientHeight
    )
      break
    await page.mouse.wheel(0, -100)
    await page.waitForTimeout(120)
  }
  await expect(preview).toBeInViewport({ ratio: 1 })
  await expect(preview.locator('iframe')).toBeAttached()
  await expect(messageList.getByText('after-block-marker', { exact: true })).toBeAttached()
  const samplePreview = () =>
    messageList.evaluateHandle(async (scroller) => {
      const surface = scroller.querySelector<HTMLElement>('[data-testid="html-artifact-surface"]')
      const marker = Array.from(scroller.querySelectorAll('p')).find((p) => p.textContent === 'after-block-marker')
      const frame = surface?.querySelector('iframe')
      if (!surface || !marker || !frame) throw new Error('HTML preview was detached before sampling')
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
        if (!ready) {
          const doc = frame.contentDocument
          throw new Error(
            `Intended loaded document did not remain unchanged for 500 ms within 10 s: ${JSON.stringify({
              connected: { surface: surface.isConnected, marker: marker.isConnected, frame: frame.isConnected },
              document: {
                url: doc?.URL,
                readyState: doc?.readyState,
                fonts: doc?.fonts.status,
                intendedIframe: !!doc?.querySelector('iframe[src="https://example.invalid/x"]')
              },
              styleMutations,
              surfaceBounds: surface.getBoundingClientRect().toJSON(),
              scrollTop: scroller.scrollTop
            })}`
          )
        }
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
              surface.isConnected && surface === scroller.querySelector('[data-testid="html-artifact-surface"]')
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
  const sampling = await samplePreview()
  const sampled = await sampling.evaluate((state) => state!.measurements)
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
  expect(sampled.elapsed).toBeGreaterThanOrEqual(1500)
  expect(sampled.samples.length).toBeGreaterThanOrEqual(30)
  expect(new Set(sampled.samples.map((sample) => sample.styleHeight)).size).toBe(1)
  expect(spread(sampled.samples.map((sample) => sample.height))).toBeLessThanOrEqual(0.25)
  expect(spread(sampled.samples.map((sample) => sample.paragraphTop))).toBeLessThanOrEqual(0.25)
  expect(new Set(sampled.samples.map((sample) => sample.scrollTop)).size).toBe(1)
  expect(Math.max(...sampled.samples.map((sample) => sample.rootOverflow))).toBeLessThanOrEqual(1)
  expect(sampled.samplingMutations).toBe(0)

  for (let step = 0; step < 40; step += 1) {
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(120)
    const info = await geometry()
    if (!info.surface || info.surface.bottom < info.scrollerTop) break
  }
  const away = await geometry()
  expect(!away.surface || away.surface.bottom < away.scrollerTop).toBe(true)
  for (let step = 0; step < 60; step += 1) {
    await page.mouse.wheel(0, -100)
    await page.waitForTimeout(120)
    const info = await geometry()
    if (
      info.surface &&
      info.surface.top > info.scrollerTop &&
      info.surface.bottom < info.scrollerTop + info.scrollerClientHeight
    )
      break
  }
  await expect(preview).toBeInViewport({ ratio: 1 })
  const back = await geometry()
  const returnedSampling = await samplePreview()
  const returned = await returnedSampling.evaluate((state) => state!.measurements)
  const roundTrip = await sampling.evaluate((state) => state!.finish())
  await returnedSampling.evaluate((state) => state!.finish())
  await Promise.all([sampling.dispose(), returnedSampling.dispose()])
  const measurements = { ...sampled, away, back, returnedSamples: returned, ...roundTrip }
  await testInfo.attach('height-measurements', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json'
  })
  expect(returned.elapsed).toBeGreaterThanOrEqual(1500)
  expect(returned.samples.length).toBeGreaterThanOrEqual(30)
  expect(back.surface!.top).toBeGreaterThan(back.scrollerTop)
  expect(back.surface!.bottom).toBeLessThan(back.scrollerTop + back.scrollerClientHeight)
  expect(back.surface!.height).toBe(sampled.samples[0].height)
  expect(new Set(returned.samples.map((sample) => sample.styleHeight))).toEqual(
    new Set(sampled.samples.map((sample) => sample.styleHeight))
  )
  expect(spread(returned.samples.map((sample) => sample.height))).toBeLessThanOrEqual(0.25)
  expect(spread(returned.samples.map((sample) => sample.paragraphTop))).toBeLessThanOrEqual(0.25)
  expect(new Set(returned.samples.map((sample) => sample.scrollTop)).size).toBe(1)
  expect(Math.max(...returned.samples.map((sample) => sample.rootOverflow))).toBeLessThanOrEqual(1)
  expect(returned.samplingMutations).toBe(0)
  expect(
    Math.abs(
      returned.samples[0].paragraphTop -
        returned.sampledSurfaceTop -
        (sampled.samples[0].paragraphTop - sampled.sampledSurfaceTop)
    )
  ).toBeLessThanOrEqual(0.25)
  expect(measurements.totalMutations).toBe(0)

  const screenshotPath = testInfo.outputPath('html-artifact-preview-height.png')
  await page.bringToFront()
  await page.waitForTimeout(250)
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('html-artifact-preview-height', { path: screenshotPath, contentType: 'image/png' })
})
