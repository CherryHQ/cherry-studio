import { dataApiService } from '@data/DataApiService'
import type { FileEntryId } from '@shared/data/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcRequest = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest } }))

import { loadTranslationFiles } from '../translationFiles'

const SOURCE_ENTRY_ID = '019606a0-0000-7000-8000-000000000001' as FileEntryId
const TARGET_ENTRY_ID = '019606a0-0000-7000-8000-000000000002' as FileEntryId
const TARGET_PATH = '/tmp/files/target.pdf' as AbsoluteFilePath

describe('loadTranslationFiles', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    ipcRequest.mockReset()
  })

  it('maps source and target refs to their matching physical paths', async () => {
    MockDataApiUtils.setCustomResponse('/files/refs', 'GET', [
      {
        sourceType: 'translate_history',
        sourceId: 'history-1',
        fileEntryId: TARGET_ENTRY_ID,
        role: 'target'
      },
      {
        sourceType: 'translate_history',
        sourceId: 'history-1',
        fileEntryId: SOURCE_ENTRY_ID,
        role: 'source'
      }
    ])
    ipcRequest.mockResolvedValue({ [TARGET_ENTRY_ID]: TARGET_PATH })

    await expect(loadTranslationFiles('history-1')).resolves.toEqual({
      source: { entryId: SOURCE_ENTRY_ID, path: null },
      target: { entryId: TARGET_ENTRY_ID, path: TARGET_PATH }
    })
    expect(dataApiService.get).toHaveBeenCalledWith('/files/refs', {
      query: { sourceType: 'translate_history', sourceId: 'history-1' }
    })
    expect(ipcRequest).toHaveBeenCalledWith('file.batch_get_physical_paths', {
      ids: [TARGET_ENTRY_ID, SOURCE_ENTRY_ID]
    })
  })

  it('returns early when the history row has no file refs', async () => {
    MockDataApiUtils.setCustomResponse('/files/refs', 'GET', [])

    await expect(loadTranslationFiles('history-without-files')).resolves.toEqual({ source: null, target: null })
    expect(ipcRequest).not.toHaveBeenCalled()
  })
})
