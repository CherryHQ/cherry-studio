import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FILE_EDIT_MAX_SIZE_BYTES } from '../useFileEditSession'
import { useFileSize } from '../useFileSize'
import { useIsTextFile } from '../useIsTextFile'

const BS = String.fromCharCode(0x5c)
const OVERSIZED = FILE_EDIT_MAX_SIZE_BYTES + 1

type Meta = { kind: 'file'; type: 'text'; size: number; createdAt: number; modifiedAt: number; mime: string }

function textFile(size: number): Meta {
  return { kind: 'file', type: 'text', size, createdAt: 1, modifiedAt: 1, mime: 'text/plain' }
}

function requestMock() {
  return window.api.ipcApi.request as unknown as {
    mockImplementation(fn: (route: string, input?: { path?: string }) => Promise<{ ok: true; data: Meta | null }>): void
    mockReset(): void
    mockResolvedValue(value: unknown): void
  }
}

function installMetadata(files: Map<string, Meta>) {
  requestMock().mockImplementation(async (route, input) => {
    if (route !== 'file.get_metadata') return { ok: true, data: null }
    return { ok: true, data: (input?.path && files.get(input.path)) || null }
  })
}

function renderMetadata(workspacePath: string, filePath: string) {
  return renderHook(() => ({
    size: useFileSize(workspacePath, filePath),
    text: useIsTextFile(workspacePath, filePath)
  }))
}

describe('file metadata hooks follow the selected POSIX path', () => {
  afterEach(() => {
    const request = requestMock()
    request.mockReset()
    request.mockResolvedValue(undefined)
  })

  // A 4-byte sibling must not be reported as the selected file's size.
  it.each([
    {
      name: 'basename begins with a backslash',
      workspacePath: '/fixtures/lead',
      filePath: `${BS}large.txt`,
      selected: `/fixtures/lead/${BS}large.txt`,
      sibling: '/fixtures/lead/large.txt'
    },
    {
      name: 'workspace directory ends with a backslash',
      workspacePath: `/fixtures/trail/ws${BS}`,
      filePath: 'large.txt',
      selected: `/fixtures/trail/ws${BS}/large.txt`,
      sibling: `/fixtures/trail/ws${BS}large.txt`
    }
  ])('$name reports the oversized selected file, not its 4-byte sibling', async (scenario) => {
    installMetadata(
      new Map([
        [scenario.sibling, textFile(4)],
        [scenario.selected, textFile(OVERSIZED)]
      ])
    )
    const view = renderMetadata(scenario.workspacePath, scenario.filePath)
    await waitFor(() => expect(view.result.current.size).toEqual({ status: 'ok', size: OVERSIZED }))
    await waitFor(() => expect(view.result.current.text).toBe('text'))
  })

  // A missing sibling must not make a small selected text file look absent.
  it.each([
    {
      name: 'basename begins with a backslash',
      workspacePath: '/fixtures/lead',
      filePath: `${BS}small.txt`,
      selected: `/fixtures/lead/${BS}small.txt`
    },
    {
      name: 'workspace directory ends with a backslash',
      workspacePath: `/fixtures/trail/ws${BS}`,
      filePath: 'small.txt',
      selected: `/fixtures/trail/ws${BS}/small.txt`
    }
  ])('$name reports a small selected text file when its sibling is missing', async (scenario) => {
    installMetadata(new Map([[scenario.selected, textFile(8)]]))
    const view = renderMetadata(scenario.workspacePath, scenario.filePath)
    await waitFor(() => expect(view.result.current.size).toEqual({ status: 'ok', size: 8 }))
    await waitFor(() => expect(view.result.current.text).toBe('text'))
  })
})
