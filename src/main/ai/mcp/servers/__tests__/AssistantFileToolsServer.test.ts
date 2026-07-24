import { createFileAttachmentHandle } from '@main/ai/messages/attachmentHandle'
import type * as ExportOfficeModule from '@main/ai/tools/exportOffice'
import type * as FileLookupModule from '@main/ai/tools/fileLookup'
import type * as SaveAttachmentModule from '@main/ai/tools/saveAttachment'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exportOfficeArtifact: vi.fn(),
  listSessionMessages: vi.fn(),
  readFile: vi.fn(),
  saveAttachmentToWorkspace: vi.fn()
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { listSessionMessages: mocks.listSessionMessages }
}))

vi.mock('@main/ai/tools/fileLookup', async (importOriginal) => ({
  ...(await importOriginal<typeof FileLookupModule>()),
  readFile: mocks.readFile,
  readFileModelOutput: (result: { text: string }) => ({ type: 'text', value: result.text })
}))

vi.mock('@main/ai/tools/saveAttachment', async (importOriginal) => ({
  ...(await importOriginal<typeof SaveAttachmentModule>()),
  saveAttachmentToWorkspace: mocks.saveAttachmentToWorkspace
}))

vi.mock('@main/ai/tools/exportOffice', async (importOriginal) => ({
  ...(await importOriginal<typeof ExportOfficeModule>()),
  exportOfficeArtifact: mocks.exportOfficeArtifact
}))

const { AssistantFileToolsServer } = await import('../AssistantFileToolsServer')

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

function handlers(server: InstanceType<typeof AssistantFileToolsServer>) {
  return (server.mcpServer.server as any)._requestHandlers
}

async function callTool(
  server: InstanceType<typeof AssistantFileToolsServer>,
  name: string,
  args: Record<string, unknown>
) {
  return handlers(server).get('tools/call')(
    { method: 'tools/call', params: { name, arguments: args } },
    { signal: new AbortController().signal }
  )
}

describe('AssistantFileToolsServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listSessionMessages.mockReturnValue({ items: [], nextCursor: undefined })
  })

  it('advertises only the assistant file capabilities', async () => {
    const server = new AssistantFileToolsServer({ sessionId: 'session-1', workspacePath: '/workspace' })

    const result = await handlers(server).get('tools/list')({ method: 'tools/list', params: {} }, {})

    expect(result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      'export_office',
      'read_file',
      'save_attachment'
    ])
  })

  it('rebuilds the attachment allow-list for every read call', async () => {
    const entryId = 'entry-secret'
    const handle = createFileAttachmentHandle(entryId)
    mocks.listSessionMessages
      .mockReturnValueOnce({ items: [message(entryId, 'report.txt')], nextCursor: undefined })
      .mockReturnValueOnce({ items: [], nextCursor: undefined })
    mocks.readFile.mockImplementation(async (_input, context) => ({
      text: context.attachments.map((attachment: { handle: string }) => attachment.handle).join(',') || '(none)'
    }))
    const server = new AssistantFileToolsServer({ sessionId: 'session-1', workspacePath: '/workspace' })

    const first = await callTool(server, 'read_file', { filename: handle, offset: null, limit: null })
    const second = await callTool(server, 'read_file', { filename: handle, offset: null, limit: null })

    expect(first.content[0].text).toBe(handle)
    expect(second.content[0].text).toBe('(none)')
    expect(mocks.listSessionMessages).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(first)).not.toContain(entryId)
  })

  it('resolves attachments only when save_attachment is invoked', async () => {
    const entryId = 'entry-secret'
    const handle = createFileAttachmentHandle(entryId)
    mocks.listSessionMessages.mockReturnValue({ items: [message(entryId, 'report.txt')], nextCursor: undefined })
    mocks.saveAttachmentToWorkspace.mockResolvedValue({ path: 'inputs/report.txt' })
    const server = new AssistantFileToolsServer({ sessionId: 'session-1', workspacePath: '/workspace' })

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
    const server = new AssistantFileToolsServer({ sessionId: 'session-1', workspacePath: '/workspace' })

    const result = await callTool(server, 'read_file', {
      filename: createFileAttachmentHandle('entry'),
      offset: null,
      limit: null
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('database unavailable')
  })

  it('exports directly from the assistant workspace without reading the transcript', async () => {
    const input = { operation: 'markdown_to_docx', source_path: 'report.md', output_path: 'report.docx' }
    mocks.exportOfficeArtifact.mockResolvedValue({ path: 'report.docx' })
    const server = new AssistantFileToolsServer({ sessionId: 'session-1', workspacePath: '/workspace' })

    const result = await callTool(server, 'export_office', input)

    expect(mocks.exportOfficeArtifact).toHaveBeenCalledWith('/workspace', input, expect.any(AbortSignal))
    expect(mocks.listSessionMessages).not.toHaveBeenCalled()
    expect(result.isError).not.toBe(true)
  })
})
