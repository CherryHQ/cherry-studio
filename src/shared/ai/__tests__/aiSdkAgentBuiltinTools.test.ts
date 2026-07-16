import { describe, expect, it } from 'vitest'

import { AI_SDK_AGENT_BUILTIN_TOOLS } from '../aiSdkAgentBuiltinTools'

describe('AI_SDK_AGENT_BUILTIN_TOOLS', () => {
  it('keeps tool ids unique and runtime-native lowercase', () => {
    const names = AI_SDK_AGENT_BUILTIN_TOOLS.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name).toBe(name.toLowerCase())
    }
  })

  it('fails closed: every mutating/side-effecting tool prompts, read-only tools are auto', () => {
    const byName = new Map<string, (typeof AI_SDK_AGENT_BUILTIN_TOOLS)[number]>(
      AI_SDK_AGENT_BUILTIN_TOOLS.map((tool) => [tool.name, tool])
    )
    for (const mutating of ['write', 'edit', 'bash']) {
      expect(byName.get(mutating)?.approval, mutating).toBe('prompt')
    }
    for (const readOnly of ['read', 'ls', 'glob', 'grep', 'skill']) {
      expect(byName.get(readOnly)?.approval, readOnly).toBe('auto')
    }
    // The two lists above must cover the whole table, so a newly added tool
    // cannot land without an explicit approval decision in this test.
    expect(byName.size).toBe(8)
  })
})
