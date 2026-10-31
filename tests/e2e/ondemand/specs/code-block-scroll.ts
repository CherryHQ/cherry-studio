import { expect } from '@playwright/test'

import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'
import type { Assistant } from '../../../../src/shared/data/types/assistant'
import type { Topic } from '../../../../src/shared/data/types/topic'
import type { IpcResult } from '../../../../src/shared/ipc/errors/IpcError'

declare global {
  interface Window {
    codeBlockScrollProbe?: { reads: number; restore: () => void }
  }
}

export default async function codeBlockScroll(context: ScenarioContext): Promise<void> {
  const { page } = context
  await context.ensureChinese()
  const preferences = await page.evaluate(async () => ({
    'chat.code.collapsible': await window.api.preference.get('chat.code.collapsible'),
    'chat.code.wrappable': await window.api.preference.get('chat.code.wrappable')
  }))
  const name = `code-block-scroll-${Date.now()}`
  let assistantId: string | undefined
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'chat.code.collapsible': false, 'chat.code.wrappable': true })
    )
    const assistant = await page.evaluate(
      (name) =>
        window.api.dataApi.request({ id: crypto.randomUUID(), method: 'POST', path: '/assistants', body: { name } }),
      name
    )
    expect(assistant.status).toBe(201)
    assistantId = (assistant.data as Assistant).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name, assistantId }
    )
    expect(topic.status).toBe(201)
    const source = Array.from(
      { length: 12 },
      (_, block) =>
        `## Block ${block}\n\n\`\`\`typescript\n` +
        Array.from({ length: 8 }, (_, line) => `const value${line} = "block-${block}-line-${line}";`).join('\n') +
        '\n```'
    ).join('\n\n')
    const message = await page.evaluate(
      ({ topicId, source }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: `/topics/${topicId}/messages`,
          body: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: source }] } }
        }),
      { topicId: (topic.data as Topic).id, source }
    )
    expect(message.status).toBe(201)
    await page.reload({ waitUntil: 'domcontentloaded' })
    // Track synchronous scroll callbacks separately from subsequent layout-observer notifications.
    await page.evaluate(() => {
      const originalBounds = Element.prototype.getBoundingClientRect
      const originalAdd = EventTarget.prototype.addEventListener
      const originalRemove = EventTarget.prototype.removeEventListener
      const listeners = new WeakMap<EventListenerOrEventListenerObject, EventListener>()
      let scrollDepth = 0
      const probe = {
        reads: 0,
        restore() {
          Element.prototype.getBoundingClientRect = originalBounds
          EventTarget.prototype.addEventListener = originalAdd
          EventTarget.prototype.removeEventListener = originalRemove
          delete window.codeBlockScrollProbe
        },
        measure(this: Element) {
          if (scrollDepth > 0 && this.matches('.shiki-list')) probe.reads++
          return originalBounds.call(this)
        },
        add(
          this: EventTarget,
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          options?: AddEventListenerOptions | boolean
        ) {
          if (type !== 'scroll' || !listener) return originalAdd.call(this, type, listener, options)
          let wrapped = listeners.get(listener)
          if (!wrapped) {
            const handler = {
              invoke(this: EventTarget, event: Event) {
                scrollDepth++
                try {
                  if (typeof listener === 'function') listener.call(this, event)
                  else listener.handleEvent(event)
                } finally {
                  scrollDepth--
                }
              }
            }
            wrapped = handler.invoke
            listeners.set(listener, wrapped)
          }
          originalAdd.call(this, type, wrapped, options)
        },
        remove(
          this: EventTarget,
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          options?: EventListenerOptions | boolean
        ) {
          originalRemove.call(
            this,
            type,
            type === 'scroll' && listener ? (listeners.get(listener) ?? listener) : listener,
            options
          )
        }
      }
      window.codeBlockScrollProbe = probe
      Element.prototype.getBoundingClientRect = probe.measure
      EventTarget.prototype.addEventListener = probe.add
      EventTarget.prototype.removeEventListener = probe.remove
    })
    const back = page.getByRole('button', { name: '返回', exact: true })
    if (await back.isVisible()) await back.click()
    await page.locator('button[aria-label="对话"]:not([data-tab-id])').click()
    await page.locator('[data-ui~="chat.item-title"]').filter({ hasText: name }).click()
    await context.runSteps([{ verb: 'expectVisible', selector: '[data-ui~="part:code-block"] .code-viewer' }])
    const scroll = page.locator('[data-ui~="chat.message-virtual-list"] [data-message-virtual-list-scroller]')
    await scroll.hover()
    await page.mouse.wheel(0, -100000)
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0)
    await expect(page.locator('.code-viewer').first().locator('.code-syntax-keyword').first()).toHaveText('const')

    await page.evaluate(() => {
      if (window.codeBlockScrollProbe) window.codeBlockScrollProbe.reads = 0
    })
    for (let step = 1; step <= 12; step++) {
      await page.mouse.wheel(0, 60)
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(step * 60)
    }
    expect(await page.evaluate(() => window.codeBlockScrollProbe?.reads)).toBe(0)
    await expect
      .poll(() =>
        scroll.evaluate((scroller) => {
          const viewport = scroller.getBoundingClientRect()
          const blocks = [...scroller.querySelectorAll('.code-viewer')].filter((block) => {
            const bounds = block.getBoundingClientRect()
            return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom
          })
          return (
            blocks.length > 0 &&
            blocks.every((block) => {
              const lines = [...block.querySelectorAll('.line-content')].map((line) => line.textContent)
              const number = lines[0]?.match(/block-(\d+)-/)?.[1]
              return (
                lines.length === 8 &&
                lines.every((line, index) => line === `const value${index} = "block-${number}-line-${index}";`)
              )
            })
          )
        })
      )
      .toBe(true)
    await page.mouse.wheel(0, -100000)
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0)
    await expect(page.locator('.code-viewer').first()).toContainText('block-0-line-0')
    expect(await page.evaluate(() => window.codeBlockScrollProbe?.reads)).toBe(0)
    await context.screenshot('code-block-scroll')
  } finally {
    await page.evaluate(
      async ({ preferences, assistantId }) => {
        window.codeBlockScrollProbe?.restore()
        await window.api.preference.setMultiple(preferences)
        if (assistantId) {
          const deleted = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<unknown>
          if (!deleted.ok) throw new Error(deleted.error.message)
        }
      },
      { preferences, assistantId }
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
  }
}
