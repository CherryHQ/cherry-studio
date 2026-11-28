import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { crc32, deflateSync } from 'node:zlib'

import { LLMock, MCPMock } from '@copilotkit/aimock'
import { expect, type Locator, type Page } from '@playwright/test'

import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'
import type { Message } from '../../../../src/shared/data/types/message'
import { selectSidebarApp } from '../../regression/navigation'

const modelId = 'gpt-4o-mini'
const endpoint = 'openai-chat-completions'
const marker = /^PERF-TURN-(\d+)\b/
const cases = [
  { name: 'chat-mcp', work: false, rounds: 20, bash: 0, read: 0, mcp: [6, 6, 6], large: false },
  { name: 'work-mcp', work: true, rounds: 20, bash: 0, read: 0, mcp: [6, 6, 6], large: false },
  { name: 'work-mixed', work: true, rounds: 12, bash: 8, read: 3, mcp: [2], large: false },
  { name: 'work-large-images', work: true, rounds: 4, bash: 0, read: 3, mcp: [], large: true }
] as const
const stressCase = {
  name: 'work-rich-stress',
  work: true,
  rounds: 120,
  bash: 8,
  read: 0,
  mcp: [16],
  large: false
} as const
type Scenario = (typeof cases)[number] | typeof stressCase

function richReply(turn: number): string {
  const block = (language: string, code: string) => ['```' + language, code, '```'].join('\n')
  const tree = Array.from({ length: 24 }, (_, index) =>
    ['├── package-' + index + '/', '│   ├── index.ts', '│   └── config.json'].join('\n')
  ).join('\n')
  const code = Array.from(
    { length: 75 },
    (_, index) => 'export const route' + index + ' = { path: "/fixtures/' + turn + '/' + index + '", enabled: true }'
  ).join('\n')
  return [
    '## Workspace scan ' + turn,
    '> Synthetic inventory with [reference](https://example.invalid/docs).',
    '- [x] Read directory\n- [ ] Inspect results',
    block('text', 'workspace/\n' + tree),
    '### TypeScript\n' + block('ts', code),
    block('diff', '- const active = false\n+ const active = true'),
    '| Check | Result |\n| --- | --- |\n' +
      Array.from({ length: 25 }, (_, index) => '| package-' + index + ' | Ready |').join('\n'),
    block(
      'json',
      JSON.stringify(
        { packages: Array.from({ length: 20 }, (_, id) => ({ id, files: ['index.ts', 'config.json'] })) },
        null,
        2
      )
    ),
    block('sh', 'find ./packages -maxdepth 2 -type f'),
    'Expected rate is $r = n / t$.'
  ].join('\n\n')
}

export function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const result = Buffer.alloc(data.length + 12)
    result.writeUInt32BE(data.length)
    result.write(type, 4)
    data.copy(result, 8)
    result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  const pixels = randomBytes((width + 1) * height)
  for (let row = 0; row < height; row++) pixels[row * (width + 1)] = 0
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 0 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function startRelay(mock: LLMock, requests: Array<{ bytes: number; images: number; userCharacters: number }>) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404).end()
        return
      }
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const data of req) {
        const chunk = Buffer.from(data)
        bytes += chunk.length
        if (bytes > 72 * 1024 * 1024) throw new Error('Fixture request exceeded 72 MiB')
        chunks.push(chunk)
      }
      const body = Buffer.concat(chunks)
      const parsed = JSON.parse(body.toString()) as {
        messages: Array<{
          role: string
          content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
        }>
      }
      let images = 0
      let userCharacters = 0
      for (const { role, content } of parsed.messages) {
        const text = typeof content === 'string' ? content : content?.map((part) => part.text ?? '').join('')
        if (role === 'user' && marker.test(text ?? '')) userCharacters += text.length
        if (!Array.isArray(content)) continue
        for (const part of content) {
          if (!part.image_url?.url.startsWith('data:image/')) continue
          images++
          // Preserve measurement of the complete request while respecting AIMock's body limit.
          if (bytes > 9 * 1024 * 1024) part.image_url.url = 'http://127.0.0.1/fixture-image'
        }
      }
      requests.push({ bytes, images, userCharacters })
      const upstream = await fetch(mock.url + req.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bytes > 9 * 1024 * 1024 ? JSON.stringify(parsed) : new Uint8Array(body)
      })
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' })
      if (upstream.body)
        await pipeline(async function* () {
          const reader = upstream.body!.getReader()
          try {
            for (;;) {
              const item = await reader.read()
              if (item.done) break
              yield item.value
            }
          } finally {
            await reader.cancel()
            reader.releaseLock()
          }
        }, res)
      else res.end()
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end(String(error))
      else res.destroy()
    }
  })
  return server
}

