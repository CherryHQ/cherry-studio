import { Blocks, Boxes, FileText, Folder, Link2, MessagesSquare, TextQuote, ToolCase, X } from 'lucide-react'
import { MousePointer2 } from 'lucide-react'
import {
  type ComponentPropsWithoutRef,
  type ComponentType,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MouseEventHandler,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button, NormalTooltip, Popover, PopoverContent, PopoverTrigger, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  getQuoteTooltipContent,
  QUOTE_TOOLTIP_BODY_CLASS_NAME,
  QUOTE_TOOLTIP_CONTENT_CLASS_NAME
} from '@renderer/components/composer/quoteToken'
import { BracesVariableIcon } from '@renderer/components/icons/BracesVariableIcon'
import Favicon from '@renderer/components/icons/FallbackFavicon'
import { ipcApi } from '@renderer/ipc'
import { ImagePreviewService } from '@renderer/services/ImagePreviewService'
import { COMPOSER_FILE_KIND, type ComposerFileKind, FILE_TYPE } from '@renderer/types/file'
import { formatFileSize } from '@renderer/utils/file'
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { AbsoluteFilePath, FileUrlString } from '@shared/types/file'
import { fileUrlToPath } from '@shared/utils/file'

import type { ChatInputTokenKind, ChatTokenView } from '../chatTokenView'
import type { ComposerInputFilePreviewAction } from '../filePreview'
import { parseComposerLink } from '../linkToken'
import { type FileTokenPresentation, getFileTokenPresentation } from './fileTokenPresentation'

const tokenIconClassName = 'size-[1em] shrink-0 text-current opacity-80'
const tokenRemoveIconClassName = 'size-[0.95em] shrink-0 text-current'

// Keep chip geometry em-based and baseline-aligned so tokens follow prose size.
// Selection uses an inset ring so it does not change the line height.
const composerChipClassName = cn(
  'group/composer-token mx-0.5 inline-flex max-w-[calc(100%_-_0.25rem)] items-baseline gap-1',
  'rounded-xs bg-muted px-1.5',
  'text-foreground font-medium select-none transition-colors',
  'group-focus-visible:ring-1 group-focus-visible:ring-inset group-focus-visible:ring-ring'
)

// `translate-y` (/not `vertical-align`) nudges the glyph optically below the baseline: inside the
// flex line the icon box sits on the baseline, which would read as a superscript for 1em icons.
const composerChipIconBoxClassName =
  'text-muted-foreground inline-flex size-[0.9em] shrink-0 translate-y-[0.1em] items-center justify-center'
const composerChipIconClassName = 'size-full shrink-0 text-current'
// A token may carry its own icon node (the agent file/folder mentions pass 16px glyphs), which would
// overflow the 0.9em slot; the wrapper pins the provided glyph to the slot without touching the
// remove button's own icon, which is a sibling of this wrapper.
const composerChipProvidedIconClassName =
  'inline-flex size-full items-center justify-center [&>svg]:size-full [&>img]:size-full'
const composerChipLabelClassName = 'max-w-full min-w-0 truncate break-normal whitespace-nowrap! leading-[inherit]'
const composerChipRemoveButtonClassName =
  '-inset-0.5 size-auto rounded-xs bg-transparent text-foreground hover:text-foreground focus-visible:text-foreground dark:text-foreground'
const composerChipRemoveIconClassName = 'size-[1em]'

// 链接 chip 的图标槽：站点图标填满 1em（图片和 FallbackFavicon 自带的方块兜底都交给子选择器撑满）
const composerLinkFaviconClassName =
  'inline-flex size-[1em] shrink-0 items-center justify-center overflow-hidden rounded-xs [&>img]:block [&>img]:size-full! [&>img]:object-contain [&>span]:size-full!'

const TOKEN_POPOVER_OPEN_DELAY_MS = 120
const TOKEN_POPOVER_CLOSE_DELAY_MS = 160
const TOKEN_TOOLTIP_DELAY_MS = 300
const PASTED_TEXT_PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000
const PASTED_TEXT_PREVIEW_CACHE_MAX_ENTRIES = 64
type TokenPopoverOpenReason = 'keyboard' | 'pointer'
const tokenPreviewHeaderClassName =
  'flex h-20 items-center justify-center border-border-subtle border-b bg-[repeating-linear-gradient(135deg,var(--border-subtle)_0,var(--border-subtle)_1px,transparent_1px,transparent_8px)] bg-muted'
const pastedTextPreviewCache = new Map<string, { expiresAt: number; request: Promise<string> }>()

const tokenIconByKind: Record<ChatInputTokenKind, ReactNode> = {
  skill: <ToolCase className={tokenIconClassName} />,
  link: <Link2 className={tokenIconClassName} />,
  file: <FileText className={tokenIconClassName} />,
  folder: <Folder className={tokenIconClassName} />,
  knowledge: <Boxes className={tokenIconClassName} />,
  reference: <MessagesSquare className={tokenIconClassName} />,
  quote: <TextQuote className={tokenIconClassName} />,
  webviewAnnotation: <MousePointer2 className={tokenIconClassName} />,
  promptVariable: <BracesVariableIcon className={tokenIconClassName} />,
  messagePart: <Blocks className={tokenIconClassName} />
}

