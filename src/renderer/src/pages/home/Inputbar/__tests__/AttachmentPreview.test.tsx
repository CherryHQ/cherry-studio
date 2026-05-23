import type { FileMetadata } from '@renderer/types'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockCommandContextMenuItem = {
  type: 'item'
  id: string
  label: string
  enabled?: boolean
  onSelect: () => void
}

type MockCommandContextMenuProps = {
  location: string
  children: ReactNode
  pendingExtraItems?: readonly MockCommandContextMenuItem[]
  getExtraItems?: () => Promise<readonly MockCommandContextMenuItem[]>
}

const { commandContextMenuMock, isTextFileMock, loggerWarnMock } = vi.hoisted(() => ({
  commandContextMenuMock: vi.fn(({ children }: MockCommandContextMenuProps) => <div>{children}</div>),
  isTextFileMock: vi.fn(),
  loggerWarnMock: vi.fn()
}))

vi.mock('@renderer/commands', () => ({
  CommandContextMenu: commandContextMenuMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: loggerWarnMock
    })
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  ColFlex: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/Tags/CustomTag', () => ({
  default: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
    <span>
      {children}
      <button type="button" onClick={onClose}>
        remove
      </button>
    </span>
  )
}))

vi.mock('@renderer/components/ImageViewer', () => ({
  default: () => null
}))

vi.mock('@renderer/hooks/useAttachment', () => ({
  useAttachment: () => ({ preview: vi.fn() })
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    formatFileName: (file: FileMetadata) => file.origin_name,
    getSafePath: (file: FileMetadata) => file.path
  }
}))

vi.mock('@renderer/utils', () => ({
  formatFileSize: (size: number) => `${size} B`
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import AttachmentPreview from '../AttachmentPreview'

const file: FileMetadata = {
  id: 'file-1',
  name: 'note.txt',
  origin_name: 'note.txt',
  path: '/tmp/note.txt',
  size: 12,
  ext: '.txt',
  type: 'text',
  created_at: '2026-05-23T00:00:00.000Z',
  count: 1
}

const latestMenuProps = (): MockCommandContextMenuProps =>
  commandContextMenuMock.mock.calls.at(-1)?.[0] as MockCommandContextMenuProps

describe('AttachmentPreview command context menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api = {
      file: {
        isTextFile: isTextFileMock
      }
    } as never
  })

  afterEach(() => {
    cleanup()
  })

  it('resolves paste-as-text item for text attachments and caches the probe result', async () => {
    const onPasteAsText = vi.fn()
    isTextFileMock.mockResolvedValueOnce(true)

    render(<AttachmentPreview files={[file]} setFiles={vi.fn()} onPasteAsText={onPasteAsText} />)

    let props = latestMenuProps()
    expect(props.location).toBe('webcontents.context')
    expect(props.pendingExtraItems?.[0]).toEqual(
      expect.objectContaining({
        label: 'chat.input.paste_text_file',
        enabled: false
      })
    )

    let items: readonly MockCommandContextMenuItem[] | undefined
    await act(async () => {
      items = await props.getExtraItems?.()
    })
    expect(items).toEqual([
      expect.objectContaining({
        id: 'attachment:file-1:paste-as-text',
        label: 'chat.input.paste_text_file',
        enabled: true
      })
    ])

    items?.[0]?.onSelect()
    expect(onPasteAsText).toHaveBeenCalledWith(file)
    expect(isTextFileMock).toHaveBeenCalledOnce()

    await waitFor(() => {
      expect(commandContextMenuMock).toHaveBeenCalledTimes(2)
    })

    props = latestMenuProps()
    await act(async () => {
      await props.getExtraItems?.()
    })
    expect(isTextFileMock).toHaveBeenCalledOnce()
  })

  it('returns no paste-as-text item for binary attachments and caches the negative result', async () => {
    isTextFileMock.mockResolvedValueOnce(false)

    render(<AttachmentPreview files={[file]} setFiles={vi.fn()} onPasteAsText={vi.fn()} />)

    let props = latestMenuProps()
    let items: readonly MockCommandContextMenuItem[] | undefined
    await act(async () => {
      items = await props.getExtraItems?.()
    })
    expect(items).toEqual([])
    expect(isTextFileMock).toHaveBeenCalledOnce()

    await waitFor(() => {
      expect(commandContextMenuMock).toHaveBeenCalledTimes(2)
    })

    props = latestMenuProps()
    await act(async () => {
      items = await props.getExtraItems?.()
    })
    expect(items).toEqual([])
    expect(isTextFileMock).toHaveBeenCalledOnce()
  })

  it('treats failed text probes as binary attachments', async () => {
    const error = new Error('probe failed')
    isTextFileMock.mockRejectedValueOnce(error)

    render(<AttachmentPreview files={[file]} setFiles={vi.fn()} onPasteAsText={vi.fn()} />)

    const props = latestMenuProps()
    let items: readonly MockCommandContextMenuItem[] | undefined
    await act(async () => {
      items = await props.getExtraItems?.()
    })
    expect(items).toEqual([])

    expect(loggerWarnMock).toHaveBeenCalledWith('isTextFile probe failed; treating attachment as binary', error)
  })
})