export async function measure<T>(page: Page, name: string, action: () => Promise<T>): Promise<T> {
  await page.evaluate(() => {
    const intervals: number[] = []
    let previous: number | undefined
    let frame: number
    const sampler = {
      sample(now: number) {
        if (previous !== undefined) intervals.push(now - previous)
        previous = now
        frame = requestAnimationFrame(sampler.sample)
      }
    }
    frame = requestAnimationFrame(sampler.sample)
    Object.assign(window, {
      stopPerfSample() {
        cancelAnimationFrame(frame)
        return intervals.sort((left, right) => left - right)
      }
    })
  })
  try {
    return await action()
  } finally {
    const intervals = await page.evaluate(() => {
      const target = window as Window & { stopPerfSample?: () => number[] }
      const result = target.stopPerfSample?.() ?? []
      delete target.stopPerfSample
      return result
    })
    expect(intervals.length, name).toBeGreaterThan(0)
    process.stdout.write(
      `conversation-performance ${JSON.stringify({
        name,
        frames: intervals.length,
        p95Ms: intervals[Math.ceil(intervals.length * 0.95) - 1],
        p99Ms: intervals[Math.ceil(intervals.length * 0.99) - 1],
        maxMs: intervals.at(-1),
        over50Ms: intervals.filter((value) => value > 50).length
      })}\n`
    )
  }
}

async function scroll(page: Page, viewport: Locator, direction: number, events: number) {
  const start = await viewport.evaluate((element) => element.scrollTop)
  await viewport.hover()
  for (let index = 0; index < events; index++) {
    await page.mouse.wheel(0, direction * 440)
    await page.waitForTimeout(35)
  }
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).not.toBe(start)
}

