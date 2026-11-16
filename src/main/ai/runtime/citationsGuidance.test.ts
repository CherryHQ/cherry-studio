import { describe, expect, it } from 'vitest'

import { buildCitationsGuidance } from './citationsGuidance'

const ref = (server: string, name: string) => `<${server}/${name}>`

describe('buildCitationsGuidance', () => {
  // A Pi Durable Agent reaches these tools as codemode globals; the Claude Code name matched nothing it calls.
  it('names the lookup tools in the runtime call form', () => {
    const prompt = buildCitationsGuidance({ web: true, kb: true, ref })

    expect(prompt).toContain('<cherry-tools/web_search> / <cherry-tools/web_fetch>')
    expect(prompt).toContain('<cherry-tools/kb_search> / <cherry-tools/kb_read>')
    expect(prompt).not.toContain('mcp__cherry-tools__')
  })

  it('names only the lookups the Agent can call, and nothing when it can call none', () => {
    expect(buildCitationsGuidance({ web: true, kb: false, ref })).not.toContain('kb_search')
    expect(buildCitationsGuidance({ web: false, kb: false, ref })).toBeUndefined()
  })
})