function stopTokenActionEvent(event: ReactMouseEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
}

export interface ComposerTokenProps {
  token: ChatTokenView
  readOnly?: boolean
  readOnlyFilePreview?: ReadOnlyComposerFileTokenPreview
  onReadOnlyFilePreviewActivate?: (
    preview: ReadOnlyComposerFileTokenPreview,
    token: ChatTokenView
  ) => void | Promise<void>
  onFilePreviewActivate?: ComposerInputFilePreviewAction
  selected?: boolean
  className?: string
  children?: ReactNode
  maxWidthClassName?: string
  onMouseDown?: MouseEventHandler<HTMLSpanElement>
  onRemove?: () => void
  onOpenLink?: (url: string) => void | Promise<void>
  removeLabel?: string
}

export interface ReadOnlyComposerFileTokenPreview {
  url?: string
  fileEntryId?: string
  mediaType?: string
  composerFileKind?: ComposerFileKind
  originalPath?: AbsoluteFilePath
}

interface FileComposerTokenProps extends ComposerTokenProps {
  tooltipActions?: ReactNode
}

interface ActiveComposerTokenProps extends ComposerTokenProps {
  icon: ReactNode
  colorClassName?: string
  /** Set when a richer hover surface (NormalTooltip) wraps the chip, so the native title would double up. */
  hideNativeTitle?: boolean
  interactionProps?: {
    href?: string
    role: 'link'
    tabIndex: number
    'aria-label': string
    onClick: MouseEventHandler<HTMLSpanElement>
    onKeyDown: (event: ReactKeyboardEvent<HTMLSpanElement>) => void
  }
}

function InlineTokenRemoveButton({
  label,
  onRemove,
  className,
  iconClassName
}: {
  label: string
  onRemove: () => void
  className?: string
  iconClassName?: string
}) {
  const handleRemove = (event: ReactMouseEvent<HTMLButtonElement>) => {
    stopTokenActionEvent(event)
    onRemove()
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      data-composer-token-remove=""
      className={cn(
        'pointer-events-none absolute inset-0 size-auto min-h-0 border-0 bg-transparent p-0 text-[length:inherit] text-current leading-none opacity-0 transition-opacity dark:text-current',
        'hover:bg-transparent hover:text-current focus-visible:bg-transparent focus-visible:text-current',
        'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
        'hover:opacity-100',
        'focus-visible:pointer-events-auto focus-visible:opacity-100',
        'group-focus-within/composer-token:pointer-events-auto group-focus-within/composer-token:opacity-100 group-hover/composer-token:pointer-events-auto group-hover/composer-token:opacity-100',
        className
      )}
      onMouseDown={stopTokenActionEvent}
      onClick={handleRemove}
      onKeyDown={(event) => event.stopPropagation()}>
      <X className={cn(tokenRemoveIconClassName, iconClassName)} aria-hidden />
    </Button>
  )
}

function InlineTokenIconSlot({
  icon,
  removeLabel,
  onRemove,
  slotClassName,
  removeButtonClassName,
  removeIconClassName
}: {
  icon: ReactNode
  removeLabel?: string
  onRemove?: () => void
  slotClassName?: string
  removeButtonClassName?: string
  removeIconClassName?: string
}) {
  if (!onRemove) return icon

  // The remove button overlays the icon (absolute) instead of sitting beside it in
  // flow, so it never occupies half of the fixed-size icon slot and shift the icon.
  // Icon and button cross-fade via opacity (not display) to keep the slot from
  // collapsing and to keep the button keyboard-focusable.
  return (
    <span className={cn('relative inline-flex shrink-0', slotClassName)}>
      {/* The icon wrapper must own a size too: every glyph inside fills "100% of its parent", so
          without it the box stays auto-sized and the glyph falls back to its intrinsic size (a
          lucide icon defaults to 24px, which is what made the folder token look oversized). */}
      <span className="inline-flex size-full shrink-0 transition-opacity group-focus-within/composer-token:opacity-0 group-hover/composer-token:opacity-0">
        {icon}
      </span>
      <InlineTokenRemoveButton
        label={removeLabel ?? 'Remove'}
        onRemove={onRemove}
        className={removeButtonClassName}
        iconClassName={removeIconClassName}
      />
    </span>
  )
}

