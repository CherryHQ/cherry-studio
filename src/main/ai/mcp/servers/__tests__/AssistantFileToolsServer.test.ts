import type { Client } from '@modelcontextprotocol/client'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAssistantFileAttachmentHandle } from '@main/ai/messages/assistantFileAttachments'
import type * as ReadFileToolModule from '@main/ai/tools/adapters/aiSdk/builtin/ReadFileTool'
import type * as MoveToTrashModule from '@main/ai/tools/moveToTrash'
import type * as SaveAttachmentModule from '@main/ai/tools/saveAttachment'

const mocks = vi.hoisted(() => ({
  listSessionMessages: vi.fn(),
  moveWorkspaceItemToTrash: vi.fn(),
  readFile: vi.fn(),
  saveAttachmentToWorkspace: vi.fn()
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { listSessionMessages: mocks.listSessionMessages }
}))

vi.mock('@main/ai/tools/adapters/aiSdk/builtin/ReadFileTool', async (importOriginal) => ({
  ...(await importOriginal<typeof ReadFileToolModule>()),
  readFile: mocks.readFile,
  readFileModelOutput: (result: { text: string }) => ({ type: 'text', value: result.text })
}))

vi.mock('@main/ai/tools/saveAttachment', async (importOriginal) => ({
  ...(await importOriginal<typeof SaveAttachmentModule>()),
  saveAttachmentToWorkspace: mocks.saveAttachmentToWorkspace
}))

vi.mock('@main/ai/tools/moveToTrash', async (importOriginal) => ({
  ...(await importOriginal<typeof MoveToTrashModule>()),
  moveWorkspaceItemToTrash: mocks.moveWorkspaceItemToTrash
}))

const { createAssistantFileToolsServer } = await import('../AssistantFileToolsServer')

function message(fileEntryId: string, filename: string) {
  return {
    id: `message-${fileEntryId}`,
    role: 'user',
    data: {
      parts: [
        {
          type: 'file',
          url: `file:///tmp/${filename}`,
          mediaType: 'text/plain',
          filename,
          providerMetadata: { cherry: { fileEntryId } }
        }
      ]
    }
  }
}

function messageWithComposerAttachments() {
  return {
    id: 'message-managed-files',
    role: 'user',
    data: {
      parts: [
        {
          type: 'text',
          text: 'attachments',
          providerMetadata: {
            cherry: {
              composer: {
                version: 1,
                tokens: [{ id: 'file:live-source', kind: 'file', label: 'live.txt', index: 0, textOffset: 0 }]
              }
            }
          }
        },
        {
          type: 'file',
          url: 'file:///tmp/live.txt',
          mediaType: 'text/plain',
          filename: 'live.txt',
          providerMetadata: { cherry: { fileEntryId: 'entry-live', fileTokenSourceId: 'live-source' } }
        },
        {
          type: 'file',
          url: 'file:///tmp/stale.txt',
          mediaType: 'text/plain',
          filename: 'stale.txt',
          providerMetadata: { cherry: { fileEntryId: 'entry-stale', fileTokenSourceId: 'stale-source' } }
        },
        {
          type: 'file',
          url: 'file:///tmp/legacy.txt',
          mediaType: 'text/plain',
          filename: 'legacy.txt',
          providerMetadata: { cherry: { fileEntryId: 'entry-legacy' } }
        }
      ]
    }
  }
}

type Result = { isError?: boolean; content: Array<{ type: string; text: string }> }
const clients: Client[] = []

async function createServer(): Promise<Client> {
  const client = await connectMcpTestClient(() =>
    createAssistantFileToolsServer({ sessionId: 'session-1', workspacePath: '/workspace' })
  )
  clients.push(client)
  return client
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  return (await client.callTool({ name, arguments: args })) as Result
}

