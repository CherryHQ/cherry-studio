import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { FILE_TYPE, type FileMetadata } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AttachmentToolRuntime } from '../AttachmentButton'

vi.mock('@renderer/utils/file', () => ({
  filterSupportedFiles: vi.fn(async (files) => files)
}))

const t = (key: string) => {
  const translations: Record<string, string> = {
    'chat.input.upload.attachment': 'Upload attachment',
    'chat.input.upload.document_only': 'Documents only',
    'chat.input.upload.image_not_supported': 'This model does not support image uploads. Documents only.'
  }

  return translations[key] ?? key
}

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t })
}))

const createLauncherApi = (): ToolLauncherApi => ({
  registerLaunchers: vi.fn(() => vi.fn())
})

const selectedFile: FileMetadata = {
  id: 'selected',
  path: '/tmp/report.txt',
  name: 'report.txt',
  origin_name: 'report.txt',
  ext: '.txt',
  size: 12,
  type: FILE_TYPE.TEXT,
  created_at: '2026-06-26T00:00:00.000Z',
  count: 1
}

describe('AttachmentToolRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api = {
      ...window.api,
      file: {
        ...window.api?.file,
        select: vi.fn(async () => [selectedFile])
      }
    } as typeof window.api
  })

  it('keeps document-only support as a suffix and tooltip instead of a long label', async () => {
    const launcher = createLauncherApi()

    render(
      <AttachmentToolRuntime
        launcher={launcher}
        couldAddImageFile={false}
        extensions={['.txt']}
        files={[]}
        setFiles={vi.fn()}
      />
    )

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [attachmentLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]

    expect(attachmentLauncher).toMatchObject({
      id: 'attachment',
      sources: ['popover'],
      label: 'Upload attachment',
      suffix: 'Documents only',
      tooltip: 'This model does not support image uploads. Documents only.'
    })
  })

  it('keeps the attachment launcher registered when files change', async () => {
    const launcher = createLauncherApi()
    const setFiles = vi.fn()
    const initialFiles: ComposerAttachment[] = []
    const extensions = ['.txt']

    const view = render(
      <AttachmentToolRuntime
        launcher={launcher}
        couldAddImageFile
        extensions={extensions}
        files={initialFiles}
        setFiles={setFiles}
      />
    )

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalledTimes(1))

    view.rerender(
      <AttachmentToolRuntime
        launcher={launcher}
        couldAddImageFile
        extensions={extensions}
        files={[
          {
            fileTokenSourceId: 'existing',
            path: '/tmp/existing.txt',
            name: 'existing.txt',
            origin_name: 'existing.txt',
            ext: '.txt',
            size: 1,
            type: FILE_TYPE.TEXT
          }
        ]}
        setFiles={setFiles}
      />
    )

    expect(launcher.registerLaunchers).toHaveBeenCalledTimes(1)
  })

  it('appends selected files with a functional state update', async () => {
    const launcher = createLauncherApi()
    const setFiles = vi.fn()

    render(
      <AttachmentToolRuntime
        launcher={launcher}
        couldAddImageFile
        extensions={['.txt']}
        files={[]}
        setFiles={setFiles}
      />
    )

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [attachmentLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    await act(async () => {
      attachmentLauncher.action?.({ source: 'popover', quickPanel: {} as never })
    })

    expect(setFiles).toHaveBeenCalledWith(expect.any(Function))

    const appendFiles = setFiles.mock.calls[0][0]
    expect(
      appendFiles([
        {
          fileTokenSourceId: 'existing',
          path: '/tmp/existing.txt',
          name: 'existing.txt',
          origin_name: 'existing.txt',
          ext: '.txt',
          size: 1,
          type: FILE_TYPE.TEXT
        }
      ])
    ).toEqual([
      expect.objectContaining({ fileTokenSourceId: 'existing', path: '/tmp/existing.txt' }),
      expect.objectContaining({ path: selectedFile.path, name: selectedFile.name })
    ])
  })
})
