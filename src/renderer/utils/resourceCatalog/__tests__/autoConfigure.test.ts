import { describe, expect, it } from 'vitest'

import {
  type AutoConfigCatalogs,
  buildAutoConfigInput,
  parseAutoConfigDraft,
  readAutoConfigProgress
} from '../autoConfigure'

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

  // Catches a nameless-purpose request reaching the model as an empty line it cannot read as "not given".
  it('marks a missing purpose and keeps the name for the model to work from', () => {
    const input = buildAutoConfigInput({ ...agent, purpose: '  ', name: '法务专家' })

    expect(input).toContain('Purpose: (none)')
    expect(input).toContain('Preferred name: 法务专家')
  })

  it('does not list skills or permission modes for an assistant', () => {
    const input = buildAutoConfigInput({ ...assistant, purpose: 'Translate' })

    expect(input).not.toContain('skill-review')
    expect(input).not.toContain('Permission modes')
  })
})

// The working view shows these as the reply streams; each case is a reply cut off mid-way.
describe('readAutoConfigProgress', () => {
  const promptText = '# Role\nYou review "pull requests".'
  const reply =
    `{"name":"Reviewer","emoji":"🔍","description":"Reviews PRs","prompt":${JSON.stringify(promptText)},` +
    '"knowledgeBaseIds":[],"mcpServerIds":["mcp-github","preset:fetch"],"permissionMode":"default",' +
    '"skillIds":["skill-review","skill-tdd"]}'
  const cut = (marker: string, extra = 0) => reply.slice(0, reply.indexOf(marker) + extra)

  it('reads the prompt as written so far, without a half-written escape', () => {
    const progress = readAutoConfigProgress(cut('pull requests', -1), 'agent')

    expect(progress.prompt).toBe('# Role\nYou review ')
    expect(progress.promptDone).toBe(false)
    expect(progress.tools.done).toBe(false)
  })

  it('finishes the prompt and lists the MCP servers picked so far', () => {
    const progress = readAutoConfigProgress(cut('"preset:fetch"'), 'agent')

    expect(progress.prompt).toBe(promptText)
    expect(progress.promptDone).toBe(true)
    expect(progress.tools).toEqual({ done: false, mcpServerIds: ['mcp-github'] })
  })

  it('finishes the tools with the permission mode and then the skills', () => {
    const tools = readAutoConfigProgress(cut('"skillIds"'), 'agent')
    expect(tools.tools).toMatchObject({ done: true, permissionMode: 'default' })
    expect(tools.skills).toEqual({ done: false, skillIds: [] })

    const skills = readAutoConfigProgress(cut('"skill-tdd"'), 'agent')
    expect(skills.skills).toEqual({ done: false, skillIds: ['skill-review'] })
    expect(readAutoConfigProgress(reply, 'agent').skills).toEqual({
      done: true,
      skillIds: ['skill-review', 'skill-tdd']
    })
  })

  it("finishes an assistant's tools on its web search choice", () => {
    const text = '{"prompt":"Translate.","knowledgeBaseIds":[],"mcpServerIds":[],"enableWebSearch":tr'
    expect(readAutoConfigProgress(text, 'assistant').tools.done).toBe(false)
    expect(readAutoConfigProgress(`${text}ue}`, 'assistant').tools).toEqual({
      done: true,
      mcpServerIds: [],
      enableWebSearch: true
    })
  })
})
