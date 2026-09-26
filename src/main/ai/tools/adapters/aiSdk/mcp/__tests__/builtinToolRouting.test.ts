// Guards the budget against the tools Cherry actually ships. The unit tests next door use made-up
// ids; these are built by the real `buildMcpToolWireId` from the real server and tool names, so a
// renamed builtin — or a slug that truncates past its keyword — fails here instead of silently
// costing the user their tool ranking.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const preferenceGet = vi.fn()

vi.mock('@application', () => ({
  application: { get: () => ({ get: preferenceGet }) }
}))

const { routeMcpToolIds } = await import('../categoryToolRouting')
const { buildMcpToolWireId } = await import('@main/ai/mcp/mcpToolId')

/** Tool names read off the live servers, not from their docs. */
const BUILTIN_TOOLS: Record<string, string[]> = {
  '@cherry/filesystem': ['glob', 'ls', 'grep', 'read', 'edit', 'write', 'delete'],
  '@cherry/fetch': ['fetch_html', 'fetch_markdown', 'fetch_txt', 'fetch_json'],
  '@cherry/brave-search': ['brave_web_search', 'brave_local_search'],
  '@cherry/pollinations': ['generate_image'],
  '@cherry/sequentialthinking': ['sequentialthinking'],
  '@cherry/browser': ['browser_navigate', 'browser_screenshot']
}

const wireId = (serverName: string, toolName: string) =>
  buildMcpToolWireId({ serverId: serverName, serverName, toolName })

const toolsOf = (serverName: string) => BUILTIN_TOOLS[serverName].map((tool) => wireId(serverName, tool))

/** Every builtin tool there is, which is more than the budget allows. */
const ALL = Object.keys(BUILTIN_TOOLS).flatMap(toolsOf)

/** Padding so the set always exceeds the budget and routing has to actually choose. */
const NOISE = Array.from({ length: 40 }, (_, i) => wireId('@vendor/misc', `noop_${i}`))

function rank(prompt: string): string[] {
  return routeMcpToolIds([...NOISE, ...ALL], prompt)
}

describe('routeMcpToolIds against the shipped builtins', () => {
  beforeEach(() => {
    preferenceGet.mockReset()
    preferenceGet.mockReturnValue(true)
  })

  it('brings every filesystem tool along for a coding request', () => {
    const routed = rank('bana bir todo uygulamasi yap')
    for (const id of toolsOf('@cherry/filesystem')) expect(routed).toContain(id)
  })

  it('brings the search and fetch tools along for a research request', () => {
    const routed = rank('bu iki kutuphaneyi arastir ve karsilastir')
    for (const id of [...toolsOf('@cherry/brave-search'), ...toolsOf('@cherry/fetch')]) {
      expect(routed).toContain(id)
    }
  })

  it('brings the image tool along for an image request', () => {
    expect(rank('bana bir logo ciz')).toContain(wireId('@cherry/pollinations', 'generate_image'))
  })

  it('keeps the planning tool for both code and research, since it is what paces a weak model', () => {
    const thinking = wireId('@cherry/sequentialthinking', 'sequentialthinking')
    expect(rank('sifirdan bir sistem mimarisi kur')).toContain(thinking)
    expect(rank('bu konuyu arastir')).toContain(thinking)
  })

  it('ranks every builtin above the unrelated vendor noise', () => {
    const routed = rank('bu fonksiyonu duzelt')
    const lastBuiltin = Math.max(...toolsOf('@cherry/filesystem').map((id) => routed.indexOf(id)))
    const firstNoise = routed.findIndex((id) => NOISE.includes(id))
    // Noise still fills the leftover budget on purpose — the cap is not allowed to starve a
    // request of tools it might need. It just has to come after everything that matched.
    expect(firstNoise).toBeGreaterThan(lastBuiltin)
  })

  it('never exceeds the budget, whatever the request', () => {
    for (const prompt of ['kod yaz', 'arastir', 'logo ciz', 'merhaba', '']) {
      expect(rank(prompt).length).toBeLessThanOrEqual(24)
    }
  })
})
