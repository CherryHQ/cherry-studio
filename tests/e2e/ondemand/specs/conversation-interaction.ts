import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LLMock } from '@copilotkit/aimock'
import { expect, type Page } from '@playwright/test'

import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'
import type { BranchMessagesResponse, CherryMessagePart, Message } from '../../../../src/shared/data/types/message'
import { efficiencyImage } from '../../regression/fixtures/chatEfficiencyServer'
import { selectSidebarApp } from '../../regression/navigation'
import { measure, png } from './conversation-performance'
import { catalogueReport, conversationParts } from './fixtures/conversationParts'

const modelId = 'gpt-4o-mini'
const endpoint = 'openai-chat-completions'
const queuedDraft = 'PERFIO-QUEUED Follow up while the inventory is streaming. '
const prompts = {
  finish: 'PERFIO-FINISH Render the inventory.',
  queued: queuedDraft + '继续跟进',
  pause: 'PERFIO-PAUSE Keep the output open.',
  disconnect: 'PERFIO-DISCONNECT Send some output.',
  retry: 'PERFIO-RETRY Recover after a transient provider error.'
} as const
type Turn = keyof typeof prompts
const lastMarker = (turn: Turn) => `PERFIO-OUTPUT-${turn.toUpperCase()}`

function gate() {
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  return { waiting, release }
}

async function startInteractionMock(video: Buffer, image: Buffer) {
  const mock = new LLMock({ host: '127.0.0.1', port: 0, strict: true })
  const startFinishReply = gate()
  const gates = { finish: gate(), pause: gate(), disconnect: gate(), retry: gate() }
  const requests: Turn[] = []
  const open = new Map<Turn, ServerResponse>()
  const disconnected = new Set<Turn>()
  let retryAttempts = 0
  const richReply = [
    '## Streaming inventory',
    '| Directory | Status |\n| --- | --- |\n' +
      Array.from({ length: 40 }, (_, i) => `| workspace/src/module-${i} | verified |`).join('\n'),
    '```typescript\n' +
      Array.from({ length: 160 }, (_, i) => `export const path${i} = 'workspace/modules/${i}/index.ts'`).join('\n') +
      '\n```',
    'Expected result: $r=n/t$.'
  ].join('\n\n')
  const replies: Record<Turn, string> = {
    finish: richReply,
    queued: catalogueReport,
    pause:
      '## Build log\n\n```sh\n' +
      Array.from({ length: 120 }, (_, index) => `INFO verified workspace/modules/${index}`).join('\n') +
      '\n```',
    disconnect:
      '## Pending checks\n\n' +
      Array.from({ length: 24 }, (_, index) => `- [ ] Check dependency ${index} against the lockfile.`).join('\n'),
    retry:
      '## Recovery result\n\n```json\n' +
      JSON.stringify({ status: 'verified', packages: 24 }, null, 2) +
      '\n```\n\n```diff\n- status: pending\n+ status: verified\n```'
  }
  for (const [turn, prompt] of Object.entries(prompts) as [Turn, string][]) {
    mock.on(
      { endpoint: 'chat', model: modelId, userMessage: prompt },
      () => {
        if (turn === 'retry' && retryAttempts++ === 0)
          return { status: 503, error: { message: 'Fixture temporarily unavailable' } }
        const thinking =
          turn === 'queued' ? '<think>Compare the package inventory against the verification report.</think>' : ''
        return { content: `${thinking}${lastMarker(turn)}\n\n${replies[turn]}` }
      },
      { latency: 7, chunkSize: 120 }
    )
  }
  await mock.start()
  const relay = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (req.method === 'GET') {
      const assets: Record<string, [string, Buffer]> = {
        '/gallery.png': ['image/png', efficiencyImage],
        '/large.png': ['image/png', image],
        '/sample.mp4': ['video/mp4', video]
      }
      if (!Object.hasOwn(assets, pathname)) return void res.writeHead(404).end()
      const [contentType, body] = assets[pathname]
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length })
      res.end(body)
      return
    }
    const abort = new AbortController()
    res.once('close', () => abort.abort())
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const messages = JSON.parse(body.toString()).messages as Array<{ role: string; content: unknown }>
      const user = messages.findLast(({ role }) => role === 'user')
      const turn = (Object.entries(prompts) as [Turn, string][]).find(([, value]) =>
        JSON.stringify(user?.content ?? '').includes(value)
      )?.[0]
      if (!turn || pathname !== '/v1/chat/completions') throw new Error('Unexpected conversation mock request')
      requests.push(turn)
      open.set(turn, res)
      res.once('close', () => {
        if (!res.writableFinished) disconnected.add(turn)
        if (open.get(turn) === res) open.delete(turn)
      })
      if (turn === 'finish') await startFinishReply.waiting
      const upstream = await fetch(mock.url + pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: new Uint8Array(body),
        signal: abort.signal
      })
      if (turn === 'retry' && upstream.ok) await gates.retry.waiting
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' })
      const decoder = new TextDecoder()
      let pending = ''
      for await (const chunk of upstream.body!) {
        pending += decoder.decode(chunk, { stream: true })
        for (let end = pending.indexOf('\n\n'); end !== -1; end = pending.indexOf('\n\n')) {
          const event = pending.slice(0, end + 2)
          pending = pending.slice(end + 2)
          if (turn in gates && turn !== 'retry' && /"finish_reason"\s*:\s*"stop"|data: \[DONE\]/.test(event)) {
            await gates[turn].waiting
          }
          if (res.destroyed) return
          res.write(event)
        }
      }
      res.end(pending)
    } catch (error) {
      if (res.destroyed || abort.signal.aborted) return
      if (res.headersSent) res.destroy()
      else res.writeHead(500).end(String(error))
    }
  })
  relay.listen(0, '127.0.0.1')
  await once(relay, 'listening')
  const address = relay.address()
  if (!address || typeof address === 'string') throw new Error('Conversation mock did not bind')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    disconnected,
    startFinishReply: startFinishReply.release,
    finish: gates.finish.release,
    allowRetry: gates.retry.release,
    disconnect() {
      const response = open.get('disconnect')
      expect(response?.destroyed, 'The provider must still have a stream to interrupt').toBe(false)
      response!.destroy()
      gates.disconnect.release()
    },
    async close() {
      startFinishReply.release()
      for (const gate of Object.values(gates)) gate.release()
      relay.closeAllConnections()
      await new Promise<void>((resolve) => relay.close(() => resolve()))
      await mock.stop()
    }
  }
}

