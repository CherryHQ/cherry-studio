import type { ConfirmActionParams } from '@renderer/components/popups/ConfirmActionPopup'
import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { UniqueModelId } from '@shared/data/types/model'
import { render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEmbeddingModelUnbindConfirm } from '../useEmbeddingModelUnbindConfirm'

const { ipcRequestMock, confirmShowMock, invalidateCacheMock, loggerErrorMock } = vi.hoisted(() => ({
  ipcRequestMock: vi.fn(),
  confirmShowMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
  loggerErrorMock: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequestMock }, useIpcOn: vi.fn() }))

// The global popup mock never runs `action`, so stub the dialog here instead: these tests are
// about what the action does once the user confirms.
vi.mock('@renderer/components/popups/ConfirmActionPopup', () => ({ default: { show: confirmShowMock } }))

vi.mock('@data/hooks/useDataApi', () => ({ useInvalidateCache: () => invalidateCacheMock }))

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: loggerErrorMock }) } }))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // Keep the interpolated values visible so assertions can see base names and counts.
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key)
  })
}))

const EMBED_MODEL_ID = 'openai::embed' as UniqueModelId
const OTHER_MODEL_ID = 'openai::embed-2' as UniqueModelId

function usage(id: string, overrides: Record<string, unknown> = {}) {
  return { id, name: `KB ${id}`, status: 'completed', itemCount: 2, ...overrides }
}

function unbindResult(overrides: Record<string, unknown> = {}) {
  return { unboundBaseIds: [], failedBases: [], vectorCleanupFailedBaseIds: [], ...overrides }
}

/** Route the two IPC calls the hook makes, keyed by route name. */
function stubIpc(bases: unknown[], unbind: Record<string, unknown> = unbindResult()) {
  ipcRequestMock.mockImplementation(async (route: string) =>
    route === 'knowledge.list_bases_using_embedding_model' ? bases : unbind
  )
}

function renderConfirm() {
  return renderHook(() => useEmbeddingModelUnbindConfirm()).result.current
}

describe('useEmbeddingModelUnbindConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateCacheMock.mockResolvedValue(undefined)
    // Default: the user confirms, so the dialog runs the action it was handed.
    confirmShowMock.mockImplementation(async (params: ConfirmActionParams) => {
      await params.action()
      return true
    })
  })

  it('deletes without a dialog when no knowledge base uses the models', async () => {
    stubIpc([])
    const deleteModels = vi.fn().mockResolvedValue(undefined)

    await renderConfirm()([EMBED_MODEL_ID], deleteModels)

    expect(confirmShowMock).not.toHaveBeenCalled()
    expect(deleteModels).toHaveBeenCalledTimes(1)
    expect(ipcRequestMock).not.toHaveBeenCalledWith('knowledge.unbind_embedding_model', expect.anything())
  })

  it('lists every affected base, flagging the ones that already failed', async () => {
    stubIpc([usage('kb-1'), usage('kb-2', { status: 'failed' })])

    await renderConfirm()([EMBED_MODEL_ID], vi.fn().mockResolvedValue(undefined))

    const { content } = confirmShowMock.mock.calls[0][0] as ConfirmActionParams
    render(<>{content}</>)
    expect(screen.getByText(/KB kb-1/)).toBeInTheDocument()
    expect(screen.getByText(/KB kb-2/)).toBeInTheDocument()
    expect(screen.getAllByText(/unbind_knowledge_base.failed_base_note/)).toHaveLength(1)
  })

  it('unbinds every model, refreshes the affected bases, then deletes', async () => {
    stubIpc([usage('kb-1')], unbindResult({ unboundBaseIds: ['kb-1'] }))
    const deleteModels = vi.fn().mockResolvedValue(undefined)

    await renderConfirm()([EMBED_MODEL_ID, OTHER_MODEL_ID], deleteModels)

    for (const embeddingModelId of [EMBED_MODEL_ID, OTHER_MODEL_ID]) {
      expect(ipcRequestMock).toHaveBeenCalledWith('knowledge.unbind_embedding_model', { embeddingModelId })
    }
    expect(invalidateCacheMock).toHaveBeenCalledWith(['/knowledge-bases/kb-1/items', '/knowledge-bases'])
    expect(deleteModels).toHaveBeenCalledTimes(1)
    // The model must outlive the bases that reference it, never the other way round.
    expect(invalidateCacheMock.mock.invocationCallOrder[0]).toBeLessThan(deleteModels.mock.invocationCallOrder[0])
  })

  it('changes nothing when the user cancels', async () => {
    stubIpc([usage('kb-1')])
    confirmShowMock.mockResolvedValue(false)
    const deleteModels = vi.fn().mockResolvedValue(undefined)

    await renderConfirm()([EMBED_MODEL_ID], deleteModels)

    expect(deleteModels).not.toHaveBeenCalled()
    expect(ipcRequestMock).not.toHaveBeenCalledWith('knowledge.unbind_embedding_model', expect.anything())
  })

  it('keeps the model when a base could not be released', async () => {
    stubIpc([usage('kb-1')], unbindResult({ failedBases: [{ id: 'kb-1', name: 'KB kb-1', reason: 'locked' }] }))
    const deleteModels = vi.fn().mockResolvedValue(undefined)

    // The dialog reports the throw and stays open; retrying is safe because unbind is idempotent.
    await expect(renderConfirm()([EMBED_MODEL_ID], deleteModels)).rejects.toThrow(/unbind_failed/)
    expect(deleteModels).not.toHaveBeenCalled()
  })

  it('deletes anyway when only the vector cleanup failed, warning about the leftovers', async () => {
    stubIpc([usage('kb-1')], unbindResult({ unboundBaseIds: ['kb-1'], vectorCleanupFailedBaseIds: ['kb-1'] }))
    const deleteModels = vi.fn().mockResolvedValue(undefined)

    await renderConfirm()([EMBED_MODEL_ID], deleteModels)

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('vector_cleanup_failed'))
    expect(deleteModels).toHaveBeenCalledTimes(1)
  })

  it('says the bases were already downgraded when the deletion itself fails', async () => {
    stubIpc([usage('kb-1')], unbindResult({ unboundBaseIds: ['kb-1'] }))
    const deleteModels = vi
      .fn()
      .mockRejectedValue(
        DataApiErrorFactory.invalidOperation('delete model openai/embed', 'model is in use by a knowledge base')
      )

    await expect(renderConfirm()([EMBED_MODEL_ID], deleteModels)).rejects.toThrow(
      /unbound_but_delete_failed.*model_in_use_by_knowledge_base/
    )
  })
})
