import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { listCatalogMock } = vi.hoisted(() => ({ listCatalogMock: vi.fn() }))

vi.mock('../../../../skills/catalog', () => ({
  listCatalog: listCatalogMock
}))

import { createSkillsLoadToolEntry, SKILLS_LOAD_TOOL_NAME } from '../load'

const entry = createSkillsLoadToolEntry()

interface LoadInput {
  name: string
}
type LoadOutput = { kind: 'loaded'; name: string; body: string } | { kind: 'error'; code: string; message: string }

function callExecute(args: LoadInput): Promise<LoadOutput> {
  const execute = entry.tool.execute as (args: LoadInput, opts: ToolExecutionOptions) => Promise<LoadOutput>
  return execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1' }
  } as ToolExecutionOptions)
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('skills__load tool', () => {
  it('registers under the expected name', () => {
    expect(entry.name).toBe(SKILLS_LOAD_TOOL_NAME)
  })

  /**
   * Happy path: known skill name → returns the body. The body is
   * what the model uses to execute the skill; a regression that
   * returns metadata without body would break the feature
   * completely with no obvious error signal.
   */
  it('returns the loaded body when the named skill exists in the catalog', async () => {
    listCatalogMock.mockResolvedValue([
      { name: 'code-review', description: 'd', body: 'do this and that', source: 'cherry-global', path: '/p/SKILL.md' }
    ])
    const out = await callExecute({ name: 'code-review' })
    expect(out).toEqual({ kind: 'loaded', name: 'code-review', body: 'do this and that' })
  })

  /**
   * Unknown name must return a structured error, not throw. The
   * model's tool-error handler reads `code`; an exception would
   * abort the agent loop instead of surfacing as a normal tool
   * result the model can react to.
   */
  it('returns a structured unknown-skill error when the name is not in the catalog', async () => {
    listCatalogMock.mockResolvedValue([])
    const out = await callExecute({ name: 'does-not-exist' })
    expect(out.kind).toBe('error')
    if (out.kind !== 'error') return
    expect(out.code).toBe('unknown-skill')
    expect(out.message).toMatch(/does-not-exist/)
  })
})