async function runScenario(context: ScenarioContext, scenario: Scenario) {
  const { page } = context
  const prefix = `perf-${scenario.name}-${randomUUID().slice(0, 8)}`
  const mock = new LLMock({ host: '127.0.0.1', port: 0, strict: true, journalMaxEntries: 8 })
  const mcp = new MCPMock()
  const requests: Array<{ bytes: number; images: number; userCharacters: number }> = []
  const relay = startRelay(mock, requests)
  const folder = await mkdtemp(join(tmpdir(), 'cherry-conversation-performance-'))
  const images: string[] = []
  const mcpCalls: Array<{ turn: number; bytes: number }> = []
  const stress = scenario.name === 'work-rich-stress'
  const mixed = scenario.name === 'work-mixed'
  const burst = (turn: number) => turn === 30 || turn === 60 || turn === 90 || turn === scenario.rounds
  const shellCount = (turn: number) => (turn ? (stress ? (burst(turn) ? 8 : 1) : scenario.bash) : 0)
  const mcpCount = (turn: number) =>
    turn ? (stress ? (burst(turn) ? 40 : 1) : scenario.mcp.reduce<number>((sum, value) => sum + value, 0)) : 0
  const api = async <T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> => {
    const result = await page.evaluate(
      ({ method, path, body }) => window.api.dataApi.request({ id: crypto.randomUUID(), method, path, body }),
      { method, path, body }
    )
    expect(result.status, `${method} ${path}`).toBeLessThan(300)
    return result.data as T
  }
  try {
    if (stress) {
      for (let index = 0; index < 48; index++) {
        await writeFile(join(folder, `module-${index}.json`), JSON.stringify({ index, enabled: true }))
      }
    }
    for (let index = 0; index < scenario.rounds * scenario.read; index++) {
      const path = join(folder, `fixture-${index}.png`)
      await writeFile(path, scenario.large ? png(6144, 4096) : png(320, 240))
      images.push(path)
    }
    mcp.addTool({
      name: 'fixture_search',
      description: 'Synthetic benchmark fixture',
      inputSchema: {
        type: 'object',
        properties: { turn: { type: 'number' }, seq: { type: 'number' } },
        required: ['turn', 'seq']
      }
    })
    mcp.onToolCall('fixture_search', (input) => {
      const { turn, seq } = input as { turn: number; seq: number }
      const bytes =
        stress && burst(turn) && seq % 8 === 0 ? 512 * 1024 : mixed ? (turn === 4 && seq === 2 ? 512 : 96) * 1024 : 2048
      mcpCalls.push({ turn, bytes })
      return `PERF-MCP-${turn}-${seq}\n`.padEnd(bytes, ' Synthetic fixture record.\n')
    })
    mock.mount('/mcp', mcp)
    const reply = Array.from(
      { length: 10 },
      (_, index) =>
        `### Section ${index}\n\n| Metric | Value |\n| --- | --- |\n| Records | 42 |\n\n\`\`\`json\n{"sample":true}\n\`\`\``
    ).join('\n\n')
    const userText = (content: unknown): string =>
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((item) => item.text ?? '').join('')
          : ''
    mock.on(
      {
        endpoint: 'chat',
        model: modelId,
        predicate: (req) => req.messages.some((msg) => msg.role === 'user' && marker.test(userText(msg.content)))
      },
      (req) => {
        const index = req.messages.findLastIndex((msg) => msg.role === 'user' && marker.test(userText(msg.content)))
        const turn = Number(marker.exec(userText(req.messages[index].content))?.[1])
        const ids = req.messages.slice(index + 1).flatMap((msg) => (msg.role === 'tool' ? [msg.tool_call_id] : []))
        const count = (tag: string) => ids.filter((id) => id?.includes(`_${tag}_`)).length
        const names = req.tools?.map((tool) => tool.function?.name) ?? []
        const batch = (tag: string, name: string, size: number, args: (seq: number) => object) => {
          expect(names).toContain(name)
          return {
            toolCalls: Array.from({ length: size }, (_, i) => ({
              name,
              id: `call_${tag}_${turn}_${i + 1 + count(tag)}`,
              arguments: JSON.stringify(args(i + 1 + count(tag)))
            }))
          }
        }
        if (shellCount(turn) > count('bash')) {
          return batch('bash', 'bash', shellCount(turn), (seq) => ({
            command:
              stress && seq === 1
                ? `/usr/bin/find '${folder.replaceAll("'", "'\\''")}' -maxdepth 1 -type f | /usr/bin/sort`
                : `/usr/bin/awk 'BEGIN { for (i=1;i<=${seq % 2 ? 120 : 1600};i++) printf("PERF-BASH-${turn}-${seq} row=%05d synthetic output for the conversation performance fixture\\n", i) }'`,
            timeout: 20
          }))
        }
        if (turn && scenario.read > count('read')) {
          return batch('read', 'read', scenario.read, (seq) => ({ path: images[(turn - 1) * scenario.read + seq - 1] }))
        }
        const perTurnMcp = mcpCount(turn)
        if (turn && count('mcp') < perTurnMcp) {
          const name = names.find((tool) => tool?.replaceAll('_', '').toLowerCase().includes('fixturesearch'))
          if (!name && scenario.work && !count('discover'))
            return batch('discover', 'tool_search', 1, () => ({ query: 'fixture', limit: 20 }))
          if (!name) throw new Error('Fixture MCP tool was not discovered')
          return batch(
            'mcp',
            name,
            stress ? Math.min(24, perTurnMcp - count('mcp')) : perTurnMcp === 18 ? 6 : 2,
            (seq) => ({ turn, seq })
          )
        }
        return { content: `${turn ? (stress ? richReply(turn) : reply) : 'Warm-up complete'}\n\nDONE-PERF-${turn}` }
      },
      stress ? { latency: 1, chunkSize: 256 } : { latency: 8, chunkSize: 24 }
    )
    await mock.start()
    await new Promise<void>((resolve, reject) => {
      relay.once('error', reject)
      relay.listen(0, '127.0.0.1', resolve)
    })
    const address = relay.address()
    if (!address || typeof address === 'string') throw new Error('Fixture relay did not bind')
    await api('POST', '/providers', {
      providerId: prefix,
      name: prefix,
      defaultChatEndpoint: endpoint,
      endpointConfigs: { [endpoint]: { baseUrl: `http://127.0.0.1:${address.port}/v1` } },
      apiKeys: [{ id: 'fixture', key: 'fixture', isEnabled: true }]
    })
    await api('PATCH', `/providers/${prefix}`, { isEnabled: true })
    await api('POST', '/models', [
      {
        providerId: prefix,
        modelId,
        endpointTypes: [endpoint],
        capabilities: ['function-call', 'image-recognition'],
        inputModalities: ['text', 'image'],
        contextWindow: 1000000,
        maxInputTokens: 990000,
        maxOutputTokens: 10000
      }
    ])
    const server = await api<{ id: string }>('POST', '/mcp-servers', {
      name: prefix,
      type: 'streamableHttp',
      baseUrl: mock.url + '/mcp',
      isActive: true,
      isTrusted: true,
      disabledAutoApproveTools: []
    })
    const model = `${prefix}::${modelId}` as const
    const name = `${prefix}-active`
    let createConversation: (name: string) => Promise<{ id: string }>
    if (scenario.work) {
      const result = (await page.evaluate(
        ({ prefix, model, id }) =>
          window.api.ipcApi.request('ai.agent.create', {
            name: prefix,
            model,
            type: 'pi-durable',
            mcps: [id],
            instructions: 'Run only the local synthetic fixture tools specified by the mock.',
            configuration: { bootstrap_completed: true, permission_mode: 'bypassPermissions' }
          }),
        { prefix, model, id: server.id }
      )) as { ok: boolean; data?: unknown }
      if (!result.ok) throw new Error(JSON.stringify(result))
      const agentId = (result.data as { id: string }).id
      createConversation = (name) => api('POST', '/agent-sessions', { agentId, name, workspace: { type: 'system' } })
    } else {
      const assistant = await api<{ id: string }>('POST', '/assistants', {
        name: prefix,
        modelId: model,
        mcpServerIds: [server.id]
      })
      createConversation = (name) => api('POST', '/topics', { assistantId: assistant.id, name })
    }
    if (scenario.mcp.length === 3) {
      for (let index = 0; index < 120; index++) await createConversation(`${prefix}-history-${index}`)
    }
    const conversation = await createConversation(name)
    await page.reload()
    await selectSidebarApp(page, scenario.work ? 'Work' : 'Chat')
    const viewSelector = scenario.work ? '[data-ui~="agent.view"]:visible' : '[data-ui~="chat.view"]:visible'
    const view = page.locator(viewSelector).first()
    const group = view.getByText(prefix, { exact: true }).first()
    const row = view.getByText(name, { exact: true }).first()
    if (!scenario.work && !(await group.isVisible())) {
      await view
        .getByRole('listbox')
        .first()
        .evaluate((list) => {
          list.scrollTop = list.scrollHeight
        })
    }
    await expect(group).toBeVisible()
    if (scenario.work && !(await row.isVisible())) await group.click()
    if (!(await row.isVisible())) {
      await group.hover()
      await group.locator('..').getByRole('button', { name: 'Expand', exact: true }).click()
    }
    await row.click()
    const input = view.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    const viewport = view.locator('[data-message-virtual-list-scroller]').first()
    const sidebar = view.locator('[data-conversation-perf-sidebar]')
    if (scenario.mcp.length === 3) {
      await row.evaluate((item) => {
        for (let element = item.parentElement; element; element = element.parentElement) {
          if (/auto|scroll/.test(getComputedStyle(element).overflowY)) {
            element.dataset.conversationPerfSidebar = 'true'
            return
          }
        }
        throw new Error('Conversation sidebar scroller was not found')
      })
      const more = sidebar.getByRole('button', { name: /^(Show more conversations|Show more)$/ }).last()
      for (let index = 0; index < 24 && (await more.isVisible()); index++) await more.click()
      await expect
        .poll(() => sidebar.evaluate((element) => element.scrollHeight - element.clientHeight))
        .toBeGreaterThan(0)
    }
    await measure(page, `${scenario.name}/idle`, () => page.waitForTimeout(1500))
    for (let turn = 0; turn <= scenario.rounds; turn++) {
      const prose =
        mixed && turn
          ? Array.from(
              { length: 200 },
              (_, index) =>
                `Batch ${turn * 200 + index} recorded warehouse positions, inventory quantities, dispatch notes, quality grading, manifest identifiers and shelf weights. Each record has synthetic review notes and additional details about the scheduled delivery.`
            ).join('\n\n')
          : ''
      await input.fill(`PERF-TURN-${turn} Run the synthetic benchmark.\n\n${prose}`)
      const answer = view.locator('[data-ui~="chat.message"]').getByText(`DONE-PERF-${turn}`, { exact: true }).last()
      await measure(page, `${scenario.name}/turn-${turn}`, async () => {
        await view.getByRole('button', { name: 'Send', exact: true }).first().click()
        if (turn === scenario.rounds || (stress && burst(turn))) {
          await scroll(page, viewport, -1, 18)
          await viewport.evaluate((element) => {
            element.scrollTop = element.scrollHeight
          })
        }
        await expect(answer).toBeVisible({ timeout: 90000 })
      })
      const messageId = await answer.locator('xpath=ancestor::*[@data-message-id][1]').getAttribute('data-message-id')
      expect(messageId).toBeTruthy()
      const path = scenario.work ? `/agent-sessions/${conversation.id}/messages/${messageId}` : `/messages/${messageId}`
      await expect.poll(async () => (await api<Message>('GET', path)).status).toBe('success')
      const message = await api<Message>('GET', path)
      const toolIds = (message.data.parts ?? []).flatMap((part) =>
        'toolCallId' in part && part.state === 'output-available' ? [part.toolCallId] : []
      )
      expect(toolIds.filter((id) => id.includes('_bash_'))).toHaveLength(shellCount(turn))
      expect(toolIds.filter((id) => id.includes('_read_'))).toHaveLength(turn ? scenario.read : 0)
      const expected = mcpCount(turn)
      expect(toolIds.filter((id) => id.includes('_mcp_'))).toHaveLength(expected)
      expect(mcpCalls.filter((call) => call.turn === turn)).toHaveLength(expected)
      if (turn === 1 || turn === scenario.rounds || (stress && burst(turn))) {
        for (let sample = 0; sample < 3; sample++) {
          await viewport.evaluate((element) => {
            element.scrollTop = element.scrollHeight
          })
          await measure(page, `${scenario.name}/history-${turn}-${sample}`, async () => {
            await scroll(page, viewport, -1, 24)
            await scroll(page, viewport, 1, 24)
          })
          if (scenario.mcp.length === 3) {
            await sidebar.evaluate((element) => {
              element.scrollTop = 0
            })
            await measure(page, `${scenario.name}/sidebar-${turn}-${sample}`, async () => {
              await scroll(page, sidebar, 1, 18)
              await scroll(page, sidebar, -1, 18)
            })
          }
        }
        await viewport.evaluate((element) => {
          element.scrollTop = element.scrollHeight
        })
      }
    }
    if (stress) {
      const modelPath = `/agent-sessions/${conversation.id}/messages`
      const latest = await api<{ items: Message[]; nextCursor?: string }>('GET', modelPath)
      expect(latest.nextCursor).toBeTruthy()
      await measure(page, 'work-rich-stress/load-oldest', async () => {
        const oldest = view
          .locator('[data-message-id]')
          .filter({ hasText: 'PERF-TURN-0 Run the synthetic benchmark.' })
          .first()
        await viewport.hover({ position: { x: 20, y: 100 } })
        for (let attempt = 0; attempt < 24 && !(await oldest.isVisible()); attempt++) {
          const height = await viewport.evaluate((element) => element.scrollHeight)
          await page.mouse.wheel(0, -height)
          await page.waitForTimeout(220)
        }
        await expect(oldest).toBeInViewport()
      })
      await view.getByTestId('message-scroll-to-bottom-button').click()
      await expect(
        view.locator('[data-ui~="chat.message"]').getByText(`DONE-PERF-${scenario.rounds}`, { exact: true }).last()
      ).toBeInViewport()
    }
    if (scenario.read) expect(requests.at(-1)?.images).toBe(scenario.rounds * scenario.read)
    if (scenario.large) expect(requests.at(-1)?.bytes).toBeGreaterThan(10 * 1024 * 1024)
    if (mixed) {
      expect(requests.at(-1)?.userCharacters).toBeGreaterThan(500000)
      expect(Math.max(...mcpCalls.map((call) => call.bytes))).toBe(512 * 1024)
    }
    process.stdout.write(
      `conversation-performance ${JSON.stringify({
        name: scenario.name,
        turns: scenario.rounds,
        request: requests.at(-1)
      })}\n`
    )
    await context.runSteps([
      {
        verb: 'expectVisible',
        selector: `${viewSelector} [data-ui~="chat.message"] :text-is("DONE-PERF-${scenario.rounds}")`
      }
    ])
    await context.screenshot(scenario.name)
  } finally {
    relay.closeAllConnections()
    await new Promise<void>((resolve) => relay.close(() => resolve()))
    await mock.stop()
    await rm(folder, { recursive: true, force: true })
  }
}

export default async function conversationPerformance(context: ScenarioContext) {
  await runCases(context, cases)
}

export async function conversationStress(context: ScenarioContext) {
  await runCases(context, [stressCase])
}

async function runCases(context: ScenarioContext, selected: readonly Scenario[]) {
  expect(process.platform, 'This workload uses macOS Bash and image processing').toBe('darwin')
  const { page } = context
  await page.evaluate(() =>
    window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.onboarding.provider_setup.status': 'skipped',
      'topic.naming.enabled': false,
      'agent.input.suggestions.enabled': false,
      'chat.context_settings.compress.enabled': false
    })
  )
  try {
    for (const scenario of selected) await runScenario(context, scenario)
  } finally {
    await context.ensureChinese()
  }
}
