/**
 * Integration tests for `shell__exec`'s end-to-end permission wiring:
 * `needsApproval` → central pipeline → bash L3 hook + L4 user rules.
 *
 * The actual `execute` is never called here — these tests exercise only
 * the `needsApproval` callback and the ToolEntry shape.
 */

import '@test-helpers/setupBashWasm'

import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { matchBashRule } from '@main/ai/tools/builtin/shell/bash/ruleMatcher'
import { registry } from '@main/ai/tools/registry'
import { matcherRegistry } from '@main/services/toolApproval'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { createShellExecToolEntry, SHELL_EXEC_TOOL_NAME } from '../exec'

const RULES_KEY = 'tools.permission_rules'

const entry = createShellExecToolEntry()
// `createShellExecToolEntry` registers the matcher as a side-effect; mirror
// it here in case the test file is imported in isolation.
matcherRegistry.register(SHELL_EXEC_TOOL_NAME, matchBashRule)
// Make the entry visible to the central pipeline so its L3 hook fires.
registry.register(entry)

function fakeOpts(): ToolExecutionOptions {
  return {
    toolCallId: 'tc-test',
    messages: [],
    experimental_context: { requestId: 'req-1' },
    abortSignal: new AbortController().signal
  } as ToolExecutionOptions
}

async function needsApproval(input: { command: string; cwd?: string }): Promise<boolean> {
  const fn = entry.tool.needsApproval as (input: unknown, opts: ToolExecutionOptions) => Promise<boolean>
  return fn(input, fakeOpts())
}

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
})

describe('shell__exec needsApproval — allow path', () => {
  it("'ls' (allowlisted) → false (proceed)", async () => {
    expect(await needsApproval({ command: 'ls' })).toBe(false)
  })

  it("'git status -uno' → false", async () => {
    expect(await needsApproval({ command: 'git status -uno' })).toBe(false)
  })
})

describe('shell__exec needsApproval — deny path (throws)', () => {
  it("'rm -rf /' throws", async () => {
    await expect(needsApproval({ command: 'rm -rf /' })).rejects.toThrow()
  })

  it("'sudo rm' throws", async () => {
    await expect(needsApproval({ command: 'sudo rm foo' })).rejects.toThrow()
  })

  it('parse-failed input throws', async () => {
    await expect(needsApproval({ command: 'if [' })).rejects.toThrow()
  })

  it('non-string command throws', async () => {
    await expect(needsApproval({ command: 42 as unknown as string })).rejects.toThrow()
  })
})

describe('shell__exec needsApproval — ask path (returns true)', () => {
  it("'git push' (no rule) → true (suspends for approval)", async () => {
    expect(await needsApproval({ command: 'git push' })).toBe(true)
  })

  it("'./script.sh' → true", async () => {
    expect(await needsApproval({ command: './script.sh' })).toBe(true)
  })

  it("'cat $(echo file)' (substitution) → true", async () => {
    expect(await needsApproval({ command: 'cat $(echo README.md)' })).toBe(true)
  })
})

describe('shell__exec needsApproval — L4 user allow rules', () => {
  it("'git push' with `Bash(git push:*)` allow rule → false", async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(RULES_KEY, [
      {
        id: 'r1',
        toolName: SHELL_EXEC_TOOL_NAME,
        ruleContent: 'git push:*',
        behavior: 'allow',
        source: 'userPreference',
        createdAt: 1
      }
    ])
    expect(await needsApproval({ command: 'git push origin main' })).toBe(false)
  })

  it("'git push' deny rule beats nothing → throws", async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(RULES_KEY, [
      {
        id: 'r2',
        toolName: SHELL_EXEC_TOOL_NAME,
        ruleContent: 'git push:*',
        behavior: 'deny',
        source: 'userPreference',
        createdAt: 1
      }
    ])
    await expect(needsApproval({ command: 'git push' })).rejects.toThrow()
  })

  it('allow rule does NOT override L3 deny (denylist hit beats user allow)', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(RULES_KEY, [
      {
        id: 'r3',
        toolName: SHELL_EXEC_TOOL_NAME,
        ruleContent: 'rm:*',
        behavior: 'allow',
        source: 'userPreference',
        createdAt: 1
      }
    ])
    await expect(needsApproval({ command: 'rm -rf /' })).rejects.toThrow()
  })
})

describe('shell__exec ToolEntry shape', () => {
  it('exposes the L3 hook on the entry', () => {
    expect(entry.checkPermissions).toBeDefined()
  })

  it('registers the bash content matcher with the singleton', () => {
    expect(matcherRegistry.get(SHELL_EXEC_TOOL_NAME)).toBeDefined()
  })
})
