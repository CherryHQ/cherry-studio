/**
 * Tests for the `shell__exec` ToolEntry checkPermissions hook.
 *
 * Wires parser → classifier and adapts the result to the central
 * pipeline's L3 contract.
 */

import './setupBashWasm'

import { describe, expect, it } from 'vitest'

import { checkShellExecPermissions } from '../checkPermissions'

const ctx = { toolKind: 'builtin', sessionId: 's', toolCallId: 't' } as never

describe('checkShellExecPermissions', () => {
  it("'ls' input → allow", async () => {
    const decision = await checkShellExecPermissions({ command: 'ls' }, ctx)
    expect(decision.behavior).toBe('allow')
  })

  it("'rm -rf /' input → deny", async () => {
    const decision = await checkShellExecPermissions({ command: 'rm -rf /' }, ctx)
    expect(decision.behavior).toBe('deny')
  })

  it("'git push' input → passthrough (so allow rules can fire)", async () => {
    const decision = await checkShellExecPermissions({ command: 'git push' }, ctx)
    expect(decision.behavior).toBe('passthrough')
  })

  it("'cat $(echo file)' input → ask", async () => {
    const decision = await checkShellExecPermissions({ command: 'cat $(echo file)' }, ctx)
    expect(decision.behavior).toBe('ask')
  })

  it('input without a string command → deny (defensive)', async () => {
    const decision = await checkShellExecPermissions({} as never, ctx)
    expect(decision.behavior).toBe('deny')

    const decision2 = await checkShellExecPermissions(null as never, ctx)
    expect(decision2.behavior).toBe('deny')
  })
})