function renderActiveComposerTokenElement({
  token,
  readOnly = false,
  selected = false,
  className,
  children,
  maxWidthClassName = 'max-w-[calc(100%_-_0.25rem)]',
  onMouseDown,
  onRemove,
  removeLabel,
  icon,
  colorClassName = 'text-primary',
  hideNativeTitle = false,
  interactionProps
}: ActiveComposerTokenProps) {
  const title =
    hideNativeTitle || token.kind === 'quote' ? undefined : (token.description ?? token.promptText ?? token.label)
  const Element = interactionProps?.href ? 'a' : 'span'

  return (
    <Element
      className={cn(
        'group/composer-token mx-0.5 inline-flex select-none items-baseline gap-1 align-baseline leading-[inherit]',
        maxWidthClassName,
        colorClassName,
        readOnly && 'focus-visible:underline focus-visible:underline-offset-2 focus-visible:outline-none',
        selected && 'text-primary underline decoration-primary/40 underline-offset-2',
        className
      )}
      title={title}
      data-composer-token-kind={token.kind}
      onMouseDown={onMouseDown}
      {...interactionProps}>
      <span className="inline-flex shrink-0 translate-y-[0.08em] items-baseline text-current leading-[inherit]">
        <InlineTokenIconSlot
          icon={token.icon ? token.icon : icon}
          removeLabel={removeLabel}
          onRemove={onRemove}
          removeButtonClassName="size-[1em] rounded-[4px]"
        />
      </span>
      {children ?? <span className="min-w-0 truncate">{token.label}</span>}
    </Element>
  )
}

function ActiveComposerToken(props: ActiveComposerTokenProps) {
  return renderActiveComposerTokenElement(props)
}

export function SkillComposerToken(props: ComposerTokenProps) {
  return renderActiveComposerTokenElement({
    ...props,
    icon: tokenIconByKind.skill
  })
}

