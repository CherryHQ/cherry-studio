import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const preferenceGet = vi.fn()

vi.mock('@application', () => ({
  application: { get: () => ({ get: preferenceGet }) }
}))

const { lastUserPromptText, routeMcpToolIds } = await import('../categoryToolRouting')

const DIGEST = '0123456789abcdef0123'
const toolId = (server: string, tool: string) => `mcp__${server}__${tool}_${DIGEST}`

/** A set larger than the budget, so routing actually has to choose. */
function padTo(count: number, ids: string[]): string[] {
  const filler = Array.from({ length: count - ids.length }, (_, i) => toolId('misc', `noop${i}`))
  return [...ids, ...filler]
}

describe('routeMcpToolIds', () => {
  beforeEach(() => {
    preferenceGet.mockReset()
    preferenceGet.mockReturnValue(true)
  })

  it('passes a set that already fits through untouched', () => {
    const ids = [toolId('filesystem', 'readFile'), toolId('brave', 'webSearch')]
    expect(routeMcpToolIds(ids, 'bana bir uygulama yaz')).toEqual(ids)
  })

  it('puts the tools matching the request category first', () => {
    const write = toolId('filesystem', 'writeFile')
    const search = toolId('brave', 'webSearch')
    const routed = routeMcpToolIds(padTo(40, [search, write]), 'bu fonksiyondaki hatayi ayikla')
    expect(routed.slice(0, 1)).toEqual([write])
    expect(routed).toHaveLength(24)
  })

  it('prefers web tools for a research request', () => {
    const write = toolId('filesystem', 'writeFile')
    const search = toolId('brave', 'webSearch')
    const routed = routeMcpToolIds(padTo(40, [write, search]), 'bu iki kütüphaneyi karşılaştır ve araştır')
    expect(routed[0]).toBe(search)
  })

  it('caps without reordering when the category has no signal', () => {
    const ids = padTo(40, [toolId('filesystem', 'writeFile')])
    const routed = routeMcpToolIds(ids, 'merhaba')
    expect(routed).toEqual(ids.slice(0, 24))
  })

  it('sends everything when routing is switched off', () => {
    preferenceGet.mockReturnValue(false)
    const ids = padTo(40, [toolId('filesystem', 'writeFile')])
    expect(routeMcpToolIds(ids, 'kod yaz')).toEqual(ids)
  })

  it('never drops a capability it cannot rank — the budget is still filled', () => {
    const routed = routeMcpToolIds(padTo(40, []), 'bu fonksiyonu refactor et')
    expect(routed).toHaveLength(24)
  })

  it('falls back to the full set when the preference store throws', () => {
    preferenceGet.mockImplementation(() => {
      throw new Error('store unavailable')
    })
    const ids = padTo(40, [])
    expect(routeMcpToolIds(ids, 'kod yaz')).toEqual(ids)
  })
})

describe('lastUserPromptText', () => {
  const message = (role: 'user' | 'assistant', text: string) =>
    ({ id: role + text, role, parts: [{ type: 'text', text }] }) as unknown as UIMessage

  it('reads the most recent user turn, not the assistant reply after it', () => {
    const messages = [message('user', 'ilk soru'), message('assistant', 'cevap'), message('user', 'ikinci soru')]
    expect(lastUserPromptText(messages)).toBe('ikinci soru')
  })

  it('returns an empty string when there is nothing to read', () => {
    expect(lastUserPromptText(undefined)).toBe('')
    expect(lastUserPromptText([message('assistant', 'cevap')])).toBe('')
  })
})
