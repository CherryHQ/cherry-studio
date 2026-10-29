// #22577: Gemini names each `functionCall`/`functionResponse` after the part, so a stored tool part
// whose name is missing or disagrees with its twin makes the provider 400 the whole turn. These
// assert the bytes `@ai-sdk/google` would put in `contents`, not just our intermediate shape.
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, tool, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { repairToolNames, sanitizeDynamicToolNames, toModelMessages } from '../messageRules'

const ui = (role: UIMessage['role'], parts: UIMessage['parts'], id = 'm'): UIMessage => ({ id, role, parts })

type WirePart = {
  text?: string
  functionCall?: { id?: string; name?: string; args?: unknown }
  functionResponse?: { id?: string; name?: string; response?: { name?: string; content?: unknown } }
}
type WireBody = { contents: Array<{ role: string; parts: WirePart[] }> }

function toolPart(toolCallId: string, name: string | undefined, label = toolCallId): UIMessage['parts'][number] {
  const part = {
    type: 'dynamic-tool',
    ...(name === undefined ? {} : { toolName: name }),
    toolCallId,
    state: 'output-available',
    input: { query: label },
    output: { answer: label }
  }
  return part as unknown as UIMessage['parts'][number]
}

async function wire(parts: UIMessage['parts']): Promise<WireBody> {
  let body: WireBody = { contents: [] }
  const model = createGoogleGenerativeAI({
    apiKey: 'test-key',
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }], usageMetadata: {} }),
        { headers: { 'content-type': 'application/json' } }
      )
    }
  })('gemini-2.5-flash')
  // `generateText` validates `ModelMessage[]` and serializes it, so this covers the whole replay path.
  await generateText({
    model,
    messages: await toModelMessages([
      ui('user', [{ type: 'text', text: 'before' }], 'u1'),
      ui('assistant', parts, 'a1'),
      ui('user', [{ type: 'text', text: 'after' }], 'u2')
    ]),
    maxRetries: 0
  })
  return body
}

/** Every emitted call must carry a name, and its response must repeat that exact name. */
function expectConsistentPairs(body: WireBody) {
  const calls = body.contents.flatMap((entry) => entry.parts.flatMap((part) => part.functionCall ?? []))
  const responses = body.contents.flatMap((entry) => entry.parts.flatMap((part) => part.functionResponse ?? []))
  expect(calls.length).toBeGreaterThan(0)
  for (const call of calls) {
    expect(typeof call.name).toBe('string')
    expect(call.name).not.toBe('')
  }
  for (const response of responses) {
    expect(response.name).toBe(response.response?.name)
    expect(calls.map((call) => call.name)).toContain(response.name)
  }
  return { calls, responses }
}