export function LinkComposerToken(props: ComposerTokenProps) {
  const link = parseComposerLink(props.token.promptText ?? props.token.description)
  if (!link) {
    return renderActiveComposerTokenElement({
      ...props,
      icon: tokenIconByKind.link,
      colorClassName: 'text-link'
    })
  }

  const openLink = (modified: boolean) => {
    if (!modified && props.onOpenLink) void props.onOpenLink(link.url)
    else void ipcApi.request('system.shell.open_website', link.url)
  }
  const handleClick: MouseEventHandler<HTMLSpanElement> = (event) => {
    stopTokenActionEvent(event)
    openLink(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    openLink(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
  }

  // The chip only shows the truncated label; hover must surface the full url the label stands for.
  const chipElement = renderActiveComposerTokenElement({
    ...props,
    colorClassName: 'text-link',
    className: cn('cursor-pointer rounded-[4px] focus-visible:bg-accent focus-visible:outline-none', props.className),
    // 编辑态也和只读态一样显示站点图标；拿不到图标时退回链接字形（而不是首字母方块），
    // 这样编辑中的链接和已发送消息里的链接长得一样。
    icon: (
      <span className={composerLinkFaviconClassName} data-composer-link-favicon="">
        <Favicon hostname={link.hostname} alt="" fallback={tokenIconByKind.link} />
      </span>
    ),
    children: <span className="min-w-0 truncate">{link.label}</span>,
    hideNativeTitle: true,
    interactionProps: {
      href: props.readOnly ? link.url : undefined,
      role: 'link',
      tabIndex: 0,
      'aria-label': link.url,
      onClick: handleClick,
      onKeyDown: handleKeyDown
    }
  })

  return (
    <NormalTooltip content={link.url} side="top" sideOffset={6} delayDuration={TOKEN_TOOLTIP_DELAY_MS}>
      {chipElement}
    </NormalTooltip>
  )
}

function isComposerAttachment(value: unknown): value is ComposerAttachment {
  return typeof value === 'object' && value !== null
}

function shouldShowFileTokenPopover(file: ComposerAttachment | undefined) {
  return file?.type === FILE_TYPE.IMAGE || file?.composerFileKind === COMPOSER_FILE_KIND.PASTED_TEXT
}

function readPastedTextPreview(path: string) {
  const now = Date.now()
  const cached = pastedTextPreviewCache.get(path)
  if (cached && cached.expiresAt > now) {
    pastedTextPreviewCache.delete(path)
    pastedTextPreviewCache.set(path, cached)
    return cached.request
  }
  if (cached) pastedTextPreviewCache.delete(path)

  const request = window.api.fs.readText(path).catch((error) => {
    if (pastedTextPreviewCache.get(path)?.request === request) {
      pastedTextPreviewCache.delete(path)
    }
    throw error
  })
  pastedTextPreviewCache.set(path, { expiresAt: now + PASTED_TEXT_PREVIEW_CACHE_TTL_MS, request })

  while (pastedTextPreviewCache.size > PASTED_TEXT_PREVIEW_CACHE_MAX_ENTRIES) {
    const oldestPath = pastedTextPreviewCache.keys().next().value
    if (oldestPath === undefined) break
    pastedTextPreviewCache.delete(oldestPath)
  }

  return request
}

function getReadOnlyFilePreviewPath(readOnlyFilePreview: ReadOnlyComposerFileTokenPreview | undefined) {
  if (!readOnlyFilePreview?.url) return undefined

  try {
    return normalizeFilePreviewPath(fileUrlToPath(readOnlyFilePreview.url as FileUrlString))
  } catch {
    return undefined
  }
}

function getEditableFilePreviewPath(file: ComposerAttachment | undefined) {
  if (!file?.path) return undefined

  try {
    return normalizeFilePreviewPath(file.path)
  } catch {
    return undefined
  }
}

function getPastedTextPreviewPath(
  file: ComposerAttachment | undefined,
  readOnlyFilePreview: ReadOnlyComposerFileTokenPreview | undefined
) {
  return getReadOnlyFilePreviewPath(readOnlyFilePreview) ?? file?.path
}

function TokenPathTooltipContent({ path, sizeLabel }: { path: string; sizeLabel?: string }) {
  return (
    <span className="inline-flex max-w-full items-start gap-2.5 text-left" data-token-path-tooltip="">
      <span className="min-w-0 break-all" data-token-path="">
        {path}
      </span>
      {sizeLabel && (
        <span className="shrink-0" data-token-size="">
          {sizeLabel}
        </span>
      )}
    </span>
  )
}

function PastedTextTokenPreviewCard({
  file,
  readOnlyFilePreview,
  secondaryAction
}: {
  file: ComposerAttachment | undefined
  readOnlyFilePreview?: ReadOnlyComposerFileTokenPreview
  secondaryAction?: ReactNode
}) {
  const [previewText, setPreviewText] = useState('')
  const previewPath = getPastedTextPreviewPath(file, readOnlyFilePreview)

  useEffect(() => {
    if (!previewPath) return

    let disposed = false
    void readPastedTextPreview(previewPath)
      .then((text) => {
        if (!disposed) setPreviewText(text)
      })
      .catch(() => {
        if (!disposed) setPreviewText('')
      })

    return () => {
      disposed = true
    }
  }, [previewPath])

  return (
    <div className="w-80 overflow-hidden text-left">
      <Scrollbar className="max-h-44 min-h-24 overflow-x-hidden bg-muted/50" data-file-token-text-scrollbar="">
        <pre className="m-0 whitespace-pre-wrap break-words p-3 font-[inherit] text-popover-foreground text-xs leading-5">
          {previewText}
        </pre>
      </Scrollbar>
      {secondaryAction && (
        <div className="flex justify-end border-border-subtle border-t p-2" data-file-token-actions="">
          {secondaryAction}
        </div>
      )}
    </div>
  )
}

function FileTokenPreviewCard({
  file,
  label,
  presentation,
  readOnlyFilePreview,
  secondaryAction
}: {
  file: ComposerAttachment | undefined
  label: string
  presentation: FileTokenPresentation
  readOnlyFilePreview?: ReadOnlyComposerFileTokenPreview
  secondaryAction?: ReactNode
}) {
  const { t } = useTranslation()
  const sizeLabel = typeof file?.size === 'number' ? formatFileSize(file.size) : undefined
  const hasActions = Boolean(secondaryAction)
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string>()
  const hasFailedPreview = Boolean(presentation.previewUrl && presentation.previewUrl === failedPreviewUrl)
  const previewUrl = hasFailedPreview ? undefined : presentation.previewUrl

  if (file?.composerFileKind === COMPOSER_FILE_KIND.PASTED_TEXT) {
    return (
      <PastedTextTokenPreviewCard
        file={file}
        readOnlyFilePreview={readOnlyFilePreview}
        secondaryAction={secondaryAction}
      />
    )
  }

  if (previewUrl) {
    return (
      <div className="flex max-h-48 max-w-60 overflow-hidden bg-muted text-left" data-file-token-image-preview="">
        <img
          src={previewUrl}
          alt={label}
          className="block max-h-48 max-w-60 object-contain"
          onError={() => setFailedPreviewUrl(previewUrl)}
        />
      </div>
    )
  }

  if (hasFailedPreview) {
    return (
      <div
        className="bg-muted px-5 py-4 text-center text-muted-foreground text-sm"
        data-file-token-image-preview-error="">
        {t('chat.input.image_preview_failed')}
      </div>
    )
  }

  return (
    <div className="w-72 overflow-hidden text-left">
      <div className={tokenPreviewHeaderClassName}>
        <span className="text-muted-foreground inline-flex size-12 items-center justify-center rounded-xl bg-background">
          {presentation.previewIcon}
        </span>
      </div>
      <div className="space-y-2.5 p-3">
        <div
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1"
          data-file-token-actions={hasActions ? '' : undefined}>
          <div className="flex h-6 min-w-0 items-center">
            <span className="truncate font-semibold text-popover-foreground text-sm leading-5">{label}</span>
          </div>
          <div className="flex min-h-4 min-w-0 items-center gap-1.5 text-muted-foreground text-xs leading-4">
            <span className="shrink-0 font-medium uppercase">{presentation.typeLabel}</span>
            {sizeLabel && (
              <>
                <span className="text-foreground-tertiary">·</span>
                <span className="shrink-0">{sizeLabel}</span>
              </>
            )}
          </div>
          {secondaryAction && (
            <div className="flex min-h-4 shrink-0 items-center justify-end" onMouseDown={stopTokenActionEvent}>
              {secondaryAction}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface ComposerTokenHoverPopoverProps {
  trigger: ReactNode
  content: ReactNode | ((controls: { closePopover: () => void }) => ReactNode)
  ariaLabel: string
  contentClassName?: string
  onActivate?: () => void
}

function ComposerTokenHoverPopover({
  trigger,
  content,
  ariaLabel,
  contentClassName,
  onActivate
}: ComposerTokenHoverPopoverProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const popoverOpenReasonRef = useRef<TokenPopoverOpenReason>('pointer')

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current === null) return
    window.clearTimeout(openTimerRef.current)
    openTimerRef.current = null
  }, [])

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const openPopover = useCallback(
    (reason: TokenPopoverOpenReason = 'pointer') => {
      popoverOpenReasonRef.current = reason
      clearOpenTimer()
      clearCloseTimer()
      setPopoverOpen(true)
    },
    [clearCloseTimer, clearOpenTimer]
  )

  const closePopover = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    setPopoverOpen(false)
  }, [clearCloseTimer, clearOpenTimer])

  const openPointerPopover = useCallback(() => {
    openPopover('pointer')
  }, [openPopover])

  const scheduleOpenPopover = useCallback(() => {
    clearCloseTimer()
    if (popoverOpen || openTimerRef.current !== null) return
    popoverOpenReasonRef.current = 'pointer'

    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null
      setPopoverOpen(true)
    }, TOKEN_POPOVER_OPEN_DELAY_MS)
  }, [clearCloseTimer, popoverOpen])

  const scheduleClosePopover = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      setPopoverOpen(false)
      closeTimerRef.current = null
    }, TOKEN_POPOVER_CLOSE_DELAY_MS)
  }, [clearCloseTimer, clearOpenTimer])

  const markPointerOpenReason = useCallback(() => {
    popoverOpenReasonRef.current = 'pointer'
  }, [])

  const handlePopoverOpenChange = useCallback(
    (open: boolean) => {
      if (open && popoverOpenReasonRef.current !== 'keyboard') {
        popoverOpenReasonRef.current = 'pointer'
      }
      clearOpenTimer()
      clearCloseTimer()
      setPopoverOpen(open)
    },
    [clearCloseTimer, clearOpenTimer]
  )

  const handlePopoverOpenAutoFocus = useCallback((event: Event) => {
    if (popoverOpenReasonRef.current !== 'keyboard') {
      event.preventDefault()
    }
  }, [])

  const handlePopoverCloseAutoFocus = useCallback((event: Event) => {
    if (popoverOpenReasonRef.current !== 'keyboard') {
      event.preventDefault()
    }
  }, [])

  const isFocusWithinPopover = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Node)) return false
    return Boolean(triggerRef.current?.contains(target) || contentRef.current?.contains(target))
  }, [])

  const handleTriggerBlur = useCallback(
    (event: ReactFocusEvent<HTMLElement>) => {
      if (isFocusWithinPopover(event.relatedTarget)) return
      scheduleClosePopover()
    },
    [isFocusWithinPopover, scheduleClosePopover]
  )

  const handleContentBlur = useCallback(
    (event: ReactFocusEvent<HTMLElement>) => {
      if (isFocusWithinPopover(event.relatedTarget)) return
      scheduleClosePopover()
    },
    [isFocusWithinPopover, scheduleClosePopover]
  )

  const handleTriggerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if ((event.target as HTMLElement | null)?.closest('[data-composer-token-remove]')) return

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        if (onActivate) {
          closePopover()
          onActivate()
          return
        }
        openPopover('keyboard')
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closePopover()
      }
    },
    [closePopover, onActivate, openPopover]
  )

  const handleTriggerClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!onActivate || (event.target as HTMLElement | null)?.closest('[data-composer-token-remove]')) return

      stopTokenActionEvent(event)
      closePopover()
      onActivate()
    },
    [closePopover, onActivate]
  )

  useEffect(
    () => () => {
      clearOpenTimer()
      clearCloseTimer()
    },
    [clearCloseTimer, clearOpenTimer]
  )

  const tokenElement = (
    <span
      ref={triggerRef}
      className="group inline align-baseline outline-none"
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onMouseEnter={scheduleOpenPopover}
      onMouseLeave={scheduleClosePopover}
      onMouseMove={scheduleOpenPopover}
      onPointerDown={markPointerOpenReason}
      onClick={handleTriggerClick}
      onBlur={handleTriggerBlur}
      onKeyDownCapture={handleTriggerKeyDown}>
      {trigger}
    </span>
  )

  return (
    <Popover open={popoverOpen} onOpenChange={handlePopoverOpenChange}>
      <PopoverTrigger asChild>{tokenElement}</PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        side="top"
        align="start"
        sideOffset={8}
        className={cn('w-fit max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl p-0 shadow-xl', contentClassName)}
        onMouseEnter={openPointerPopover}
        onMouseLeave={scheduleClosePopover}
        onFocus={clearCloseTimer}
        onBlur={handleContentBlur}
        onOpenAutoFocus={handlePopoverOpenAutoFocus}
        onCloseAutoFocus={handlePopoverCloseAutoFocus}>
        {typeof content === 'function' ? content({ closePopover }) : content}
      </PopoverContent>
    </Popover>
  )
}

