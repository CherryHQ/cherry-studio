import { describe, expect, it } from 'vitest'

import { type AutoConfigCatalogs, buildAutoConfigInput, parseAutoConfigDraft } from '../autoConfigure'

const catalogs: AutoConfigCatalogs = {
  skills: [{ id: 'skill-review', name: 'code-review', description: 'Reviews pull requests' }],
  knowledgeBases: [{ id: 'kb-docs', name: 'Team docs' }],
  mcpServers: [{ id: 'mcp-github', name: 'GitHub' }]
}
const agent = { kind: 'agent' as const, agentType: 'pi-durable' as const, catalogs }
const assistant = { kind: 'assistant' as const, agentType: 'claude-code' as const, catalogs }

const reply = (fields: Record<string, unknown>) =>
  JSON.stringify({ name: 'PR Reviewer', emoji: '🔍', description: 'Reviews PRs', prompt: 'You review PRs.', ...fields })

describe('parseAutoConfigDraft', () => {
  it('reads a configuration wrapped in a code fence and surrounding prose', () => {
    const draft = parseAutoConfigDraft(`Here you go:\n\`\`\`json\n${reply({})}\n\`\`\`\nDone.`, agent)

    expect(draft).toMatchObject({ name: 'PR Reviewer', emoji: '🔍', prompt: 'You review PRs.' })
  })

  it.each([
    ['prose without JSON', 'I would call it PR Reviewer.'],
    ['malformed JSON', '{"name": "PR Reviewer", "prompt": '],
    ['an empty name', reply({ name: '  ' })],
    ['an empty prompt', reply({ prompt: '' })]
  ])('rejects %s so nothing is created', (_case, text) => {
    expect(parseAutoConfigDraft(text, agent)).toBeNull()
  })

  it('drops skill, knowledge base and MCP ids that are not installed', () => {
    const draft = parseAutoConfigDraft(
      reply({
        skillIds: ['skill-review', 'skill-invented'],
        knowledgeBaseIds: ['kb-docs', 'kb-invented'],
        mcpServerIds: ['mcp-invented', 'mcp-github']
      }),
      agent
    )

    expect(draft).toMatchObject({
      skillIds: ['skill-review'],
      knowledgeBaseIds: ['kb-docs'],
      mcpServerIds: ['mcp-github']
    })
  })

  it('never returns bypassPermissions and falls back to the runtime create default', () => {
    expect(parseAutoConfigDraft(reply({ permissionMode: 'bypassPermissions' }), agent)?.permissionMode).toBe('auto')
    expect(parseAutoConfigDraft(reply({ permissionMode: 'default' }), agent)?.permissionMode).toBe('default')
  })

  it('rejects a permission mode the runtime does not support', () => {
    // Pi runtimes have no plan mode.
    expect(parseAutoConfigDraft(reply({ permissionMode: 'plan' }), agent)?.permissionMode).toBe('auto')
  })

  it.each([
    ['a flag', '🇺🇸'],
    ['a subdivision flag', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'],
    ['a rainbow flag', '🏳️‍🌈'],
    ['a pirate flag', '🏴‍☠️'],
    ['a digit', '1'],
    ['a text-style symbol', '©'],
    ['a lone zero-width joiner', '\u200d'],
    ['a lone skin tone', '🏽'],
    ['two emoji', '🔍🐞'],
    ['text', 'magnifier'],
    ['a non-string', 42]
  ])('drops %s as the avatar', (_case, emoji) => {
    expect(parseAutoConfigDraft(reply({ emoji }), agent)?.emoji).toBeUndefined()
  })

  it.each(['👩‍💻', '👍🏽', '1️⃣'])('keeps the multi-codepoint single emoji %s', (emoji) => {
    expect(parseAutoConfigDraft(reply({ emoji }), agent)?.emoji).toBe(emoji)
  })

  it('keeps agent-only fields off an assistant and web search off an agent', () => {
    const text = reply({ skillIds: ['skill-review'], permissionMode: 'default', enableWebSearch: true })

    expect(parseAutoConfigDraft(text, assistant)).toMatchObject({
      skillIds: [],
      permissionMode: undefined,
      enableWebSearch: true
    })
    expect(parseAutoConfigDraft(text, agent)?.enableWebSearch).toBe(false)
  })
})

describe('buildAutoConfigInput', () => {
  it('never offers bypassPermissions to the model', () => {
    const input = buildAutoConfigInput({ ...agent, purpose: 'Review PRs' })

    expect(input).toContain('skill-review')
    expect(input).not.toContain('bypassPermissions')
  })

  it('does not list skills or permission modes for an assistant', () => {
    const input = buildAutoConfigInput({ ...assistant, purpose: 'Translate' })

    expect(input).not.toContain('skill-review')
    expect(input).not.toContain('Permission modes')
  })
})
