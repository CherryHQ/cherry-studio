import { FILE_TYPE, type FileMetadata } from '@renderer/types/file'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { AllSelection, NodeSelection, Selection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

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

function openFileTokenPopover(container: HTMLElement) {
  return openTokenPopover(container, 'file')
}

function openTokenPopover(container: HTMLElement, kind: string) {
  const trigger = getTokenTrigger(container, kind)
  fireEvent.focus(trigger)
  fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(screen.getByTestId('composer-token-popover')).toHaveAttribute('data-open', 'true')
  return trigger
}

function expectFileTokenVariant(container: HTMLElement, variant: string, iconClassNames: string[]) {
  const token = getRenderedFileToken(container)
  expect(token).toHaveAttribute('data-file-token-variant', variant)
  expect(token.querySelector(`[data-file-token-icon="${variant}"]`)).toHaveClass('border-0', ...iconClassNames)
  return token
}

function expectTokenPopoverUsesPreviewCardShell(content: HTMLElement) {
  const card = content.firstElementChild as HTMLElement
  expect(card).toHaveClass('w-72', 'overflow-hidden', 'text-left')

  const header = card.firstElementChild as HTMLElement
  expect(header).toHaveClass('h-20', 'items-center', 'border-border-subtle', 'border-b', 'bg-muted')

  const icon = header.firstElementChild as HTMLElement
  expect(icon).toHaveClass('size-12', 'items-center', 'justify-center', 'rounded-xl')
}

describe('ComposerToken', () => {
  it('maps active composer token kinds to explicit components', () => {
    expect(Object.keys(composerInputTokenComponentByKind).toSorted()).toEqual(
      [...ACTIVE_COMPOSER_INPUT_TOKEN_KINDS].toSorted()
    )
  })

  it('renders file tokens as compact inline chips with fallback styling', () => {
    const { container } = render(<ComposerToken token={{ id: 'file:1', kind: 'file', label: 'unknown.bin' }} />)

    const token = getRenderedFileToken(container)
    expect(token).toHaveTextContent('unknown.bin')
    expect(screen.queryByRole('textbox')).toBeNull()
    openFileTokenPopover(container)
    expect(screen.getByTestId('composer-token-popover-content')).toBeInTheDocument()
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('unknown.bin')

    expect(token).toHaveClass(
      'h-6',
      'my-0.5',
      'items-center',
      'rounded-md',
      'border',
      'border-border',
      'bg-background',
      'hover:bg-accent',
      'leading-[inherit]'
    )
    expect(token).not.toHaveClass('bg-muted')
    expect(token).not.toHaveClass('py-0.5', 'leading-5')

    const icon = token?.querySelector('[data-file-token-icon="fallback"]')
    expect(icon).toHaveClass('size-4.5', 'rounded-[5px]', 'border-0', 'bg-accent', 'text-muted-foreground')
    expect(icon).not.toHaveClass('border', 'border-border', 'bg-background')
  })

  it('keeps long file token names clipped to a single line while preserving tooltip text', () => {
    const longLabel = 'temp_file_d1a6ca94-e012-4c9e-831a-24cda5f732f0_pasted_text.txt'

    const { container } = render(<ComposerToken token={{ id: 'file:long', kind: 'file', label: longLabel }} />)

    const token = getRenderedFileToken(container)
    const label = token?.querySelector('span.truncate')

    expect(token).toHaveClass('max-w-52', 'overflow-hidden')
    expect(label).toHaveClass('min-w-0', 'max-w-full', 'truncate', 'whitespace-nowrap!', 'break-normal')
    openFileTokenPopover(container)
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent(longLabel)
  })

  it('renders image file tokens with image variant metadata and preview', () => {
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

    const token = expectFileTokenVariant(container, 'image', [
      'bg-[var(--color-cyan-100)]',
      'text-[var(--color-cyan-700)]'
    ])
    expect(token).toHaveClass('border-border', 'bg-background', 'hover:bg-accent')
    expect(token).not.toHaveClass('border-success', 'bg-[var(--color-success-bg)]')
    expect(token?.querySelector('[data-file-token-icon="image"]')).not.toHaveClass('border-success', 'bg-background')
    openFileTokenPopover(container)
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('avatar-preview.png')
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('PNG')
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('2 KB')
    expect(screen.getByAltText('avatar-preview.png')).toHaveAttribute('src', 'file:///tmp/avatar-preview.png')
  })

  it('renders pdf file tokens with pdf variant metadata', () => {
    const { container } = render(
      <ComposerToken
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

    const token = expectFileTokenVariant(container, 'pdf', ['bg-[var(--color-red-100)]', 'text-[var(--color-red-700)]'])
    expect(token).toHaveClass('border-border', 'bg-background', 'hover:bg-accent')
    expect(token).not.toHaveClass('border-destructive', 'bg-[var(--color-error-bg)]')
    expect(token?.querySelector('[data-file-token-icon="pdf"]')).not.toHaveClass('border-destructive', 'bg-background')
    openFileTokenPopover(container)
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('PDF')
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('2 KB')
  })

  it('renders office file tokens with dedicated variants and colors', () => {
    const cases = [
      {
        label: 'report.docx',
        ext: '.docx',
        variant: 'word',
        colorClasses: ['bg-[var(--color-blue-100)]', 'text-[var(--color-blue-700)]']
      },
      {
        label: 'budget.xlsx',
        ext: '.xlsx',
        variant: 'excel',
        colorClasses: ['bg-[var(--color-green-100)]', 'text-[var(--color-green-700)]']
      },
      {
        label: 'deck.pptx',
        ext: '.pptx',
        variant: 'powerpoint',
        colorClasses: ['bg-[var(--color-orange-100)]', 'text-[var(--color-orange-700)]']
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

      expectFileTokenVariant(container, item.variant, item.colorClasses)
      unmount()
    }
  })

  it('keeps unsupported archive, audio, and video extensions on fallback styling', () => {
    const cases = ['archive.zip', 'voice.mp3', 'clip.mp4']

    for (const label of cases) {
      const { container, unmount } = render(<ComposerToken token={{ id: `file:${label}`, kind: 'file', label }} />)

      expectFileTokenVariant(container, 'fallback', ['bg-accent', 'text-muted-foreground'])
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

    const token = expectFileTokenVariant(container, 'code', [
      'bg-[var(--color-indigo-100)]',
      'text-[var(--color-indigo-700)]'
    ])
    expect(token).toHaveClass('border-border', 'bg-background', 'hover:bg-accent')
    expect(token).not.toHaveClass('border-info', 'bg-[var(--color-info-bg)]')
    expect(token?.querySelector('[data-file-token-icon="code"]')).not.toHaveClass('border-info', 'bg-background')
    openFileTokenPopover(container)
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('TS')
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('3 KB')
  })

  it('extends file tokens with keyboard-reachable interactive actions without changing the shared chip scale', () => {
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
              type: FILE_TYPE.TEXT
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
    expect(token).toHaveClass('h-6', 'font-medium', 'text-xs', 'leading-[inherit]')
    expect(token).toHaveAttribute('data-file-token-variant', 'text')
    expect(token).toHaveClass(
      'group-focus-visible:ring-[3px]',
      'group-focus-visible:ring-ring/50',
      'group-data-[state=open]:ring-1',
      'group-data-[state=open]:ring-ring/50'
    )
    const trigger = getFileTokenTrigger(container)
    expect(trigger).toHaveAttribute('role', 'button')
    expect(trigger).toHaveAttribute('tabindex', '0')
    expect(trigger).toHaveAccessibleName('已粘贴的文本.txt')
    expect(trigger).toHaveClass('group', 'outline-none')
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
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('已粘贴的文本.txt')
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('TXT')
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('23 KB')
    const showInInputButton = screen.getByRole('button', { name: '在文本框中显示' })
    expect(showInInputButton).toBeInTheDocument()
    const actionContainer = document.querySelector('[data-file-token-actions]')!
    expect(actionContainer).toHaveClass('grid', 'grid-cols-[minmax(0,1fr)_auto]', 'gap-y-1')
    const actionButtons = Array.from(actionContainer.querySelectorAll('button'))
    expect(actionButtons[0]).toHaveAttribute('aria-label', '删除')
    expect(actionButtons[0]).toHaveFocus()
    expect(actionButtons[0]).toHaveClass('size-6', 'rounded-md')
    expect(actionButtons[0]).not.toHaveClass('size-7')
    expect(actionButtons[0]).not.toHaveClass('rounded-full')
    expect(actionButtons[1]).toHaveTextContent('在文本框中显示')

    fireEvent.blur(trigger, { relatedTarget: showInInputButton })
    fireEvent.focus(showInInputButton)
    expect(screen.getByTestId('composer-token-popover')).toHaveAttribute('data-open', 'true')

    fireEvent.click(showInInputButton)
    expect(onShowInInput).toHaveBeenCalledTimes(1)

    fireEvent.click(actionButtons[0])
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('delays file token popover hover transitions so adjacent tokens do not steal the preview immediately', async () => {
    vi.useFakeTimers()

    try {
      const onRemove = vi.fn()
      const { container } = render(
        <>
          <button type="button">Before token</button>
          <FileComposerToken
            token={{ id: 'file:1', kind: 'file', label: 'notes.md' }}
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
          <FileComposerToken token={{ id: 'file:1', kind: 'file', label: 'notes.md' }} />
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
    expect(token).toHaveClass('border-primary', 'ring-1', 'ring-ring')
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
    const tooltipBody = screen.getByTestId('composer-token-tooltip-content').firstElementChild as HTMLElement
    expect(tooltipBody).toHaveClass('whitespace-pre-wrap', 'text-left', 'overflow-hidden')
    expect(tooltipBody.className).toContain('[-webkit-line-clamp:4]')
  })

  it('renders file token details in a popover', () => {
    const { container } = render(<ComposerToken token={{ id: 'file:1', kind: 'file', label: 'notes.md' }} />)

    openFileTokenPopover(container)
    expect(screen.getByTestId('composer-token-popover-content')).toHaveTextContent('notes.md')
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

  it('keeps long quoted tooltip content and clamps it visually', () => {
    const quotedContent = `${'a'.repeat(199)}😀tail`

    render(
      <ComposerToken
        token={{
          id: 'quote:1',
          kind: 'quote',
          label: 'Quote',
          description: quotedContent,
          promptText: quotedContent
        }}
      />
    )

    expect(screen.getByTestId('composer-token-tooltip-content')).toHaveTextContent(quotedContent)
    expect(screen.getByTestId('composer-token-tooltip-content')).not.toHaveTextContent(`${'a'.repeat(199)}😀...`)
    const tooltipBody = screen.getByTestId('composer-token-tooltip-content').firstElementChild as HTMLElement
    expect(tooltipBody.className).toContain('[-webkit-line-clamp:4]')
  })

  it('renders skill tokens as colored inline text', () => {
    const { container } = render(<ComposerToken token={{ id: 'skill:pdf', kind: 'skill', label: 'pdf' }} />)

    const token = container.querySelector('[data-composer-token-kind="skill"]')
    expect(token).toBeInTheDocument()
    expect(token).toHaveClass('text-primary', 'leading-[inherit]')
    expect(token).not.toHaveClass('border-0', 'bg-transparent', 'rounded-md', 'px-1.5', 'py-0.5', 'ring-1')
    expect(token?.querySelector('svg')).toHaveClass('text-current', 'opacity-80')
    expect(token?.querySelector('svg')?.parentElement).toHaveClass('translate-y-[0.08em]')
  })

  it('shows a skill token popover with a remove action and no description', () => {
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

    expect(container.querySelector('[data-composer-token-kind="skill"]')).toHaveClass('group-data-[state=open]:ring-1')

    openTokenPopover(container, 'skill')

    const content = screen.getByTestId('composer-token-popover-content')
    expectTokenPopoverUsesPreviewCardShell(content)
    expect(content).toHaveTextContent('PDF Reader')
    expect(content).not.toHaveTextContent('Read and summarize PDF files.')
    expect(content).not.toHaveTextContent('Use the PDF Reader skill.')

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('shows a knowledge token popover with a remove action and no description', () => {
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

    expect(container.querySelector('[data-composer-token-kind="knowledge"]')).toHaveClass(
      'group-data-[state=open]:ring-1'
    )

    openTokenPopover(container, 'knowledge')

    const content = screen.getByTestId('composer-token-popover-content')
    expectTokenPopoverUsesPreviewCardShell(content)
    expect(content).toHaveTextContent('Product Docs')
    expect(content).toHaveTextContent('chat.input.knowledge_base')
    expect(content).not.toHaveTextContent('Release notes and product specifications.')

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('renders prompt variable tokens with text color and selected underline', () => {
    const { rerender } = render(<ComposerToken token={promptVariableToken} />)

    const token = screen.getByText('city').closest('[data-composer-token-kind="promptVariable"]')
    expect(token).toHaveClass('text-info')
    expect(token).not.toHaveClass('border-info/30', 'bg-info/10', 'rounded-md', 'ring-1')

    rerender(<ComposerToken token={promptVariableToken} selected />)

    const selectedToken = screen.getByText('city').closest('[data-composer-token-kind="promptVariable"]')
    expect(selectedToken).toHaveClass('text-primary', 'underline', 'decoration-primary/40', 'underline-offset-2')
    expect(selectedToken).not.toHaveClass('border-info/30', 'bg-info/10', 'rounded-md', 'ring-1')
  })

  it('rejects unsupported token kinds', () => {
    expect(() =>
      render(<ComposerToken token={{ id: 'reference:docs', kind: 'reference', label: 'Docs' } as never} />)
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

  it('lets completed prompt variable tokens wrap without truncating their label', () => {
    const longLabel = '上海市浦东新区世纪大道'.repeat(5)

    const { container } = render(
      <PromptVariableToken
        token={{
          ...promptVariableToken,
          label: longLabel,
          promptText: longLabel
        }}
        onCommit={vi.fn()}
      />
    )

    const token = container.querySelector('[data-composer-token-kind="promptVariable"]')
    const label = screen.getByText(longLabel)

    expect(token).toHaveClass('max-w-full')
    expect(token).not.toHaveClass('max-w-52')
    expect(label).toHaveClass('min-w-0', 'whitespace-pre-wrap', 'wrap-anywhere')
    expect(label).not.toHaveClass('truncate')
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
    expect(input).toHaveClass(
      'field-sizing-content',
      'min-w-0',
      'max-w-full',
      'resize-none',
      'overflow-hidden',
      'whitespace-pre-wrap',
      'wrap-anywhere'
    )
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

    await waitFor(() => expect(container.querySelector('[data-popover-trigger="true"]')).toBeInTheDocument())
    openFileTokenPopover(container)
    const removeButton = screen.getByTestId('composer-token-popover-content').querySelector('button')
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

    await waitFor(() => expect(container.querySelector('[data-popover-trigger="true"]')).toBeInTheDocument())
    openTokenPopover(container, 'knowledge')
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

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
})
