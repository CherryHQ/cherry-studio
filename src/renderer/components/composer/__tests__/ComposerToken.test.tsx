import { COMPOSER_FILE_KIND, FILE_TYPE, type FileMetadata } from '@renderer/types/file'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import { AllSelection, NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { serializeComposerDocument } from '../composerDraft'
import { createComposerEditorPreset } from '../composerPreset'
import { COMPOSER_TOKEN_NODE_NAME } from '../ComposerTokenNode'
import { createPromptVariableContent, selectPromptVariableToken } from '../promptVariables'
import { PromptVariableToken } from '../PromptVariableToken'
import {
  ACTIVE_COMPOSER_INPUT_TOKEN_KINDS,
  type ComposerDraftToken,
  type PromptVariableComposerInputToken
} from '../tokens'
import { composerInputTokenComponentByKind, ComposerToken, FileComposerToken } from '../tokenView'

const ipcRequestMock = vi.hoisted(() => vi.fn())
const imagePreviewShowMock = vi.hoisted(() => vi.fn())
const openFilePreviewTabMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/components/FilePreview', () => ({
  useOptionalOpenFilePreviewTab: () => openFilePreviewTabMock
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: ipcRequestMock
  }
}))

vi.mock('@renderer/services/ImagePreviewService', () => ({
  ImagePreviewService: {
    show: imagePreviewShowMock
  }
}))

vi.mock('@renderer/components/icons/FallbackFavicon', () => ({
  default: ({ hostname, alt }: { hostname: string; alt: string }) => (
    <img data-testid="favicon" data-hostname={hostname} alt={alt} />
  )
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const PopoverContext = React.createContext<{
    open: boolean
    triggerRef: { current: HTMLElement | null }
  }>({ open: false, triggerRef: { current: null } })

  return {
    Button: ({
      children,
      size: _size,
      variant: _variant,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) => {
      void _size
      void _variant

      return (
        <button type="button" {...props}>
          {children}
        </button>
      )
    },
    Scrollbar: ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props} className={className} data-testid="composer-token-scrollbar">
        {children}
      </div>
    ),
    NormalTooltip: ({
      children,
      content,
      contentProps,
      showArrow
    }: {
      children: ReactNode
      content: ReactNode
      contentProps?: { className?: string }
      showArrow?: boolean
    }) => {
      const trigger = React.isValidElement(children)
        ? // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild slot behavior
          React.cloneElement(children, { 'data-tooltip-trigger': 'true' } as Record<string, unknown>)
        : children

      return (
        <span
          data-content-class-name={contentProps?.className}
          data-show-arrow={String(showArrow)}
          data-testid="composer-token-tooltip">
          {trigger}
          <span data-testid="composer-token-tooltip-content">{content}</span>
        </span>
      )
    },
    Popover: ({ children, open }: { children: ReactNode; open?: boolean }) => {
      const triggerRef = React.useRef<HTMLElement | null>(null)

      return (
        <PopoverContext value={{ open: Boolean(open), triggerRef }}>
          <span data-open={String(Boolean(open))} data-testid="composer-token-popover">
            {children}
          </span>
        </PopoverContext>
      )
    },
    PopoverContent: ({
      ref,
      children,
      className,
      align: _align,
      side: _side,
      sideOffset: _sideOffset,
      onOpenAutoFocus,
      onCloseAutoFocus,
      ...props
    }: HTMLAttributes<HTMLDivElement> & {
      align?: string
      side?: string
      sideOffset?: number
      onOpenAutoFocus?: (event: { preventDefault: () => void }) => void
      onCloseAutoFocus?: (event: { preventDefault: () => void }) => void
    } & { ref?: { current: HTMLDivElement | null } }) => {
      const { open, triggerRef } = React.use(PopoverContext)
      const contentRef = React.useRef<HTMLDivElement | null>(null)
      const previousOpenRef = React.useRef(open)
      void _align
      void _side
      void _sideOffset

      React.useEffect(() => {
        if (!open) return

        let defaultPrevented = false
        onOpenAutoFocus?.({
          preventDefault: () => {
            defaultPrevented = true
          }
        } as Event)

        if (!defaultPrevented) {
          contentRef.current
            ?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
            ?.focus()
        }
      }, [onOpenAutoFocus, open])

      React.useEffect(() => {
        if (previousOpenRef.current && !open) {
          let defaultPrevented = false
          onCloseAutoFocus?.({
            preventDefault: () => {
              defaultPrevented = true
            }
          } as Event)

          if (!defaultPrevented) {
            triggerRef.current?.focus()
          }
        }
        previousOpenRef.current = open
      }, [onCloseAutoFocus, open, triggerRef])

      if (!open) return null

      const setContentRef = (node: HTMLDivElement | null) => {
        contentRef.current = node
        if (ref) {
          ref.current = node
        }
      }

      return (
        <div {...props} ref={setContentRef} className={className} data-testid="composer-token-popover-content">
          {children}
        </div>
      )
    },
    PopoverTrigger: ({ children, asChild: _asChild }: { children: ReactNode; asChild?: boolean }) => {
      const { triggerRef } = React.use(PopoverContext)
      void _asChild

      if (!React.isValidElement(children)) return children

      const childRef = (children.props as { ref?: React.Ref<HTMLElement> }).ref
      const setTriggerRef = (node: HTMLElement | null) => {
        triggerRef.current = node
        if (typeof childRef === 'function') {
          childRef(node)
        } else if (childRef && 'current' in childRef) {
          childRef.current = node
        }
      }

      // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild slot behavior
      return React.cloneElement(children, {
        'data-popover-trigger': 'true',
        ref: setTriggerRef
      } as Record<string, unknown>)
    }
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const readPastedTextMock = vi.fn()

beforeEach(() => {
  ipcRequestMock.mockReset()
  ipcRequestMock.mockResolvedValue(undefined)
  imagePreviewShowMock.mockReset()
  imagePreviewShowMock.mockResolvedValue(undefined)
  openFilePreviewTabMock.mockReset()
  openFilePreviewTabMock.mockReturnValue('file-preview-tab')
  readPastedTextMock.mockReset()
  readPastedTextMock.mockResolvedValue('第一段粘贴文本\n第二段粘贴文本')
  Object.defineProperty(window, 'api', {
    value: {
      ...window.api,
      fs: {
        ...window.api?.fs,
        readText: readPastedTextMock
      }
    },
    configurable: true
  })
})

const promptVariableToken: PromptVariableComposerInputToken = {
  id: 'prompt-variable:0:city',
  kind: 'promptVariable',
  label: 'city',
  description: '${city}',
  promptText: '${city}'
}

function createFileMetadata(overrides: Partial<FileMetadata>): FileMetadata {
  return {
    id: 'file-1',
    name: 'file-1.txt',
    origin_name: 'file-1.txt',
    path: '/tmp/file-1.txt',
    size: 1024,
    ext: '.txt',
    type: FILE_TYPE.TEXT,
    created_at: '2026-05-29T00:00:00.000Z',
    count: 1,
    ...overrides
  }
}

function ComposerEditorHarness({
  onEditor,
  text = 'go ${city}'
}: {
  onEditor: (editor: Editor) => void
  text?: string
}) {
  const editor = useEditor({
    extensions: createComposerEditorPreset(),
    content: createPromptVariableContent(text)
  })

  useEffect(() => {
    if (editor) onEditor(editor)
  }, [editor, onEditor])

  return <EditorContent editor={editor} />
}

function findComposerTokenPosition(editor: Editor): number {
  let tokenPosition = -1
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === COMPOSER_TOKEN_NODE_NAME) tokenPosition = position
  })
  return tokenPosition
}