describe('#22577 Gemini tool-call history keeps call and result names consistent', () => {
  it('replays a completed history with N tool calls as N consistent pairs', async () => {
    const { calls, responses } = expectConsistentPairs(
      await wire([
        toolPart('c1', 'kb_search', 'one'),
        toolPart('c2', 'kb_list', 'two'),
        toolPart('c3', 'kb_search', 'three')
      ])
    )
    expect(calls.map((call) => call.name)).toEqual(['kb_search', 'kb_list', 'kb_search'])
    expect(responses.map((response) => response.name)).toEqual(['kb_search', 'kb_list', 'kb_search'])
  })

  it('repairs a stored part whose name is missing with one placeholder shared by both halves', async () => {
    const { calls, responses } = expectConsistentPairs(await wire([toolPart('c1', undefined)]))
    expect(calls.map((call) => call.name)).toEqual(['unknown_tool'])
    expect(responses.map((response) => response.name)).toEqual(['unknown_tool'])
  })

  it('pairs a part whose name only survives in cherry metadata, matching the reported mismatch', async () => {
    const part = {
      ...toolPart('c1', undefined, 'kb_search'),
      callProviderMetadata: { cherry: { toolName: 'kb_search' } }
    } as UIMessage['parts'][number]
    const { calls, responses } = expectConsistentPairs(await wire([part]))
    expect(calls.map((call) => call.name)).toEqual(['kb_search'])
    expect(responses.map((response) => response.name)).toEqual(['kb_search'])
  })

  it('recovers an empty-string toolName from cherry metadata before the sanitizer can shadow it', async () => {
    const part = {
      ...toolPart('c1', undefined, 'kb_search'),
      toolName: '',
      callProviderMetadata: { cherry: { toolName: 'kb_search' } }
    } as UIMessage['parts'][number]
    const { calls, responses } = expectConsistentPairs(await wire([part]))
    expect(calls.map((call) => call.name)).toEqual(['kb_search'])
    expect(responses.map((response) => response.name)).toEqual(['kb_search'])
  })

  it('runs the declared tool formatter for an empty-named part recovered from cherry metadata', async () => {
    const rawImageJson = JSON.stringify({ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' })
    const part = {
      ...toolPart('c1', undefined),
      toolName: '',
      output: rawImageJson,
      callProviderMetadata: { cherry: { toolName: 'mcp_image' } }
    } as UIMessage['parts'][number]
    const mcp_image = tool({
      inputSchema: undefined as never,
      toModelOutput: ({ output }: { output: unknown }) => [{ type: 'text', text: `formatted:${output}` }] as never
    })

    const model = await toModelMessages([ui('assistant', [part])], undefined, { mcp_image })

    const serialized = JSON.stringify(model)
    // The recovered declared name pairs call and result AND routes the output through the
    // tool's `toModelOutput`; a sanitizer-shadowed name would leave the raw JSON unformatted.
    expect(serialized).toContain('"toolName":"mcp_image"')
    expect(serialized).toContain('formatted:')
    expect(serialized).not.toContain('__da39a3ee')
  })

  it('does not reuse a call-side name for a result whose own name is missing', async () => {
    const callSideNamed = {
      ...toolPart('c1', undefined, 'kb_search'),
      callProviderMetadata: { cherry: { toolName: 'kb_search' } }
    } as UIMessage['parts'][number]
    const bareResult = toolPart('c2', undefined, 'kb_list')
    const { calls, responses } = expectConsistentPairs(await wire([callSideNamed, bareResult]))
    expect(calls.map((call) => call.name)).toEqual(['kb_search', 'unknown_tool'])
    expect(responses.map((response) => response.name)).toEqual(['kb_search', 'unknown_tool'])
  })

  it('keeps a bare placeholder separate per unnamed call so parallel calls stay distinguishable', async () => {
    const { calls, responses } = expectConsistentPairs(
      await wire([toolPart('c1', undefined, 'one'), toolPart('c2', undefined, 'two')])
    )
    expect(calls.map((call) => call.args)).toEqual([{ query: 'one' }, { query: 'two' }])
    expect(responses.map((response) => response.response?.content)).toEqual([{ answer: 'one' }, { answer: 'two' }])
  })
})

describe('repairToolNames', () => {
  it('leaves an already-legal, declared history untouched', () => {
    const messages = [ui('assistant', [toolPart('c1', 'kb_search')])]
    expect(repairToolNames(messages)).toBe(messages)
    expect(repairToolNames(messages, { kb_search: tool({ inputSchema: undefined as never }) })).toBe(messages)
  })

  it('is idempotent with the sanitizer and renames an undeclared dynamic name the same way', () => {
    const messages = [ui('assistant', [toolPart('c1', 'mcp: kb_search')])]
    const repaired = repairToolNames(messages)
    expect(repaired).toBeInstanceOf(Array)
    expect(repaired[0]).toMatchObject({
      parts: [{ toolName: expect.stringMatching(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/) }]
    })
    expect(repairToolNames(repaired)).toBe(repaired)
    expect(sanitizeDynamicToolNames(repaired)[0]).toBe(repaired[0])
  })

  it('keeps a declared tool name with provider-specific characters', () => {
    const declared = 'maps.lookup'
    const messages = [ui('assistant', [toolPart('c1', declared)])]
    expect(repairToolNames(messages, { [declared]: tool({ inputSchema: undefined as never }) })).toBe(messages)
  })

  it('leaves non-tool parts alone and never mutates the stored history', () => {
    const user = ui('user', [{ type: 'text', text: 'hello' }])
    const messages = [user, ui('assistant', [toolPart('c1', undefined)])]
    const repaired = repairToolNames(messages)
    expect(repaired[0]).toBe(user)
    expect(messages[1]).toMatchObject({ parts: [{ toolCallId: 'c1', state: 'output-available' }] })
    expect(messages[1].parts[0]).not.toHaveProperty('toolName')
  })

  it('leaves a static tool part to its type, which is its own name', () => {
    const legacy = {
      type: 'tool-kb_search',
      toolCallId: 'c1',
      state: 'output-available',
      input: { query: 'x' },
      output: { ok: true }
    } as UIMessage['parts'][number]
    const messages = [ui('assistant', [legacy])]
    expect(repairToolNames(messages)).toBe(messages)
  })

  it('repairs only the broken entries of a mixed history', () => {
    const good = toolPart('c1', 'kb_search')
    const broken = toolPart('c2', undefined)
    const repaired = repairToolNames([ui('assistant', [good, broken])])
    expect(repaired[0].parts[0]).toBe(good)
    expect(repaired[0].parts[1]).toMatchObject({ toolName: 'unknown_tool' })
  })

  it('keeps the part toolName over a divergent cherry copy and stays consistent', () => {
    const part = {
      ...toolPart('c1', 'kb_search'),
      callProviderMetadata: { cherry: { toolName: 'kb_list' } }
    } as UIMessage['parts'][number]
    const repaired = repairToolNames([ui('assistant', [part])])
    expect(repaired[0].parts[0]).toMatchObject({ toolName: 'kb_search' })
  })

  it('treats an empty-string toolName as missing and uses the placeholder', () => {
    const part = { ...toolPart('c1', undefined), toolName: '' } as UIMessage['parts'][number]
    const repaired = repairToolNames([ui('assistant', [part])])
    expect(repaired[0].parts[0]).toMatchObject({ toolName: 'unknown_tool' })
  })
})
