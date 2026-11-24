import { describe, expect, it } from 'vitest'

import { buildCitationInstructions } from './citationInstructions'

const ref = (server: string, name: string) => `<${server}/${name}>`

describe('buildCitationInstructions', () => {
  // A Pi Durable Agent reaches these tools as codemode globals; the Claude Code name matched nothing it calls.
  it('names the lookup tools in the runtime call form', () => {
    const prompt = buildCitationInstructions(ref, true)

    expect(prompt).toContain('<cherry-tools/web_search> / <cherry-tools/web_fetch>')
    expect(prompt).toContain('<cherry-tools/kb_search> / <cherry-tools/kb_read>')
    expect(prompt).not.toContain('mcp__cherry-tools__')
  })

  it('names only the lookups the Agent can call, and nothing when it can call none', () => {
    const prompt = buildCitationInstructions(
      (server, tool) => (tool === 'web_search' ? ref(server, tool) : undefined),
      false
    )
    expect(prompt).toContain('<cherry-tools/web_search>')
    expect(prompt).not.toContain('web_fetch')
    expect(buildCitationInstructions(() => undefined, false)).toBeUndefined()
  })
})
