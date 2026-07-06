import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rtkRewrite: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@main/utils/rtk', () => ({ rtkRewrite: mocks.rtkRewrite }))

const { createPiApprovalExtension } = await import('./approvalExtension')
const { toolApprovalRegistry } = await import('../toolApproval/ToolApprovalRegistry')

type Handler = (event: unknown, ctx: unknown) => Promise<{ block?: boolean; reason?: string } | undefined>

const WORKSPACE = '/work/space'

/** Build the gate, capturing its `tool_call` handler + emitted chunks. */
function buildGate(
  overrides: Partial<{
    workspacePath: string
    getPermissionMode: () => AgentPermissionMode | undefined
    isDisabled: (toolName: string) => boolean
  }> = {}
) {
  const emitted: any[] = []
  let handler!: Handler
  const factory = createPiApprovalExtension({
    sessionId: 's1',
    workspacePath: WORKSPACE,
    emit: (chunk) => emitted.push(chunk),
    getPermissionMode: () => 'default',
    isDisabled: () => false,
    ...overrides
  })
  factory({
    on: (evt: string, h: unknown) => {
      if (evt === 'tool_call') handler = h as Handler
    }
  } as never)
  return { handler, emitted }
}

const extCtx = { signal: undefined }
const toolEvent = (toolName: string, input: Record<string, unknown>) => ({
  type: 'tool_call' as const,
  toolName,
  toolCallId: `tc-${toolName}`,
  input
})
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rtkRewrite.mockResolvedValue(null)
  toolApprovalRegistry.clear('test-reset')
})

