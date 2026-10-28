import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as BuildFileParts from '@renderer/utils/file/buildFileParts'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'

const mocks = vi.hoisted(() => ({
  buildFilePartsForAttachments: vi.fn(),
  ipcRequest: vi.fn()
}))

vi.mock('@renderer/utils/file/buildFileParts', async (importOriginal) => {
  const original = await importOriginal<typeof BuildFileParts>()
  return { ...original, buildFilePartsForAttachments: mocks.buildFilePartsForAttachments }
})

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}))

import { buildAgentFilePartsForAttachments } from '../AgentComposer'

function attachment(overrides: Partial<ComposerAttachment>): ComposerAttachment {
  return {
    fileTokenSourceId: 'source-1',
    name: 'shot.png',
    origin_name: 'shot.png',
    ext: '.png',
    size: 42,
    type: 'image',
    ...overrides
  }
}

describe('buildAgentFilePartsForAttachments', () => {
  beforeEach(() => {
    mocks.buildFilePartsForAttachments.mockReset()
    mocks.buildFilePartsForAttachments.mockImplementation(async (attachments: ComposerAttachment[]) =>
      attachments.map((a) => ({ type: 'file', url: `internalized://${a.fileTokenSourceId}`, mediaType: 'image/png' }))
    )
    mocks.ipcRequest.mockReset()
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'file.batch_get_metadata')
        return { '/workspace/docs/notes.md': { kind: 'file', mime: 'text/markdown' } }
      return {}
    })
  })

  afterEach(() => vi.clearAllMocks())

  it('internalizes a managed queued attachment even when its path lies inside the workspace', async () => {
    // Regression for cherry-pr-review inv_d87f5a5cf758b8a0#f1: the workspace-reference
    // branch carries no fileEntryId, so a queue-owned screenshot referenced by path
    // would lose its bytes to the idle sweep once the queue ref releases.
    const managed = attachment({ path: '/workspace/managed/shot.png' as never, entryId: 'queue-entry-1' })

    const parts = await buildAgentFilePartsForAttachments([managed], ['/workspace' as never])

    expect(mocks.buildFilePartsForAttachments).toHaveBeenCalledTimes(1)
    expect(mocks.buildFilePartsForAttachments.mock.calls[0][0]).toEqual([managed])
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('file.batch_get_metadata', expect.anything())
    expect(parts[0]).toMatchObject({ url: 'internalized://source-1' })
  })

  it('keeps genuine workspace files on the workspace-reference branch', async () => {
    const workspaceFile = attachment({ path: '/workspace/docs/notes.md' as never })

    const parts = await buildAgentFilePartsForAttachments([workspaceFile], ['/workspace' as never])

    // The internalized bridge is always invoked; a pure workspace batch hands it an empty list.
    expect(mocks.buildFilePartsForAttachments).toHaveBeenCalledTimes(1)
    expect(mocks.buildFilePartsForAttachments.mock.calls[0][0]).toEqual([])
    expect(mocks.ipcRequest).toHaveBeenCalledWith('file.batch_get_metadata', {
      items: [{ key: '/workspace/docs/notes.md', handle: { kind: 'path', path: '/workspace/docs/notes.md' } }]
    })
    expect(parts[0]).toMatchObject({ type: 'file', url: 'file:///workspace/docs/notes.md' })
  })

  it('internalizes a managed attachment outside the workspace as before', async () => {
    const managed = attachment({ path: '/tmp/managed/shot.png' as never, entryId: 'queue-entry-1' })

    await buildAgentFilePartsForAttachments([managed], ['/workspace' as never])

    expect(mocks.buildFilePartsForAttachments).toHaveBeenCalledTimes(1)
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('file.batch_get_metadata', expect.anything())
  })
})