async function measureInteraction(page: Page, phase: string, action: () => Promise<void>) {
  await measure(page, `conversation-interaction/${phase}`, async () => {
    const start = performance.now()
    await action()
    process.stdout.write(
      `conversation-interaction ${JSON.stringify({ phase, interactionMs: performance.now() - start })}\n`
    )
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    )
  })
}

export default async function conversationInteraction(context: ScenarioContext) {
  const { page } = context
  const key = `perf-io-${randomUUID().slice(0, 8)}`
  const name = `${key}-topic`
  const temp = await mkdtemp(join(tmpdir(), 'cherry-conversation-io-'))
  const attachment = join(temp, 'fixture-inventory.txt')
  await writeFile(attachment, 'Fixture inventory\n'.repeat(400))
  const video = await readFile(
    new URL('../../../../scripts/e2e/regression/fixtures/media/sample-5s.mp4', import.meta.url)
  )
  const server = await startInteractionMock(video, png(6144, 4096))
  const api = async <T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    params?: object
  ): Promise<T> => {
    const result = await page.evaluate(
      ({ method, path, body, params }) =>
        window.api.dataApi.request({ id: crypto.randomUUID(), method, path, body, params }),
      { method, path, body, params }
    )
    expect(result.status, `${method} ${path}`).toBeLessThan(300)
    return result.data as T
  }
  const previous = await page.evaluate(async () => ({
    'app.language': await window.api.preference.get('app.language'),
    'topic.naming.enabled': await window.api.preference.get('topic.naming.enabled'),
    'chat.context_settings.compress.enabled': await window.api.preference.get('chat.context_settings.compress.enabled'),
    'chat.retry.enabled': await window.api.preference.get('chat.retry.enabled')
  }))
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'app.language': 'en-US',
        'topic.naming.enabled': false,
        'chat.context_settings.compress.enabled': false
      })
    )
    await api('POST', '/providers', {
      providerId: key,
      name: key,
      defaultChatEndpoint: endpoint,
      endpointConfigs: { [endpoint]: { baseUrl: server.origin + '/v1' } },
      apiKeys: [{ id: 'fixture', key: 'fixture', isEnabled: true }]
    })
    await api('PATCH', `/providers/${key}`, { isEnabled: true })
    await api('POST', '/models', [{ providerId: key, modelId, endpointTypes: [endpoint], contextWindow: 1_000_000 }])
    const assistant = await api<{ id: string }>('POST', '/assistants', { name: key, modelId: `${key}::${modelId}` })
    const topic = await api<{ id: string }>('POST', '/topics', { name, assistantId: assistant.id })
    const path = `/topics/${topic.id}/messages`
    const fixture = conversationParts(server.origin, attachment, randomUUID())
    const history = [...fixture.history, fixture.history[0]]
    for (let turn = 0; turn < 32; turn++) {
      const shape = history[turn % history.length]
      const userParts: CherryMessagePart[] = [{ type: 'text', text: `Fixture history turn ${turn}` }]
      if (turn === 24) userParts.push(fixture.clear)
      await api('POST', path, { role: 'user', status: 'success', data: { parts: userParts } })
      const parts = turn >= 24 ? [{ type: 'text', text: fixture.code }] : shape
      await api('POST', path, {
        role: 'assistant',
        status: parts.some(({ type }) => type === 'data-error') ? 'error' : 'success',
        data: {
          parts: [
            ...parts.map((part) =>
              'toolCallId' in part ? { ...part, toolCallId: `${part.toolCallId}-${turn}` } : part
            ),
            { type: 'text', text: `Catalogue reply ${turn}` }
          ]
        }
      })
    }

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const view = page.locator('[data-ui~="chat.view"]:visible').first()
    const group = view.getByText(key, { exact: true }).first()
    await expect
      .poll(async () => {
        if (await group.isVisible()) return true
        await view
          .getByRole('listbox')
          .first()
          .evaluate((el) => {
            el.scrollTop = el.scrollHeight
          })
        return false
      })
      .toBe(true)
    const row = view.locator(`#resource-list-option-${topic.id}`)
    if (!(await row.isVisible())) {
      await group.hover()
      await group.locator('..').getByRole('button', { name: 'Expand', exact: true }).click()
    }
    await row.click()
    const messages = view.locator('[data-ui~="chat.message"]')
    const viewport = view.locator('[data-message-virtual-list-scroller]').first()
    const composer = view.locator('[data-ui~="chat.composer"]').first()
    const editor = composer.locator('[contenteditable="true"]').first()
    const send = composer.getByRole('button', { name: 'Send', exact: true })
    const pause = composer.getByRole('button', { name: 'Pause', exact: true })
    const reply = (turn: Turn) => messages.getByText(lastMarker(turn), { exact: true }).last()
    const historyMessages = async () =>
      (await api<BranchMessagesResponse>('GET', path, undefined, { limit: 100 })).items.map((item) => item.message)
    const storedParts = new Set(
      (await historyMessages()).flatMap((message) => message.data.parts?.map((part) => part.type) ?? [])
    )
    const catalogueTypes = [...new Set([...fixture.history.flat(), fixture.clear].map((part) => part.type))].sort()
    expect([...storedParts]).toEqual(expect.arrayContaining(catalogueTypes))
    process.stdout.write(`conversation-interaction ${JSON.stringify({ historyTurns: 32, catalogueTypes })}\n`)
    const saved = async (assistantReply: ReturnType<typeof reply>, status: Message['status']) => {
      const id = await assistantReply.locator('xpath=ancestor::*[@data-message-id][1]').getAttribute('data-message-id')
      expect(id).toBeTruthy()
      await expect.poll(async () => (await api<Message>('GET', `/messages/${id}`)).status).toBe(status)
      return api<Message>('GET', `/messages/${id}`)
    }
    const submit = async (turn: Turn) => {
      await editor.fill(prompts[turn])
      await send.click()
    }
    const latest = messages.getByText('Catalogue reply 31', { exact: true })
    const returnToLatest = async () => {
      await view.getByTestId('message-scroll-to-bottom-button').click()
      await expect(latest).toBeInViewport()
    }
    await expect(latest).toBeInViewport()
    await viewport.hover({ position: { x: 20, y: 250 } })
    for (const [turn, text] of [
      [21, 'Original export status: interrupted'],
      [20, 'Previous conversation history could not be found'],
      [19, 'Conversation Compacted'],
      [18, '翻译示例：已核对所有目录。'],
      [17, 'fixture-inventory.txt'],
      [16, 'Workspace inventory']
    ] as const) {
      const sample = messages.filter({ hasText: new RegExp(`Catalogue reply ${turn}\\b`) }).first()
      for (let step = 0; step < 64 && !(await sample.isVisible()); step++) {
        await page.mouse.wheel(0, -600)
        await page.waitForTimeout(40)
      }
      await expect(sample.getByText(text, { exact: false }).first()).toBeVisible()
      if (turn === 18) {
        await expect(sample.getByRole('button', { name: /2 citations/ })).toBeVisible()
        await expect(sample.locator('svg').getByText('Parse catalogue', { exact: true })).toBeVisible()
        const artifact = sample.getByTestId('message-html-artifact')
        await expect(
          artifact.frameLocator('iframe').getByRole('heading', { name: 'Catalogue ready for review' })
        ).toBeVisible()
      }
      if (turn === 17) {
        const images = sample.locator('img')
        await expect
          .poll(() =>
            images.evaluateAll((nodes) => nodes.some((node) => (node as HTMLImageElement).naturalWidth >= 6144))
          )
          .toBe(true)
        await expect(sample.locator('video')).toBeAttached()
      }
      if (turn === 16) {
        const process = sample.getByTestId('completed-process-trigger')
        await expect(process).toContainText('9 tool calls')
        if ((await process.getAttribute('aria-expanded')) === 'false') await process.click()
        const toolGroup = sample.getByRole('button', { name: 'Extension failed', exact: true })
        if ((await toolGroup.getAttribute('aria-expanded')) === 'false') await toolGroup.click()
        const reasoning = sample.locator('[data-ui~="part:message-reasoning"]')
        const disclosure = reasoning.getByRole('button').first()
        if ((await disclosure.getAttribute('aria-expanded')) === 'false') await disclosure.click()
        await expect(
          reasoning.getByRole('paragraph').filter({ hasText: 'Fixture reasoning precedes the reply.' })
        ).toBeVisible()
        await expect(sample.getByText('Review index files', { exact: false }).first()).toBeVisible()
        const shell = sample.getByRole('button', { name: /find \.\/packages -maxdepth 2 -type f/ })
        if ((await shell.getAttribute('aria-expanded')) === 'false') await shell.click()
        await expect(sample.getByText(/packages\/module-0\/index\.ts/).first()).toBeVisible()
      }
    }
    await returnToLatest()
    await measureInteraction(page, 'catalogue-scroll', async () => {
      const start = await viewport.evaluate((el) => el.scrollTop)
      await viewport.hover({ position: { x: 20, y: 250 } })
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, -800)
        await page.waitForTimeout(35)
      }
      await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeLessThan(start)
      await expect(view.getByTestId('message-scroll-to-bottom-button')).toBeVisible()
    })
    await returnToLatest()

    await editor.fill(prompts.finish)
    const toolbar = composer.locator('[data-composer-toolbar]')
    const readyLayout = await Promise.all([composer.boundingBox(), toolbar.boundingBox(), send.boundingBox()])
    await measureInteraction(page, 'send-to-user-row', async () => {
      await send.click()
      await expect(messages.getByText(prompts.finish, { exact: true }).last()).toBeInViewport()
    })
    server.startFinishReply()
    await expect(reply('finish')).toBeVisible()
    await expect(pause).toBeVisible()
    await expect
      .poll(() => Promise.all([composer.boundingBox(), toolbar.boundingBox(), pause.boundingBox()]))
      .toEqual(readyLayout)
    await measureInteraction(page, 'type-during-output', async () => {
      await editor.pressSequentially(queuedDraft, { delay: 8 })
      const session = await page.context().newCDPSession(page)
      try {
        await session.send('Input.imeSetComposition', { text: 'jixugenjin', selectionStart: 10, selectionEnd: 10 })
        expect(server.requests).toEqual(['finish'])
        await session.send('Input.insertText', { text: '继续跟进' })
      } finally {
        await session.detach()
      }
      await expect(editor).toHaveText(prompts.queued)
    })
    await measureInteraction(page, 'queue-during-output', async () => {
      await send.click()
      await expect(view.getByRole('button', { name: 'Queued (1)', exact: true })).toBeVisible()
    })
    await context.screenshot('conversation-interaction-queue')
    expect(server.requests).toEqual(['finish'])
    await measureInteraction(page, 'finish-to-persisted', async () => {
      server.finish()
      await saved(reply('finish'), 'success')
    })
    await expect(reply('queued')).toBeVisible()
    const queued = await saved(reply('queued'), 'success')
    expect(
      queued.data.parts?.some((part) => part.type === 'reasoning' && part.text.includes('verification report'))
    ).toBe(true)
    const queuedReply = messages.filter({ hasText: lastMarker('queued') })
    await expect(queuedReply.getByTestId('message-html-artifact')).toBeVisible()
    await expect(queuedReply.locator('svg').getByText('Publish summary', { exact: true })).toBeVisible()
    await context.screenshot('conversation-interaction-rich-blocks')
    expect(
      (await historyMessages()).filter(
        (message) =>
          message.role === 'user' &&
          message.data.parts?.some((part) => part.type === 'text' && part.text === prompts.queued)
      )
    ).toHaveLength(1)

    await editor.fill(prompts.pause)
    const beforePause = await send.boundingBox()
    await send.click()
    await expect(reply('pause')).toBeVisible()
    await measureInteraction(page, 'pause-to-ready', async () => {
      await pause.click()
      await expect(pause).toBeHidden()
      await expect.poll(() => send.boundingBox()).toEqual(beforePause)
      const partial = await saved(reply('pause'), 'paused')
      expect(partial.data.parts?.some((part) => part.type === 'text' && part.text.includes(lastMarker('pause')))).toBe(
        true
      )
    })
    await expect.poll(() => server.disconnected.has('pause')).toBe(true)

    await submit('disconnect')
    await expect(reply('disconnect')).toBeVisible()
    const unsent = 'Unsent text must survive a provider disconnect.'
    await editor.pressSequentially(unsent)
    await expect(editor).toHaveText(unsent)
    process.stdout.write(
      `conversation-interaction ${JSON.stringify({ pauseVisibleWithDraft: await pause.isVisible() })}\n`
    )
    await measureInteraction(page, 'disconnect-to-ready', async () => {
      server.disconnect()
      const partial = await saved(reply('disconnect'), 'error')
      expect(
        partial.data.parts?.some((part) => part.type === 'text' && part.text.includes(lastMarker('disconnect')))
      ).toBe(true)
      await expect(editor).toHaveText(unsent)
    })

    await page.evaluate(() => window.api.preference.set('chat.retry.enabled', true))
    await submit('retry')
    await expect(messages.getByText(/Retrying with .*attempt 2/).first()).toBeVisible({ timeout: 15000 })
    await measureInteraction(page, 'retry-to-persisted', async () => {
      server.allowRetry()
      await expect(reply('retry')).toBeVisible()
      const recovered = await saved(reply('retry'), 'success')
      expect(recovered.data.parts?.some((part) => part.type === 'data-retry')).toBe(false)
    })
    expect(server.requests).toEqual(['finish', 'queued', 'pause', 'disconnect', 'retry', 'retry'])
    await context.runSteps([
      {
        verb: 'expectVisible',
        selector: `[data-ui~="chat.view"]:visible [data-ui~="chat.message"] :text-is("${lastMarker('retry')}")`
      }
    ])
    await context.screenshot('conversation-interaction')
  } finally {
    await server.close()
    await rm(temp, { recursive: true, force: true })
    await page.evaluate((preferences) => window.api.preference.setMultiple(preferences), previous)
  }
}
