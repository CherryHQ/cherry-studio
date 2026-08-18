import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import type { McpResource } from '@shared/types/mcp'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  focus: vi.fn(),
  insertToken: vi.fn(),
  ipcRequest: vi.fn(),
  open: vi.fn(),
  registerLaunchers: vi.fn<(launchers: ComposerToolLauncher[]) => () => void>(() => () => undefined),
  servers: [{ id: 's1', name: 'Files' }],
  updateList: vi.fn()
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  useQuickPanel: () => ({
    isVisible: true,
    symbol: ComposerPanelSymbol.McpResources,
    updateList: mocks.updateList
  })
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({ agent: undefined })
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useScopedMcpServers: () => ({ servers: mocks.servers })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mocks.ipcRequest(...args) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn() }
}))

vi.mock('@renderer/utils/assistant', () => ({
  isSupportedToolUse: () => true
}))

import { mcpResourceToComposerToken } from '../../../variants/shared/composerTokens'
import { TopicType } from '../../types'
import { isTextLikeMcpResource, McpResourceComposerRuntime } from '../mcpResourceTool'

const binaryResource: McpResource = {
  serverId: 's1',
  serverName: 'Files',
  uri: 'file:///report.pdf',
  name: 'Report',
  mimeType: 'application/pdf'
}

const t = ((key: string) => key) as any

function renderRuntime() {
  return render(
    <McpResourceComposerRuntime
      context={
        {
          actions: { onTextChange: vi.fn() },
          assistant: { id: 'assistant-1', settings: { mcpMode: 'auto' } },
          launcher: { registerLaunchers: mocks.registerLaunchers },
          model: {},
          scope: TopicType.Chat,
          t
        } as any
      }
    />
  )
}

describe('isTextLikeMcpResource', () => {
  it('treats text-ish and unlabeled resources as inlinable', () => {
    expect(isTextLikeMcpResource('text/markdown')).toBe(true)
    expect(isTextLikeMcpResource('application/json')).toBe(true)
    // Servers routinely omit mimeType for text resources.
    expect(isTextLikeMcpResource(undefined)).toBe(true)
  })

  it('keeps binary resources out of the inline path', () => {
    expect(isTextLikeMcpResource('image/png')).toBe(false)
    expect(isTextLikeMcpResource('application/pdf')).toBe(false)
    expect(isTextLikeMcpResource('application/octet-stream')).toBe(false)
  })
})

describe('mcpResourceToComposerToken', () => {
  it('carries the uri the read tool needs, and names the tool', () => {
    const resource: McpResource = {
      serverId: 's1',
      serverName: 'Files',
      uri: 'file:///report.pdf',
      name: 'Report',
      mimeType: 'application/pdf'
    }

    const token = mcpResourceToComposerToken(resource)

    expect(token.kind).toBe('reference')
    expect(token.label).toBe('Report')
    expect(token.promptText).toContain('file:///report.pdf')
    expect(token.promptText).toContain('mcp_resource_read')
    expect(token.promptText).toContain('s1')
    expect(token.id).toBe('mcp-resource:s1:file:///report.pdf')
  })

  it('falls back to the uri when the server publishes no name', () => {
    const token = mcpResourceToComposerToken({ serverId: 's1', serverName: 'Files', uri: 'x://a', name: '' })
    expect(token.label).toBe('x://a')
  })

  it('keys the chip by server id, so same-uri resources on two servers do not collide', () => {
    const onA = mcpResourceToComposerToken({ serverId: 's1', serverName: 'dup', uri: 'x://a', name: 'A' })
    const onB = mcpResourceToComposerToken({ serverId: 's2', serverName: 'dup', uri: 'x://a', name: 'A' })

    expect(onA.id).not.toBe(onB.id)
  })
})

describe('McpResourceComposerRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'mcp.server.list_resources') return [binaryResource]
      throw new Error(`unexpected IPC route: ${route}`)
    })
  })

  it('lets users attach a binary resource as a deferred read without downloading it into the renderer', async () => {
    renderRuntime()

    const launcher = mocks.registerLaunchers.mock.calls.at(-1)?.[0][0]
    act(() => {
      launcher?.action?.({ quickPanel: { open: mocks.open }, source: 'root-panel' } as any)
    })

    let item: { action?: (options: unknown) => void; disabled?: boolean; description?: string } | undefined
    await waitFor(() => {
      item = mocks.updateList.mock.calls
        .map(([items]) => items)
        .flat()
        .find((candidate) => candidate.id === 'mcp-resource:s1:file:///report.pdf')
      expect(item?.action).toBeTypeOf('function')
    })

    expect(item).toMatchObject({ description: 'application/pdf' })
    expect(item?.disabled).not.toBe(true)
    act(() => {
      item?.action?.({ inputAdapter: { insertToken: mocks.insertToken, focus: mocks.focus } })
    })

    expect(mocks.insertToken).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mcp-resource:s1:file:///report.pdf',
        promptText: expect.stringContaining('mcp_resource_read')
      })
    )
    expect(mocks.focus).toHaveBeenCalled()
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('mcp.server.read_resource_preview', expect.anything())
  })
})