function getRenderedFileToken(container: HTMLElement) {
  const token = container.querySelector('[data-composer-token-kind="file"]')
  expect(token).toBeInTheDocument()
  return token as HTMLElement
}

function getFileTokenTrigger(container: HTMLElement) {
  return getTokenTrigger(container, 'file')
}

function getTokenTrigger(container: HTMLElement, kind: string) {
  const token = container.querySelector(`[data-composer-token-kind="${kind}"]`)
  expect(token).toBeInTheDocument()
  const trigger = token?.closest('[data-popover-trigger="true"]')
  expect(trigger).toBeInTheDocument()
  return trigger as HTMLElement
}

async function openFileTokenPopover(container: HTMLElement) {
  const user = userEvent.setup()
  const trigger = getFileTokenTrigger(container)
  await user.hover(trigger)
  await waitFor(() => expect(screen.getByTestId('composer-token-popover')).toHaveAttribute('data-open', 'true'))
  return trigger
}

function expectNoComposerTokenPopover(container: HTMLElement) {
  expect(container.querySelector('[data-popover-trigger="true"]')).toBeNull()
  expect(screen.queryByTestId('composer-token-popover')).toBeNull()
  expect(screen.queryByTestId('composer-token-popover-content')).toBeNull()
}

function expectFileTokenVariant(container: HTMLElement, variant: string) {
  const token = getRenderedFileToken(container)
  expect(token).toHaveAttribute('data-file-token-variant', variant)
  expect(token.querySelector(`[data-file-token-icon="${variant}"]`)).toBeInTheDocument()
  return token
}

function expectTokenPathTooltip(container: HTMLElement, path: string, sizeLabel?: string) {
  expectNoComposerTokenPopover(container)

  const tooltipContent = screen.getByTestId('composer-token-tooltip-content')
  const pathText = tooltipContent.querySelector('[data-token-path]')
  const sizeText = tooltipContent.querySelector('[data-token-size]')

  expect(pathText).toHaveTextContent(path)
  if (sizeLabel) {
    expect(sizeText).toHaveTextContent(sizeLabel)
  } else {
    expect(sizeText).toBeNull()
  }
}