describe('assistant-files MCP server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listSessionMessages.mockReturnValue({ items: [], nextCursor: undefined })
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
  })

  it('advertises only the assistant file capabilities', async () => {
    const server = await createServer()

    const result = await server.listTools()

    expect(result.tools.map((tool) => tool.name).sort()).toEqual(['move_to_trash', 'read_file', 'save_attachment'])
  })

  it('rebuilds the attachment allow-list for every read call', async () => {
    const entryId = 'entry-secret'
    const handle = createAssistantFileAttachmentHandle(entryId)
    mocks.listSessionMessages
      .mockReturnValueOnce({ items: [message(entryId, 'report.txt')], nextCursor: undefined })
      .mockReturnValueOnce({ items: [], nextCursor: undefined })
    mocks.readFile.mockImplementation(async (_input, context) => ({
      text: context.attachments.map((attachment: { handle: string }) => attachment.handle).join(',') || '(none)'
    }))
    const server = await createServer()

    // offset/limit omitted: they are plain optionals now, and `limit: 0` is rejected outright
    // (it used to be the "use the default" sentinel that `strict: true` forced on this schema).
    const first = await callTool(server, 'read_file', { filename: handle })
    const second = await callTool(server, 'read_file', { filename: handle })

    expect(first.content[0].text).toBe(handle)
    expect(second.content[0].text).toBe('(none)')
    expect(JSON.stringify(first)).not.toContain(entryId)
  })

  it('does not expose orphaned managed attachments to read_file', async () => {
    mocks.listSessionMessages.mockReturnValue({ items: [messageWithComposerAttachments()], nextCursor: undefined })
    mocks.readFile.mockImplementation(async (_input, context) => ({
      text: context.attachments.map((attachment: { displayName: string }) => attachment.displayName).join(',')
    }))
    const server = await createServer()

    const result = await callTool(server, 'read_file', {
      filename: createAssistantFileAttachmentHandle('entry-live')
    })

    expect(result.content[0].text).toBe('live.txt,legacy.txt')
    expect(mocks.readFile).toHaveBeenCalledWith(
      expect.anything(),
      {
        attachments: [
          expect.objectContaining({ fileEntryId: 'entry-live', displayName: 'live.txt' }),
          expect.objectContaining({ fileEntryId: 'entry-legacy', displayName: 'legacy.txt' })
        ]
      },
      expect.any(AbortSignal)
    )
  })

  it('resolves attachments only when save_attachment is invoked', async () => {
    const entryId = 'entry-secret'
    const handle = createAssistantFileAttachmentHandle(entryId)
    mocks.listSessionMessages.mockReturnValue({ items: [message(entryId, 'report.txt')], nextCursor: undefined })
    mocks.saveAttachmentToWorkspace.mockResolvedValue({ path: 'inputs/report.txt' })
    const server = await createServer()

    const result = await callTool(server, 'save_attachment', {
      filename: handle,
      output_path: 'inputs/report.txt'
    })

    expect(mocks.saveAttachmentToWorkspace).toHaveBeenCalledWith(
      '/workspace',
      { filename: handle, output_path: 'inputs/report.txt' },
      [{ fileEntryId: entryId, handle, displayName: 'report.txt' }],
      expect.any(AbortSignal)
    )
    expect(result.isError).not.toBe(true)
  })

  it('contains transcript lookup failures to the requested tool call', async () => {
    mocks.listSessionMessages.mockImplementation(() => {
      throw new Error('database unavailable')
    })
    const server = await createServer()

    const result = await callTool(server, 'read_file', { filename: createAssistantFileAttachmentHandle('entry') })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Tool execution failed')
    expect(JSON.stringify(result)).not.toContain('database unavailable')
  })

  it.each([
    ['read_file', { filename: 'report.txt', limit: 0 }],
    ['save_attachment', { filename: 'report.txt', output_path: '/etc/passwd' }],
    ['move_to_trash', { path: '' }]
  ])('rejects invalid %s input before touching the workspace', async (name, args) => {
    const server = await createServer()

    const result = await callTool(server, name, args)

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Input validation error')
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mocks.saveAttachmentToWorkspace).not.toHaveBeenCalled()
    expect(mocks.moveWorkspaceItemToTrash).not.toHaveBeenCalled()
  })

  it('moves a confirmed workspace path to trash without reading the transcript', async () => {
    mocks.moveWorkspaceItemToTrash.mockResolvedValue({
      path: 'old-draft.md',
      type: 'file',
      destination: 'trash'
    })
    const server = await createServer()

    const result = await callTool(server, 'move_to_trash', { path: 'old-draft.md' })

    expect(mocks.moveWorkspaceItemToTrash).toHaveBeenCalledWith(
      '/workspace',
      { path: 'old-draft.md' },
      expect.any(AbortSignal)
    )
    expect(mocks.listSessionMessages).not.toHaveBeenCalled()
    expect(result.isError).not.toBe(true)
  })
})