interface ComposerTokenActivationTriggerProps extends Omit<ComponentPropsWithoutRef<'span'>, 'aria-label'> {
  children: ReactNode
  ariaLabel: string
  onActivate: () => void | Promise<void>
}

const ComposerTokenActivationTrigger = function ComposerTokenActivationTrigger({
  ref,
  children,
  ariaLabel,
  onActivate,
  ...triggerProps
}: ComposerTokenActivationTriggerProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement | null)?.closest('[data-composer-token-remove]')) return

      stopTokenActionEvent(event)
      void onActivate()
    },
    [onActivate]
  )
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if ((event.target as HTMLElement | null)?.closest('[data-composer-token-remove]')) return
      if (event.key !== 'Enter' && event.key !== ' ') return

      event.preventDefault()
      event.stopPropagation()
      void onActivate()
    },
    [onActivate]
  )

  return (
    <span
      {...triggerProps}
      ref={ref}
      className={cn('inline align-baseline outline-none', triggerProps.className)}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={handleClick}
      onKeyDownCapture={handleKeyDown}>
      {children}
    </span>
  )
}

export function FileComposerToken(props: FileComposerTokenProps) {
  const {
    onFilePreviewActivate,
    onReadOnlyFilePreviewActivate,
    onRemove,
    readOnly,
    readOnlyFilePreview,
    removeLabel: removeLabelProp,
    token,
    tooltipActions
  } = props
  const tokenFile = isComposerAttachment(token.payload) ? token.payload : undefined
  const previewFileType = readOnlyFilePreview?.mediaType?.startsWith('image/') ? FILE_TYPE.IMAGE : undefined
  const file = readOnlyFilePreview
    ? ({
        ...tokenFile,
        ...(!tokenFile?.type && previewFileType && { type: previewFileType }),
        ...(readOnlyFilePreview.composerFileKind && {
          composerFileKind: readOnlyFilePreview.composerFileKind
        })
      } as ComposerAttachment)
    : tokenFile
  const label = file?.origin_name || file?.name || token.label
  const imagePreviewUrl = readOnlyFilePreview?.mediaType?.startsWith('image/') ? readOnlyFilePreview.url : undefined
  const [blobPreview, setBlobPreview] = useState<{ blob: Blob; url: string }>()
  const blob = file?.blob
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setBlobPreview({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
  const presentation = getFileTokenPresentation(
    file,
    label,
    imagePreviewUrl ?? (blobPreview?.blob === blob ? blobPreview?.url : undefined)
  )
  const openImagePreview = useCallback(() => {
    if (!presentation.previewUrl) return
    void ImagePreviewService.show(blob ?? presentation.previewUrl)
  }, [blob, presentation.previewUrl])
  const activateReadOnlyFilePreview = useCallback(() => {
    if (!readOnlyFilePreview || !onReadOnlyFilePreviewActivate) return
    return onReadOnlyFilePreviewActivate(readOnlyFilePreview, token)
  }, [onReadOnlyFilePreviewActivate, readOnlyFilePreview, token])
  const readOnlyFilePreviewActivation =
    readOnly && readOnlyFilePreview?.url && onReadOnlyFilePreviewActivate ? activateReadOnlyFilePreview : undefined
  const title = token.description ?? token.promptText ?? label
  const accessibleTitle = readOnly ? label : title
  const removeLabel = removeLabelProp ?? 'Remove'
  const shouldShowPopover = shouldShowFileTokenPopover(file) && (!readOnly || Boolean(readOnlyFilePreview?.url))
  const readOnlyFilePreviewPath = getReadOnlyFilePreviewPath(readOnlyFilePreview)
  const pathTooltipPath = readOnly ? (readOnlyFilePreview?.originalPath ?? readOnlyFilePreviewPath) : file?.path
  const filePreviewPath = readOnly ? readOnlyFilePreviewPath : getEditableFilePreviewPath(file)
  const canOpenFilePreview = !readOnlyFilePreviewActivation && Boolean(filePreviewPath && onFilePreviewActivate)
  const openFilePreview = useCallback(() => {
    if (!canOpenFilePreview || !filePreviewPath || !onFilePreviewActivate) return
    return onFilePreviewActivate({
      displayName: label,
      previewPath: filePreviewPath,
      ...(readOnlyFilePreview?.originalPath && { originalPath: readOnlyFilePreview.originalPath }),
      ...(readOnlyFilePreview?.mediaType && { mediaType: readOnlyFilePreview.mediaType }),
      ...((readOnlyFilePreview?.composerFileKind ?? file?.composerFileKind) && {
        composerFileKind: readOnlyFilePreview?.composerFileKind ?? file?.composerFileKind
      })
    })
  }, [canOpenFilePreview, file?.composerFileKind, filePreviewPath, label, onFilePreviewActivate, readOnlyFilePreview])
  const tokenIsDirectPreviewButton = canOpenFilePreview && !shouldShowPopover && !readOnlyFilePreviewActivation
  const handleFilePreviewClick = useCallback(
    (event: ReactMouseEvent<HTMLSpanElement>) => {
      if (!canOpenFilePreview || (event.target as HTMLElement | null)?.closest('[data-composer-token-remove]')) return
      stopTokenActionEvent(event)
      void openFilePreview()
    },
    [canOpenFilePreview, openFilePreview]
  )
  const handleFilePreviewKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLSpanElement>) => {
      if (
        !canOpenFilePreview ||
        (event.target as HTMLElement | null)?.closest('[data-composer-token-remove]') ||
        (event.key !== 'Enter' && event.key !== ' ')
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      void openFilePreview()
    },
    [canOpenFilePreview, openFilePreview]
  )
  const shouldShowPathTooltip = Boolean(pathTooltipPath) && !shouldShowFileTokenPopover(file)
  const tokenIcon = token.icon ?? presentation.icon

  const chipElement = (
    <span
      className={cn(
        composerChipClassName,
        'rounded-md font-normal',
        (readOnly || canOpenFilePreview) &&
          'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
        (canOpenFilePreview || readOnlyFilePreviewActivation) && 'cursor-pointer',
        props.selected && 'ring-1 ring-border-selected ring-inset',
        props.className
      )}
      title={readOnly || shouldShowPathTooltip ? undefined : title}
      data-composer-token-kind={token.kind}
      data-file-token-variant={presentation.variant}
      role={tokenIsDirectPreviewButton ? 'button' : undefined}
      tabIndex={tokenIsDirectPreviewButton ? 0 : undefined}
      aria-label={tokenIsDirectPreviewButton ? accessibleTitle : undefined}
      onClick={tokenIsDirectPreviewButton ? handleFilePreviewClick : undefined}
      onKeyDown={tokenIsDirectPreviewButton ? handleFilePreviewKeyDown : undefined}
      onMouseDown={props.onMouseDown}>
      <span className={composerChipIconBoxClassName} data-file-token-icon={presentation.variant}>
        <InlineTokenIconSlot
          icon={tokenIcon}
          removeLabel={removeLabel}
          onRemove={onRemove}
          slotClassName="size-full items-center justify-center"
          removeButtonClassName={composerChipRemoveButtonClassName}
          removeIconClassName={composerChipRemoveIconClassName}
        />
      </span>
      {props.children ?? <span className={cn(composerChipLabelClassName, props.maxWidthClassName)}>{label}</span>}
    </span>
  )
  const activatedChipElement =
    readOnlyFilePreviewActivation && !shouldShowPopover ? (
      <ComposerTokenActivationTrigger ariaLabel={accessibleTitle} onActivate={readOnlyFilePreviewActivation}>
        {chipElement}
      </ComposerTokenActivationTrigger>
    ) : (
      chipElement
    )

  if (pathTooltipPath && shouldShowPathTooltip) {
    const sizeLabel = typeof file?.size === 'number' ? formatFileSize(file.size) : undefined
    const tooltipContent = <TokenPathTooltipContent path={pathTooltipPath} sizeLabel={sizeLabel} />

    return (
      <NormalTooltip
        content={tooltipContent}
        side="top"
        sideOffset={6}
        delayDuration={TOKEN_TOOLTIP_DELAY_MS}
        triggerProps={readOnly ? { tabIndex: 0, 'aria-label': accessibleTitle } : undefined}>
        {activatedChipElement}
      </NormalTooltip>
    )
  }

  if (readOnly && !shouldShowPopover) {
    const sizeLabel = typeof file?.size === 'number' ? formatFileSize(file.size) : undefined
    const detail = [presentation.typeLabel, sizeLabel].filter(Boolean).join(' · ')

    return (
      <NormalTooltip
        content={<TokenPathTooltipContent path={label} sizeLabel={detail} />}
        side="top"
        sideOffset={6}
        delayDuration={TOKEN_TOOLTIP_DELAY_MS}
        triggerProps={{ tabIndex: 0, 'aria-label': accessibleTitle }}>
        {activatedChipElement}
      </NormalTooltip>
    )
  }

  if (!shouldShowPopover) return activatedChipElement

  return (
    <ComposerTokenHoverPopover
      trigger={chipElement}
      ariaLabel={accessibleTitle}
      contentClassName={presentation.previewUrl ? 'rounded-lg border-0 bg-transparent' : undefined}
      onActivate={
        readOnlyFilePreviewActivation ??
        (canOpenFilePreview ? openFilePreview : presentation.previewUrl ? openImagePreview : undefined)
      }
      content={
        <FileTokenPreviewCard
          file={file}
          label={label}
          presentation={presentation}
          readOnlyFilePreview={readOnlyFilePreview}
          secondaryAction={tooltipActions}
        />
      }
    />
  )
}

export function FolderComposerToken(props: ComposerTokenProps) {
  const title = props.token.promptText ?? props.token.description ?? props.token.label
  const path = props.token.promptText ?? props.token.description
  const removeLabel = props.removeLabel ?? 'Remove'

  const chipElement = (
    <span
      className={cn(
        composerChipClassName,
        props.readOnly &&
          'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
        props.selected && 'ring-1 ring-border-selected ring-inset',
        props.className
      )}
      title={path ? undefined : title}
      data-composer-token-kind={props.token.kind}
      onMouseDown={props.onMouseDown}>
      <span className={composerChipIconBoxClassName} data-folder-token-icon="">
        {/* The slot must carry the size: the default glyph and the provided-icon wrapper both fill
            "100% of the slot", which without it resolves against an auto-sized box and falls back to
            the glyph's own 24px lucide default. */}
        <InlineTokenIconSlot
          icon={
            props.token.icon ? (
              <span className={composerChipProvidedIconClassName}>{props.token.icon}</span>
            ) : (
              <Folder className={composerChipIconClassName} aria-hidden />
            )
          }
          removeLabel={removeLabel}
          onRemove={props.onRemove}
          slotClassName="size-full items-center justify-center"
          removeButtonClassName={composerChipRemoveButtonClassName}
          removeIconClassName={composerChipRemoveIconClassName}
        />
      </span>
      {props.children ?? (
        <span className={cn(composerChipLabelClassName, props.maxWidthClassName)}>{props.token.label}</span>
      )}
    </span>
  )

  if (!path) return chipElement

  return (
    <NormalTooltip
      content={<TokenPathTooltipContent path={path} />}
      side="top"
      sideOffset={6}
      delayDuration={300}
      triggerProps={props.readOnly ? { tabIndex: 0, 'aria-label': props.token.label } : undefined}>
      {chipElement}
    </NormalTooltip>
  )
}

export function KnowledgeComposerToken(props: ComposerTokenProps) {
  return renderActiveComposerTokenElement({
    ...props,
    icon: tokenIconByKind.knowledge
  })
}

export function ReferenceComposerToken(props: ComposerTokenProps) {
  return renderActiveComposerTokenElement({
    ...props,
    icon: tokenIconByKind.reference
  })
}

export function QuoteComposerToken(props: ComposerTokenProps) {
  const quoteTooltipContent = getQuoteTooltipContent(props.token.description, props.token.promptText)
  const tokenElement = renderActiveComposerTokenElement({ ...props, icon: tokenIconByKind.quote })

  if (!quoteTooltipContent) return tokenElement

  return (
    <NormalTooltip
      content={<div className={QUOTE_TOOLTIP_BODY_CLASS_NAME}>{quoteTooltipContent}</div>}
      side="top"
      sideOffset={6}
      delayDuration={300}
      showArrow={false}
      contentProps={{ className: QUOTE_TOOLTIP_CONTENT_CLASS_NAME }}
      triggerProps={props.readOnly ? { tabIndex: 0, 'aria-label': props.token.label } : undefined}>
      {tokenElement}
    </NormalTooltip>
  )
}

export function PromptVariableComposerToken(props: ComposerTokenProps) {
  return <ActiveComposerToken {...props} icon={tokenIconByKind.promptVariable} colorClassName="text-info" />
}

export function WebviewAnnotationComposerToken(props: ComposerTokenProps) {
  return renderActiveComposerTokenElement({ ...props, icon: tokenIconByKind.webviewAnnotation })
}

export function MessagePartComposerToken(props: ComposerTokenProps) {
  return renderActiveComposerTokenElement({ ...props, icon: tokenIconByKind.messagePart })
}

export const composerInputTokenComponentByKind = {
  skill: SkillComposerToken,
  link: LinkComposerToken,
  file: FileComposerToken,
  folder: FolderComposerToken,
  knowledge: KnowledgeComposerToken,
  reference: ReferenceComposerToken,
  quote: QuoteComposerToken,
  promptVariable: PromptVariableComposerToken,
  webviewAnnotation: WebviewAnnotationComposerToken,
  messagePart: MessagePartComposerToken
} satisfies Record<ChatInputTokenKind, ComponentType<ComposerTokenProps>>

export function ComposerToken(props: ComposerTokenProps) {
  const TokenComponent = composerInputTokenComponentByKind[props.token.kind]
  return <TokenComponent {...props} />
}