describe('ComposerToken', () => {
  it('maps active composer token kinds to explicit components', () => {
    expect(Object.keys(composerInputTokenComponentByKind).toSorted()).toEqual(
      [...ACTIVE_COMPOSER_INPUT_TOKEN_KINDS].toSorted()
    )
  })

  it('renders link tokens with the fixed link affordance color instead of the theme primary', () => {
    const { container } = render(
      <ComposerToken
        token={{
          id: 'link:1',
          kind: 'link',
          label: 'Cherry Studio',
          promptText: 'https://cherry-ai.com'
        }}
      />
    )

    const token = container.querySelector('[data-composer-token-kind="link"]')
    expect(token).toBeInTheDocument()
    expect(token).toHaveClass('text-link')
    expect(token).not.toHaveClass('text-primary')
  })

  it('keeps unparseable link tokens on the fixed link affordance color too', () => {
    const { container } = render(
      <ComposerToken
        token={{
          id: 'link:2',
          kind: 'link',
          label: 'Broken Link',
          promptText: 'not-a-valid-url'
        }}
      />
    )

    const token = container.querySelector('[data-composer-token-kind="link"]')
    expect(token).toBeInTheDocument()
    expect(token).toHaveClass('text-link')
    expect(token).not.toHaveClass('text-primary')
  })

  it('renders folder tokens as compact inline chips with the full path in a tooltip', () => {
    const { container } = render(
      <ComposerToken
        token={{
          id: 'folder:1',
          kind: 'folder',
          label: 'Project Notes',
          promptText: '/Users/jd/Notes/Project Notes'
        }}
      />
    )

    const token = container.querySelector('[data-composer-token-kind="folder"]')
    expect(token).toBeInTheDocument()
    expect(token).toHaveTextContent('Project Notes')
    expect(token).not.toHaveAttribute('title')
    expect(token?.querySelector('[data-folder-token-icon]')).toBeInTheDocument()
    expectTokenPathTooltip(container, '/Users/jd/Notes/Project Notes')
  })

  it('renders image file tokens with image variant metadata and preview', async () => {
    const { container } = render(
      <ComposerToken
        token={{
          id: 'file:image',
          kind: 'file',
          label: 'avatar-preview.png',
          payload: createFileMetadata({
            id: 'image-file',
            name: 'avatar-preview.png',
            origin_name: 'avatar-preview.png',
            path: '/tmp/avatar-preview.png',
            size: 1536,
            ext: '.png',
            type: FILE_TYPE.IMAGE
          })
        }}
      />
    )

    expectFileTokenVariant(container, 'image')
    await openFileTokenPopover(container)
    const popoverContent = screen.getByTestId('composer-token-popover-content')
    expect(popoverContent).not.toHaveTextContent('avatar-preview.png')
    expect(popoverContent).not.toHaveTextContent('PNG')
    expect(popoverContent).not.toHaveTextContent('2 KB')
    const imagePreview = screen.getByAltText('avatar-preview.png')
    expect(imagePreview).toHaveAttribute('src', 'file:///tmp/avatar-preview.png')

    fireEvent.error(imagePreview)
    expect(screen.queryByAltText('avatar-preview.png')).not.toBeInTheDocument()
    expect(popoverContent).toHaveTextContent('chat.input.image_preview_failed')
    expect(popoverContent).not.toHaveTextContent('avatar-preview.png')
    expect(popoverContent).not.toHaveTextContent('PNG')
    expect(popoverContent).not.toHaveTextContent('2 KB')
    expect(popoverContent.querySelector('[data-file-token-image-preview-error]')).toBeInTheDocument()
  })

  it('renders input raster images as chips with a thumbnail in the icon slot', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const { container } = render(
      <FileComposerToken
        imageIconPreview
        selected
        onRemove={onRemove}
        removeLabel="删除"
        token={{
          id: 'file:image-icon-preview',
          kind: 'file',
          label: 'avatar-preview.png',
          payload: createFileMetadata({
            id: 'image-icon-preview-file',
            name: 'avatar-preview.png',
            origin_name: 'avatar-preview.png',
            path: '/tmp/avatar-preview.png',
            ext: '.png',
            type: FILE_TYPE.IMAGE
          })
        }}
      />
    )

    const token = getRenderedFileToken(container)
    expect(token).toHaveClass('h-6', 'align-middle', 'border-primary', 'ring-1', 'ring-primary/40')
    expect(token).not.toHaveClass('align-baseline')
    expect(token).toHaveTextContent('avatar-preview.png')

    const iconSlot = token.querySelector('[data-file-token-icon="image"]')
    const thumbnail = iconSlot?.querySelector('[data-file-token-icon-thumbnail]') as HTMLImageElement
    expect(thumbnail).toHaveAttribute('src', 'file:///tmp/avatar-preview.png')
    expect(thumbnail).toHaveAttribute('alt', '')
    expect(thumbnail).toHaveAttribute('aria-hidden', 'true')
    expect(thumbnail).toHaveAttribute('draggable', 'false')

    const removeButton = screen.getByRole('button', { name: '删除' })

    const trigger = await openFileTokenPopover(container)
    expect(screen.getByAltText('avatar-preview.png')).toBeInTheDocument()

    await user.click(trigger)
    expect(imagePreviewShowMock).toHaveBeenCalledWith('file:///tmp/avatar-preview.png')
    expect(screen.getByTestId('composer-token-popover')).toHaveAttribute('data-open', 'false')

    await user.click(removeButton)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(imagePreviewShowMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the default image icon for SVG input files', () => {
    const { container } = render(
      <FileComposerToken
        imageIconPreview
        token={{
          id: 'file:svg-icon',
          kind: 'file',
          label: 'icon.svg',
          payload: createFileMetadata({
            name: 'icon.svg',
            origin_name: 'icon.svg',
            path: '/tmp/icon.svg',
            ext: '.svg',
            type: FILE_TYPE.IMAGE
          })
        }}
      />
    )

    expect(getRenderedFileToken(container)).toHaveTextContent('icon.svg')
    expect(container.querySelector('[data-file-token-icon-thumbnail]')).toBeNull()
    const iconSlot = container.querySelector('[data-file-token-icon="image"]')
    expect(iconSlot?.querySelector('svg')).toBeInTheDocument()
  })

  it('falls back to the default image icon when the icon thumbnail fails to load', () => {
    const { container } = render(
      <FileComposerToken
        imageIconPreview
        token={{
          id: 'file:image-icon-preview',
          kind: 'file',
          label: 'avatar-preview.png',
          payload: createFileMetadata({
            name: 'avatar-preview.png',
            origin_name: 'avatar-preview.png',
            path: '/tmp/avatar-preview.png',
            ext: '.png',
            type: FILE_TYPE.IMAGE
          })
        }}
      />
    )

    fireEvent.error(container.querySelector('[data-file-token-icon-thumbnail]') as HTMLImageElement)
    expect(container.querySelector('[data-file-token-icon-thumbnail]')).toBeNull()
    const iconSlot = container.querySelector('[data-file-token-icon="image"]')
    expect(iconSlot?.querySelector('svg')).toBeInTheDocument()
    expect(getRenderedFileToken(container)).toHaveTextContent('avatar-preview.png')
  })

  it('renders pdf file tokens with pdf variant metadata', () => {
    const { container } = render(
      <ComposerToken
        onRemove={vi.fn()}
        token={{
          id: 'file:document',
          kind: 'file',
          label: 'report-q2-final.pdf',
          payload: createFileMetadata({
            name: 'report-q2-final.pdf',
            origin_name: 'report-q2-final.pdf',
            path: '/tmp/report-q2-final.pdf',
            size: 2048,
            ext: '.pdf',
            type: FILE_TYPE.DOCUMENT
          })
        }}
      />
    )

    const token = expectFileTokenVariant(container, 'pdf')
    expect(token.querySelector('[data-composer-token-remove]')).toBeInTheDocument()
    expectTokenPathTooltip(container, '/tmp/report-q2-final.pdf', '2 KB')
  })

  it('opens an editable Markdown attachment in the file preview tab by pointer or keyboard', async () => {
    const user = userEvent.setup()
    render(
      <ComposerToken
        token={{
          id: 'file:markdown',
          kind: 'file',
          label: 'requirements.md',
          payload: createFileMetadata({
            name: 'managed-file.md',
            origin_name: 'requirements.md',
            path: '/tmp/managed-file.md',
            ext: '.md',
            type: FILE_TYPE.TEXT
          })
        }}
      />
    )

    const attachment = screen.getByRole('button', { name: 'requirements.md' })
    await user.click(attachment)

    expect(openFilePreviewTabMock).toHaveBeenCalledWith('/tmp/managed-file.md', 'requirements.md')

    openFilePreviewTabMock.mockClear()
    attachment.focus()
    await user.keyboard('{Enter}')

    expect(openFilePreviewTabMock).toHaveBeenCalledWith('/tmp/managed-file.md', 'requirements.md')
  })

  it('opens an editable Office attachment in the file preview tab', async () => {
    const user = userEvent.setup()
    render(
      <ComposerToken
        token={{
          id: 'file:docx',
          kind: 'file',
          label: 'report.docx',
          payload: createFileMetadata({
            name: 'report.docx',
            origin_name: 'report.docx',
            path: '/tmp/report.docx',
            ext: '.docx',
            type: FILE_TYPE.DOCUMENT
          })
        }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'report.docx' }))

    expect(openFilePreviewTabMock).toHaveBeenCalledWith('/tmp/report.docx', 'report.docx')
  })

  it('opens a sent Markdown attachment from its managed file URL', async () => {
    const user = userEvent.setup()
    render(
      <FileComposerToken
        readOnly
        readOnlyFilePreview={{ url: 'file:///tmp/message-files/managed-file.md', mediaType: 'text/markdown' }}
        token={{
          id: 'file:sent-markdown',
          kind: 'file',
          label: 'requirements.md',
          payload: createFileMetadata({
            name: 'managed-file.md',
            origin_name: 'requirements.md',
            path: '/tmp/original-file.md',
            ext: '.md',
            type: FILE_TYPE.TEXT
          })
        }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'requirements.md' }))

    expect(openFilePreviewTabMock).toHaveBeenCalledWith('/tmp/message-files/managed-file.md', 'requirements.md')
  })

  it('opens a sent Office attachment from its managed file URL', async () => {
    const user = userEvent.setup()
    render(
      <FileComposerToken
        readOnly
        readOnlyFilePreview={{
          url: 'file:///tmp/message-files/report.docx',
          mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }}
        token={{
          id: 'file:sent-docx',
          kind: 'file',
          label: 'report.docx'
        }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'report.docx' }))

    expect(openFilePreviewTabMock).toHaveBeenCalledWith('/tmp/message-files/report.docx', 'report.docx')
  })

  it('renders office file tokens with dedicated variants', () => {
    const cases = [
      {
        label: 'report.docx',
        ext: '.docx',
        variant: 'word'
      },
      {
        label: 'budget.xlsx',
        ext: '.xlsx',
        variant: 'excel'
      },
      {
        label: 'deck.pptx',
        ext: '.pptx',
        variant: 'powerpoint'
      }
    ]

    for (const item of cases) {
      const { container, unmount } = render(
        <ComposerToken
          token={{
            id: `file:${item.variant}`,
            kind: 'file',
            label: item.label,
            payload: createFileMetadata({
              name: item.label,
              origin_name: item.label,
              path: `/tmp/${item.label}`,
              ext: item.ext,
              type: FILE_TYPE.DOCUMENT
            })
          }}
        />
      )

      expectFileTokenVariant(container, item.variant)
      unmount()
    }
  })

  it('keeps unsupported archive, audio, and video extensions on the fallback variant', () => {
    const cases = ['archive.zip', 'voice.mp3', 'clip.mp4']

    for (const label of cases) {
      const { container, unmount } = render(<ComposerToken token={{ id: `file:${label}`, kind: 'file', label }} />)

      expectFileTokenVariant(container, 'fallback')
      unmount()
    }
  })

  it('renders text and code file tokens with code variant metadata', () => {
    const { container } = render(
      <ComposerToken
        token={{
          id: 'file:text',
          kind: 'file',
          label: 'config.schema.ts',
          payload: createFileMetadata({
            name: 'config.schema.ts',
            origin_name: 'config.schema.ts',
            path: '/tmp/config.schema.ts',
            size: 3072,
            ext: '.ts',
            type: FILE_TYPE.TEXT
          })
        }}
      />
    )

    expectFileTokenVariant(container, 'code')
    expectTokenPathTooltip(container, '/tmp/config.schema.ts', '3 KB')
  })

  it('shows pasted text preview with a right-aligned restore action', async () => {
    const onRemove = vi.fn()
    const onShowInInput = vi.fn()
    const { container } = render(
      <div data-testid="editor-keydown-boundary">
        <FileComposerToken
          token={{
            id: 'file:pasted-text',
            kind: 'file',
            label: '已粘贴的文本.txt',
            payload: createFileMetadata({
              name: 'pasted_text.txt',
              origin_name: '已粘贴的文本.txt',
              path: '/tmp/pasted_text.txt',
              size: 23552,
              ext: '.txt',
              type: FILE_TYPE.TEXT,
              composerFileKind: COMPOSER_FILE_KIND.PASTED_TEXT
            })
          }}
          onRemove={onRemove}
          removeLabel="删除"
          tooltipActions={
            <button type="button" onClick={onShowInInput}>
              在文本框中显示
            </button>
          }
        />
      </div>
    )

    const token = container.querySelector('[data-composer-token-kind="file"]')
    expect(token).toHaveAttribute('data-file-token-variant', 'text')
    expect(token).toHaveClass('group-focus-visible:border-primary')
    expect(token).not.toHaveClass('group-data-[state=open]:border-primary')
    const trigger = getFileTokenTrigger(container)
    expect(trigger).toHaveAttribute('role', 'button')
    expect(trigger).toHaveAttribute('tabindex', '0')
    expect(trigger).toHaveAccessibleName('已粘贴的文本.txt')
    const removeButton = container.querySelector('[data-composer-token-remove]') as HTMLButtonElement
    expect(removeButton).toBeInTheDocument()
    expect(removeButton).toHaveAttribute('aria-label', '删除')
    expect(screen.getByTestId('composer-token-popover')).toHaveAttribute('data-open', 'false')
    const nativeEditorKeyDown = vi.fn()
    screen.getByTestId('editor-keydown-boundary').addEventListener('keydown', nativeEditorKeyDown)

    fireEvent.focus(trigger)
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getByTestId('composer-token-popover')).toHaveAttribute('data-open', 'true')
    expect(nativeEditorKeyDown).not.toHaveBeenCalled()

    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.getByTestId('composer-token-popover')).toHaveAttribute('data-open', 'false')
    expect(screen.queryByTestId('composer-token-popover-content')).toBeNull()
    expect(nativeEditorKeyDown).not.toHaveBeenCalled()

    fireEvent.keyDown(trigger, { key: ' ' })
    expect(screen.getByTestId('composer-token-popover')).toHaveAttribute('data-open', 'true')
    expect(nativeEditorKeyDown).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('第一段粘贴文本')
    )
    expect(readPastedTextMock).toHaveBeenCalledWith('/tmp/pasted_text.txt')
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('第二段粘贴文本')
    expect(screen.getByTestId('composer-token-popover-content')).not.toHaveTextContent('已粘贴的文本.txt')
    expect(screen.getByTestId('composer-token-popover-content')).not.toHaveTextContent('TXT')
    expect(screen.getByTestId('composer-token-popover-content')).not.toHaveTextContent('23 KB')
    const textScrollbar = screen.getByTestId('composer-token-scrollbar')
    expect(textScrollbar).toHaveAttribute('data-file-token-text-scrollbar', '')
    const textPreview = textScrollbar.querySelector('pre')
    expect(textPreview).toHaveTextContent('第一段粘贴文本')
    const showInInputButton = screen.getByRole('button', { name: '在文本框中显示' })
    expect(showInInputButton).toBeInTheDocument()
    expect(showInInputButton).toHaveFocus()
    const actionContainer = document.querySelector('[data-file-token-actions]')!
    const actionButtons = Array.from(actionContainer.querySelectorAll('button'))
    expect(actionButtons).toHaveLength(1)
    expect(actionButtons[0]).toHaveTextContent('在文本框中显示')

    fireEvent.blur(trigger, { relatedTarget: showInInputButton })
    fireEvent.focus(showInInputButton)
    expect(screen.getByTestId('composer-token-popover')).toHaveAttribute('data-open', 'true')

    fireEvent.click(showInInputButton)
    expect(onShowInInput).toHaveBeenCalledTimes(1)

    fireEvent.click(removeButton)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('keeps sent pasted-text hover preview while click opens the external preview target', async () => {
    const user = userEvent.setup()
    const onActivate = vi.fn()
    const { container } = render(
      <FileComposerToken
        readOnly
        onReadOnlyFilePreviewActivate={onActivate}
        readOnlyFilePreview={{
          url: 'file:///tmp/pasted_text.txt',
          mediaType: 'text/plain',
          composerFileKind: COMPOSER_FILE_KIND.PASTED_TEXT
        }}
        token={{
          id: 'file:pasted-text',
          kind: 'file',
          label: '已粘贴的文本.txt',
          payload: createFileMetadata({
            name: 'pasted_text.txt',
            origin_name: '已粘贴的文本.txt',
            path: '/tmp/pasted_text.txt',
            size: 23552,
            ext: '.txt',
            type: FILE_TYPE.TEXT,
            composerFileKind: COMPOSER_FILE_KIND.PASTED_TEXT
          })
        }}
      />
    )

    const trigger = getFileTokenTrigger(container)
    await user.hover(trigger)
    await waitFor(() => expect(screen.getByTestId('composer-token-popover')).toHaveAttribute('data-open', 'true'))
    await waitFor(() =>
      expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('第一段粘贴文本')
    )

    fireEvent.click(trigger)

    expect(onActivate).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'file:///tmp/pasted_text.txt',
        mediaType: 'text/plain',
        composerFileKind: COMPOSER_FILE_KIND.PASTED_TEXT
      }),
      expect.objectContaining({ id: 'file:pasted-text', label: '已粘贴的文本.txt' })
    )
  })

  it('activates sent generic file previews with click and keyboard without adding a hover card', () => {
    const onActivate = vi.fn()

    render(
      <FileComposerToken
        readOnly
        onReadOnlyFilePreviewActivate={onActivate}
        readOnlyFilePreview={{
          url: 'file:///tmp/report.pdf',
          mediaType: 'application/pdf'
        }}
        token={{
          id: 'file:report',
          kind: 'file',
          label: 'report.pdf'
        }}
      />
    )

    const trigger = screen.getByRole('button', { name: 'report.pdf' })
    expect(screen.queryByTestId('composer-token-popover')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.keyDown(trigger, { key: ' ' })

    expect(onActivate).toHaveBeenCalledTimes(3)
    expect(onActivate).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: 'file:///tmp/report.pdf', mediaType: 'application/pdf' }),
      expect.objectContaining({ id: 'file:report', label: 'report.pdf' })
    )
  })

  it('delays file token popover hover transitions so adjacent tokens do not steal the preview immediately', async () => {
    vi.useFakeTimers()

    try {
      const onRemove = vi.fn()
      const { container } = render(
        <>
          <button type="button">Before token</button>
          <FileComposerToken
            token={{
              id: 'file:1',
              kind: 'file',
              label: 'preview.png',
              payload: createFileMetadata({
                name: 'preview.png',
                origin_name: 'preview.png',
                path: '/tmp/preview.png',
                ext: '.png',
                type: FILE_TYPE.IMAGE
              })
            }}
            onRemove={onRemove}
            removeLabel="删除"
          />
        </>
      )
      const trigger = getFileTokenTrigger(container)
      const popover = screen.getByTestId('composer-token-popover')
      const previousFocus = screen.getByRole('button', { name: 'Before token' })
      previousFocus.focus()

      expect(popover).toHaveAttribute('data-open', 'false')

      fireEvent.mouseEnter(trigger)
      expect(popover).toHaveAttribute('data-open', 'false')

      await act(() => vi.advanceTimersByTime(119))
      expect(popover).toHaveAttribute('data-open', 'false')

      await act(() => vi.advanceTimersByTime(1))
      expect(popover).toHaveAttribute('data-open', 'true')
      expect(previousFocus).toHaveFocus()

      fireEvent.mouseLeave(trigger)
      await act(() => vi.advanceTimersByTime(159))
      expect(popover).toHaveAttribute('data-open', 'true')

      await act(() => vi.advanceTimersByTime(1))
      expect(popover).toHaveAttribute('data-open', 'false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not restore focus to a pointer-open file token after hover close', async () => {
    vi.useFakeTimers()

    try {
      const { container } = render(
        <>
          <FileComposerToken
            token={{
              id: 'file:1',
              kind: 'file',
              label: 'preview.png',
              payload: createFileMetadata({
                name: 'preview.png',
                origin_name: 'preview.png',
                path: '/tmp/preview.png',
                ext: '.png',
                type: FILE_TYPE.IMAGE
              })
            }}
          />
          <button type="button">Next token target</button>
        </>
      )
      const trigger = getFileTokenTrigger(container)
      const popover = screen.getByTestId('composer-token-popover')
      const nextTarget = screen.getByRole('button', { name: 'Next token target' })

      fireEvent.mouseEnter(trigger, { clientX: 12, clientY: 12 })
      await act(() => vi.advanceTimersByTime(120))
      expect(popover).toHaveAttribute('data-open', 'true')

      nextTarget.focus()
      fireEvent.mouseLeave(trigger)
      await act(() => vi.advanceTimersByTime(160))

      expect(popover).toHaveAttribute('data-open', 'false')
      expect(nextTarget).toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps selected file tokens highlighted with primary border and ring', () => {
    const { container } = render(<ComposerToken token={{ id: 'file:1', kind: 'file', label: 'notes.md' }} selected />)

    const token = container.querySelector('[data-composer-token-kind="file"]')
    expect(token).toHaveClass('border-primary', 'ring-1', 'ring-primary/40')
  })

  it('shows quoted content in a tooltip for quote tokens', () => {
    render(
      <ComposerToken
        token={{
          id: 'quote:1',
          kind: 'quote',
          label: 'Quote',
          description: 'first line\nsecond line',
          promptText: '> first line\n> second line'
        }}
      />
    )

    expect(screen.getByText('Quote')).toBeInTheDocument()
    expect(screen.getByText('Quote').closest('[data-composer-token-kind="quote"]')).not.toHaveAttribute('title')
    expect(screen.getByTestId('composer-token-tooltip-content')).toHaveTextContent('first line second line')
    expect(screen.getByTestId('composer-token-tooltip-content')).not.toHaveTextContent('...')
  })

  it('does not render a popover for file tokens without an attachment path', () => {
    const { container } = render(<ComposerToken token={{ id: 'file:1', kind: 'file', label: 'notes.md' }} />)

    expectNoComposerTokenPopover(container)
    expect(screen.queryByTestId('composer-token-tooltip')).toBeNull()
  })

  it('disables tooltip arrows for quote tokens', () => {
    render(
      <ComposerToken
        token={{
          id: 'quote:1',
          kind: 'quote',
          label: 'Quote',
          description: 'quoted text'
        }}
      />
    )

    expect(screen.getByTestId('composer-token-tooltip')).toHaveAttribute('data-show-arrow', 'false')
  })

  it('preserves tooltip trigger props for quote tokens', () => {
    const { container } = render(
      <ComposerToken
        token={{
          id: 'quote:1',
          kind: 'quote',
          label: 'Quote',
          description: 'quoted text'
        }}
      />
    )

    expect(container.querySelector('[data-composer-token-kind="quote"]')).toHaveAttribute(
      'data-tooltip-trigger',
      'true'
    )
  })

  it('unwraps prompt text before showing a quote tooltip fallback', () => {
    render(
      <ComposerToken
        token={{
          id: 'quote:1',
          kind: 'quote',
          label: 'Quote',
          promptText: '<blockquote>\n\nSelected message text\n</blockquote>'
        }}
      />
    )

    expect(screen.getByTestId('composer-token-tooltip-content')).toHaveTextContent('Selected message text')
    expect(screen.getByTestId('composer-token-tooltip-content')).not.toHaveTextContent('<blockquote>')
  })

  it('keeps native title for non-quote tokens', () => {
    const { container } = render(
      <ComposerToken
        token={{
          id: 'file:1',
          kind: 'file',
          label: 'notes.md',
          description: 'Project notes'
        }}
      />
    )

    expect(container.querySelector('[data-composer-token-kind="file"]')).toHaveAttribute('title', 'Project notes')
  })

  it('renders skill tokens without a popover and exposes inline remove on the icon', () => {
    const onRemove = vi.fn()
    const { container } = render(
      <ComposerToken
        token={{
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF Reader',
          description: 'Read and summarize PDF files.',
          promptText: 'Use the PDF Reader skill.'
        }}
        onRemove={onRemove}
        removeLabel="删除"
      />
    )

    expectNoComposerTokenPopover(container)
    const removeButton = container.querySelector('[data-composer-token-remove]') as HTMLButtonElement
    expect(removeButton).toHaveAttribute('aria-label', '删除')

    fireEvent.click(removeButton)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('renders pasted links with the default icon, identifiable label, and removable open action', () => {
    const url = 'https://www.example.com/docs'
    const onRemove = vi.fn()
    const { container } = render(
      <ComposerToken
        token={{
          id: 'link-token-1',
          kind: 'link',
          label: 'example.com/docs',
          promptText: url
        }}
        onRemove={onRemove}
        removeLabel="删除"
      />
    )

    const link = screen.getByRole('link', { name: url })
    expect(link).toHaveTextContent('example.com/docs')
    expect(link).toHaveClass('focus-visible:bg-accent', 'focus-visible:outline-none')
    expect(link).not.toHaveClass('focus-visible:ring-[3px]', 'focus-visible:ring-ring/50')
    expect(link.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByTestId('favicon')).not.toBeInTheDocument()
    expect(container.querySelector('[data-composer-link-favicon]')).not.toBeInTheDocument()
    fireEvent.click(link)
    expect(ipcRequestMock).toHaveBeenCalledWith('system.shell.open_website', url)

    fireEvent.click(container.querySelector('[data-composer-token-remove]') as HTMLButtonElement)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(ipcRequestMock).toHaveBeenCalledTimes(1)
  })

  it('renders sent links with their hostname favicon', () => {
    const url = 'https://www.example.com/docs'
    const { container } = render(
      <ComposerToken
        token={{
          id: 'link-token-1',
          kind: 'link',
          label: 'example.com/docs',
          promptText: url
        }}
        readOnly
      />
    )

    expect(screen.getByTestId('favicon')).toHaveAttribute('data-hostname', 'www.example.com')
    expect(container.querySelector('[data-composer-link-favicon]')).toBeInTheDocument()
  })

  it('renders knowledge tokens without a popover and exposes inline remove on the icon', () => {
    const onRemove = vi.fn()
    const { container } = render(
      <ComposerToken
        token={{
          id: 'knowledge:base-1',
          kind: 'knowledge',
          label: 'Product Docs',
          payload: {
            description: 'Release notes and product specifications.'
          }
        }}
        onRemove={onRemove}
        removeLabel="删除"
      />
    )

    expectNoComposerTokenPopover(container)
    const removeButton = container.querySelector('[data-composer-token-remove]') as HTMLButtonElement
    expect(removeButton).toHaveAttribute('aria-label', '删除')

    fireEvent.click(removeButton)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'skill',
      {
        id: 'skill:pdf',
        kind: 'skill' as const,
        label: 'PDF Reader',
        description: 'Read and summarize PDF files.'
      }
    ],
    [
      'knowledge',
      {
        id: 'knowledge:base-1',
        kind: 'knowledge' as const,
        label: 'Product Docs',
        payload: {
          description: 'Release notes and product specifications.'
        }
      }
    ],
    [
      'folder',
      {
        id: 'folder:project-notes',
        kind: 'folder' as const,
        label: 'Project Notes',
        promptText: '/Users/jd/Notes/Project Notes'
      }
    ]
  ])('lets keyboard users focus and activate the inline remove button for %s tokens', async (_label, token) => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<ComposerToken token={token} onRemove={onRemove} removeLabel="删除" />)

    const removeButton = screen.getByRole('button', { name: '删除' })

    await user.tab()
    expect(removeButton).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported token kinds', () => {
    expect(() =>
      render(<ComposerToken token={{ id: 'command:run', kind: 'command', label: 'Run' } as never} />)
    ).toThrow()
  })

  it('does not render a prompt variable input unless the token is editing', () => {
    const onPromptVariableEditRequest = vi.fn()

    render(
      <PromptVariableToken
        token={promptVariableToken}
        selected
        onCommit={vi.fn()}
        onEditRequest={onPromptVariableEditRequest}
      />
    )

    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.mouseDown(screen.getByText('city'))
    expect(onPromptVariableEditRequest).toHaveBeenCalled()
  })

  it('renders a selected prompt variable as an editable textarea without committing IME intermediates', () => {
    const onPromptVariableCommit = vi.fn()

    render(<PromptVariableToken token={promptVariableToken} selected editing onCommit={onPromptVariableCommit} />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(input.tagName).toBe('TEXTAREA')
    expect(input.value).toBe('city')

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'sh' } })
    expect(onPromptVariableCommit).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '上海' } })
    fireEvent.compositionEnd(input, { data: '上海' })
    expect(onPromptVariableCommit).not.toHaveBeenCalled()

    fireEvent.blur(input)
    expect(onPromptVariableCommit).toHaveBeenCalledWith('上海', 'blur', { dirty: true })
  })

  it('lets prompt variable edit text wrap and grow without truncation', () => {
    render(<PromptVariableToken token={promptVariableToken} selected editing onCommit={vi.fn()} />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 48 })

    expect(input.style.minWidth).toBe('2ch')
    expect(input.style.maxWidth).toBe('100%')
    expect(input.style.width).toBe('')

    fireEvent.change(input, { target: { value: '上海市浦东新区世纪大道' } })
    expect(input.style.width).toBe('')
    expect(input.style.height).toBe('48px')
  })

  it('does not enter prompt variable editing from selection alone', async () => {
    let editor: Editor | null = null
    render(<ComposerEditorHarness onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())
    const promptVariablePosition = findComposerTokenPosition(editor!)

    act(() => {
      editor!.chain().focus().setNodeSelection(promptVariablePosition).run()
    })

    await waitFor(() => expect(editor!.state.selection.from).toBe(promptVariablePosition))
    expect(screen.queryByLabelText('${city}')).toBeNull()
  })

  it('selects and edits a prompt variable when its rendered label is clicked', async () => {
    let editor: Editor | null = null
    render(<ComposerEditorHarness onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())
    const promptVariablePosition = findComposerTokenPosition(editor!)

    fireEvent.mouseDown(screen.getByText('city'))

    const input = (await screen.findByLabelText('${city}')) as HTMLTextAreaElement
    await waitFor(() => expect(editor!.state.selection.from).toBe(promptVariablePosition))
    expect(input.value).toBe('city')
  })

  it('commits the current prompt variable and moves to the next or previous variable on Tab', async () => {
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="go ${from} to ${to}" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      selectPromptVariableToken(editor!, 1)
    })

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('${from}')))
    const fromInput = screen.getByLabelText('${from}') as HTMLTextAreaElement
    fireEvent.change(fromInput, { target: { value: '上海' } })
    fireEvent.keyDown(fromInput, { key: 'Tab' })

    await waitFor(() => expect(serializeComposerDocument(editor!).text).toBe('go 上海 to ${to}'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('${to}')))
    const toInput = screen.getByLabelText('${to}') as HTMLTextAreaElement

    fireEvent.change(toInput, { target: { value: '北京' } })
    fireEvent.keyDown(toInput, { key: 'Tab', shiftKey: true })

    await waitFor(() => expect(serializeComposerDocument(editor!).text).toBe('go 上海 to 北京'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('${from}')))
    const previousInput = screen.getByLabelText('${from}') as HTMLTextAreaElement
    expect(previousInput.value).toBe('上海')
  })

  it('removes an inserted quote token with Backspace without leaving quote newlines', async () => {
    const quoteToken: ComposerDraftToken = {
      id: 'quote:1',
      kind: 'quote',
      label: 'Quote',
      description: 'Selected message text',
      promptText: '<blockquote>\n\nSelected message text\n</blockquote>\n'
    }
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="Reply" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().setTextSelection(1).insertComposerToken(quoteToken).insertContent(' ').run()
    })

    const quotePosition = findComposerTokenPosition(editor!)
    expect(serializeComposerDocument(editor!).text).toBe('<blockquote>\n\nSelected message text\n</blockquote> Reply')

    act(() => {
      editor!
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          dispatch?.(tr.setSelection(NodeSelection.create(tr.doc, quotePosition)))
          return true
        })
        .run()
      editor!.commands.keyboardShortcut('Backspace')
    })

    expect(serializeComposerDocument(editor!).text).toBe(' Reply')
  })

  it('keeps normal token Backspace behavior on the shared insertion path', async () => {
    const fileToken: ComposerDraftToken = {
      id: 'file:1',
      kind: 'file',
      label: 'notes.md',
      promptText: 'notes.md'
    }
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="Reply" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().setTextSelection(1).insertComposerToken(fileToken).insertContent(' ').run()
    })

    const filePosition = findComposerTokenPosition(editor!)
    expect(serializeComposerDocument(editor!).text).toBe('notes.md Reply')

    act(() => {
      editor!
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          dispatch?.(tr.setSelection(NodeSelection.create(tr.doc, filePosition)))
          return true
        })
        .run()
      editor!.commands.keyboardShortcut('Backspace')
    })

    expect(serializeComposerDocument(editor!).text).toBe(' Reply')
  })

  it('removes a file token from the default node view action', async () => {
    const fileToken: ComposerDraftToken = {
      id: 'file:1',
      kind: 'file',
      label: 'notes.md',
      promptText: 'notes.md'
    }
    let editor: Editor | null = null
    const { container } = render(<ComposerEditorHarness text="" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().insertComposerToken(fileToken).run()
    })

    await waitFor(() => expect(container.querySelector('[data-composer-token-remove]')).toBeInTheDocument())
    const removeButton = container.querySelector('[data-composer-token-remove]')
    expect(removeButton).toBeInTheDocument()
    fireEvent.click(removeButton as HTMLButtonElement)

    await waitFor(() => expect(serializeComposerDocument(editor!).text).toBe(''))
  })

  it('removes a knowledge token from the default node view action', async () => {
    const knowledgeToken: ComposerDraftToken = {
      id: 'knowledge:base-1',
      kind: 'knowledge',
      label: 'Product Docs'
    }
    let editor: Editor | null = null
    const { container } = render(<ComposerEditorHarness text="" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().insertComposerToken(knowledgeToken).run()
    })

    await waitFor(() => expect(container.querySelector('[data-composer-token-remove]')).toBeInTheDocument())
    fireEvent.click(container.querySelector('[data-composer-token-remove]') as HTMLButtonElement)

    await waitFor(() => expect(serializeComposerDocument(editor!).tokens).toEqual([]))
  })

  it('does not expose a trailing quote newline after Backspace removes the inserted separator', async () => {
    const quoteToken: ComposerDraftToken = {
      id: 'quote:1',
      kind: 'quote',
      label: 'Quote',
      description: 'Selected message text',
      promptText: '<blockquote>\n\nSelected message text\n</blockquote>\n'
    }
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().insertComposerToken(quoteToken).insertContent(' ').run()
    })

    expect(serializeComposerDocument(editor!).text).toBe('<blockquote>\n\nSelected message text\n</blockquote> ')

    act(() => {
      editor!
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          dispatch?.(tr.setSelection(Selection.atEnd(tr.doc)))
          return true
        })
        .run()
      const cursor = editor!.state.selection.from
      editor!
        .chain()
        .focus()
        .deleteRange({ from: cursor - 1, to: cursor })
        .run()
    })

    expect(serializeComposerDocument(editor!).text).toBe('<blockquote>\n\nSelected message text\n</blockquote>')
  })

  it('removes a quote token with Backspace when the cursor is after the token', async () => {
    const quoteToken: ComposerDraftToken = {
      id: 'quote:1',
      kind: 'quote',
      label: 'Quote',
      description: 'Selected message text',
      promptText: '<blockquote>\n\nSelected message text\n</blockquote>\n'
    }
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().insertComposerToken(quoteToken).run()
    })

    const quotePosition = findComposerTokenPosition(editor!)
    const quoteNode = editor!.state.doc.nodeAt(quotePosition)!
    expect(serializeComposerDocument(editor!).text).toBe('<blockquote>\n\nSelected message text\n</blockquote>')

    act(() => {
      editor!
        .chain()
        .focus()
        .setTextSelection(quotePosition + quoteNode.nodeSize)
        .run()
      editor!.commands.keyboardShortcut('Backspace')
    })

    expect(serializeComposerDocument(editor!).text).toBe('')
  })

  it('removes a quote token with Delete when the cursor is before the token', async () => {
    const quoteToken: ComposerDraftToken = {
      id: 'quote:1',
      kind: 'quote',
      label: 'Quote',
      description: 'Selected message text',
      promptText: '<blockquote>\n\nSelected message text\n</blockquote>\n'
    }
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().insertComposerToken(quoteToken).run()
    })

    const quotePosition = findComposerTokenPosition(editor!)
    expect(serializeComposerDocument(editor!).text).toBe('<blockquote>\n\nSelected message text\n</blockquote>')

    act(() => {
      editor!.chain().focus().setTextSelection(quotePosition).run()
      editor!.commands.keyboardShortcut('Delete')
    })

    expect(serializeComposerDocument(editor!).text).toBe('')
  })

  it('does not create a prompt variable input when the whole composer is selected', async () => {
    let editor: Editor | null = null
    render(<ComposerEditorHarness onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          dispatch?.(tr.setSelection(new AllSelection(tr.doc)))
          return true
        })
        .run()
    })

    await waitFor(() => expect(editor!.state.selection).toBeInstanceOf(AllSelection))
    expect(screen.queryByLabelText('${city}')).toBeNull()
  })

  it.each(['Backspace', 'Delete'])(
    'collapses an all-selection after deleting the whole composer with %s',
    async (key) => {
      let editor: Editor | null = null
      render(<ComposerEditorHarness text="draft" onEditor={(nextEditor) => (editor = nextEditor)} />)

      await waitFor(() => expect(editor).not.toBeNull())

      fireEvent.keyDown(editor!.view.dom, { key: 'a', ctrlKey: true })
      expect(editor!.state.selection).toBeInstanceOf(AllSelection)

      fireEvent.keyDown(editor!.view.dom, { key })

      expect(serializeComposerDocument(editor!).text).toBe('')
      expect(editor!.state.selection).toBeInstanceOf(TextSelection)
      expect(editor!.state.selection.empty).toBe(true)
    }
  )
})
