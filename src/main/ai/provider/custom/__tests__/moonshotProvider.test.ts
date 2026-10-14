import { describe, expect, it, vi } from 'vitest'

import { createKimiWebSearchTool, runFormulaFiber } from '../moonshotProvider'

const fiberResponse = (body: unknown) => ({ json: async () => body }) as unknown as Response

describe('runFormulaFiber', () => {
  it('posts the arguments as a JSON string to the formula fiber endpoint', async () => {
    const fetchMock = vi.fn(async () => fiberResponse({ status: 'succeeded', context: { output: 'plain' } }))

    await runFormulaFiber(
      { baseURL: 'https://api.moonshot.cn/v1/', apiKey: 'sk-test', fetch: fetchMock },
      'moonshot/web-search:latest',
      'web_search',
      { query: 'latest models' }
    )

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.moonshot.cn/v1/formulas/moonshot/web-search:latest/fibers')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    // The vendor contract is `arguments` as a serialized string, not a nested object.
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'web_search',
      arguments: '{"query":"latest models"}'
    })
  })

  it('prefers encrypted_output, which is what web search returns', async () => {
    const fetchMock = vi.fn(async () =>
      fiberResponse({ status: 'succeeded', context: { encrypted_output: '----MOONSHOT ENCRYPTED BEGIN----x' } })
    )

    await expect(
      runFormulaFiber({ baseURL: 'https://api.moonshot.cn/v1', apiKey: 'k', fetch: fetchMock }, 'f', 'n', {})
    ).resolves.toBe('----MOONSHOT ENCRYPTED BEGIN----x')
  })

  // web-search is a `protected` formula, so a succeeded fiber can carry an empty `output` alongside
  // the real `encrypted_output` — the vendor sample falls through on empty, not just on missing.
  it('falls through an empty output to encrypted_output', async () => {
    const fetchMock = vi.fn(async () =>
      fiberResponse({
        status: 'succeeded',
        context: { output: '', encrypted_output: '----MOONSHOT ENCRYPTED BEGIN----y' }
      })
    )

    await expect(
      runFormulaFiber({ baseURL: 'https://x/v1', apiKey: 'k', fetch: fetchMock }, 'f', 'n', {})
    ).resolves.toBe('----MOONSHOT ENCRYPTED BEGIN----y')
  })

  // Raising keeps the tool part honest: the SDK still shows the model the reason, and the UI marks
  // the call failed instead of rendering it as a search that came back empty.
  it.each([
    [{ error: 'quota exceeded' }, 'quota exceeded'],
    [{ status: 'failed', context: { error: 'bad query' } }, 'bad query'],
    [{ status: 'failed', context: { output: 'nope' } }, 'nope']
  ])('raises a failed fiber (%o)', async (body, expected) => {
    const fetchMock = vi.fn(async () => fiberResponse(body))

    await expect(
      runFormulaFiber({ baseURL: 'https://x/v1', apiKey: 'k', fetch: fetchMock }, 'f', 'n', {})
    ).rejects.toThrow(expected)
  })
})

describe('createKimiWebSearchTool', () => {
  it('returns the fiber output verbatim so the encrypted payload survives serialization', async () => {
    const runFiber = vi.fn(async () => '----MOONSHOT ENCRYPTED BEGIN----payload')
    const kimiTool = createKimiWebSearchTool(runFiber)

    const output = await (kimiTool.execute as (i: unknown, o: unknown) => Promise<unknown>)({ query: 'q' }, {})

    expect(runFiber).toHaveBeenCalledWith({ query: 'q' })
    expect(output).toBe('----MOONSHOT ENCRYPTED BEGIN----payload')
  })
})