describe('createPiApprovalExtension — policy + approval gate', () => {
  it('auto-allows read-only tools in default mode with no approval request', async () => {
    const { handler, emitted } = buildGate()
    await expect(handler(toolEvent('read', { path: 'x' }), extCtx)).resolves.toBeUndefined()
    expect(emitted).toHaveLength(0)
  })

  it('gates a bash call in default mode: emits a pi-agent approval request and blocks until dispatched', async () => {
    const { handler, emitted } = buildGate()
    const pending = handler(toolEvent('bash', { command: 'ls' }), extCtx)
    await flush()

    expect(emitted).toHaveLength(1)
    expect(emitted[0].type).toBe('tool-approval-request')
    expect(emitted[0].toolCallId).toBe('tc-bash')
    expect(emitted[0].providerMetadata.cherry.transport).toBe('pi-agent')

    expect(toolApprovalRegistry.dispatch(emitted[0].approvalId, { approved: true })).toBe(true)
    await expect(pending).resolves.toBeUndefined()
  })

  it('blocks with the reason when the approval is denied', async () => {
    const { handler, emitted } = buildGate()
    const pending = handler(toolEvent('bash', { command: 'ls' }), extCtx)
    await flush()
    toolApprovalRegistry.dispatch(emitted[0].approvalId, { approved: false, reason: 'not allowed' })
    await expect(pending).resolves.toEqual({ block: true, reason: 'not allowed' })
  })

  it('applies the edited input in place when approved with updatedInput', async () => {
    const { handler, emitted } = buildGate()
    const event = toolEvent('bash', { command: 'ls' })
    const pending = handler(event, extCtx)
    await flush()
    toolApprovalRegistry.dispatch(emitted[0].approvalId, { approved: true, updatedInput: { command: 'ls -a' } })
    await pending
    expect(event.input).toEqual({ command: 'ls -a' })
  })

  it('bypassPermissions runs any tool with no approval event', async () => {
    const { handler, emitted } = buildGate({ getPermissionMode: () => 'bypassPermissions' })
    await expect(handler(toolEvent('bash', { command: 'rm -rf x' }), extCtx)).resolves.toBeUndefined()
    expect(emitted).toHaveLength(0)
  })

  it('acceptEdits auto-allows write but still gates bash', async () => {
    const { handler, emitted } = buildGate({ getPermissionMode: () => 'acceptEdits' })
    await expect(handler(toolEvent('write', { path: 'a', content: 'b' }), extCtx)).resolves.toBeUndefined()
    expect(emitted).toHaveLength(0)

    void handler(toolEvent('bash', { command: 'ls' }), extCtx)
    await flush()
    expect(emitted).toHaveLength(1)
    expect(emitted[0].type).toBe('tool-approval-request')
  })

  it('blocks a disabled tool in every mode, before any approval or rewrite', async () => {
    const { handler, emitted } = buildGate({ isDisabled: (n) => n === 'bash' })
    const result = await handler(toolEvent('bash', { command: 'ls' }), extCtx)
    expect(result?.block).toBe(true)
    expect(result?.reason).toContain('disabled')
    expect(emitted).toHaveLength(0)
    expect(mocks.rtkRewrite).not.toHaveBeenCalled()
  })

  it('blocks a global install without prompting or rewriting', async () => {
    const { handler, emitted } = buildGate()
    const result = await handler(toolEvent('bash', { command: 'npm i -g cowsay' }), extCtx)
    expect(result?.block).toBe(true)
    expect(result?.reason).toContain('pollution')
    expect(emitted).toHaveLength(0)
    expect(mocks.rtkRewrite).not.toHaveBeenCalled()
  })

  it('rtk-rewrites the bash command in place before gating', async () => {
    mocks.rtkRewrite.mockResolvedValueOnce('rtk-rewritten')
    const { handler, emitted } = buildGate()
    const event = toolEvent('bash', { command: 'ls' })
    const pending = handler(event, extCtx)
    await flush()
    expect(event.input.command).toBe('rtk-rewritten')
    toolApprovalRegistry.dispatch(emitted[0].approvalId, { approved: true })
    await pending
    expect(event.input.command).toBe('rtk-rewritten')
  })

  it('blocks without emitting an approval card when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { handler, emitted } = buildGate()
    const result = await handler(toolEvent('bash', { command: 'ls' }), { signal: controller.signal })
    // Synchronous deny from the registry — no pending entry, so no unanswerable card.
    expect(result).toEqual({ block: true, reason: 'Tool request was cancelled before approval' })
    expect(emitted).toHaveLength(0)
  })

  it('denies a pending approval when the registry aborts (session close)', async () => {
    const { handler } = buildGate()
    const pending = handler(toolEvent('bash', { command: 'ls' }), extCtx)
    await flush()
    expect(toolApprovalRegistry.abort('s1', 'pi-session-closed')).toBe(1)
    await expect(pending).resolves.toEqual({ block: true, reason: 'pi-session-closed' })
  })

  describe('workspace path scoping for the auto-approve fast-path', () => {
    it('still auto-allows a read with a relative in-workspace path', async () => {
      const { handler, emitted } = buildGate()
      await expect(handler(toolEvent('read', { path: 'src/index.ts' }), extCtx)).resolves.toBeUndefined()
      expect(emitted).toHaveLength(0)
    })

    it('still auto-allows grep/find/ls with no path (defaults to the workspace root)', async () => {
      const { handler, emitted } = buildGate()
      for (const tool of ['grep', 'find', 'ls']) {
        await expect(handler(toolEvent(tool, {}), extCtx)).resolves.toBeUndefined()
      }
      expect(emitted).toHaveLength(0)
    })

    it('requires approval for a read whose absolute path is outside the workspace', async () => {
      const { handler, emitted } = buildGate()
      void handler(toolEvent('read', { path: '/etc/passwd' }), extCtx)
      await flush()
      expect(emitted).toHaveLength(1)
      expect(emitted[0].type).toBe('tool-approval-request')
    })

    it('requires approval for a read that escapes the workspace via `~`', async () => {
      const { handler, emitted } = buildGate()
      void handler(toolEvent('read', { path: '~/.ssh/id_rsa' }), extCtx)
      await flush()
      expect(emitted).toHaveLength(1)
      expect(emitted[0].type).toBe('tool-approval-request')
    })

    it('requires approval for a read that traverses out of the workspace', async () => {
      const { handler, emitted } = buildGate()
      void handler(toolEvent('read', { path: '../../etc/passwd' }), extCtx)
      await flush()
      expect(emitted).toHaveLength(1)
      expect(emitted[0].type).toBe('tool-approval-request')
    })

    it('acceptEdits gates an edit whose absolute path is outside the workspace', async () => {
      const { handler, emitted } = buildGate({ getPermissionMode: () => 'acceptEdits' })
      void handler(toolEvent('edit', { path: '/Users/v/.zshrc', edits: [] }), extCtx)
      await flush()
      expect(emitted).toHaveLength(1)
      expect(emitted[0].type).toBe('tool-approval-request')
    })

    it('acceptEdits still auto-allows a write with a relative in-workspace path', async () => {
      const { handler, emitted } = buildGate({ getPermissionMode: () => 'acceptEdits' })
      await expect(handler(toolEvent('write', { path: 'out.txt', content: 'x' }), extCtx)).resolves.toBeUndefined()
      expect(emitted).toHaveLength(0)
    })
  })
})
