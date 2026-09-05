import { NormalTooltip, Popover, PopoverContent, PopoverTrigger, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  getQuoteTooltipContent,
  QUOTE_TOOLTIP_BODY_CLASS_NAME,
  QUOTE_TOOLTIP_CONTENT_CLASS_NAME
} from '@renderer/components/composer/quoteToken'
import { useOptionalOpenFilePreviewTab } from '@renderer/components/FilePreview'
import { BracesVariableIcon } from '@renderer/components/icons/BracesVariableIcon'
import Favicon from '@renderer/components/icons/FallbackFavicon'
import { ipcApi } from '@renderer/ipc'
import { ImagePreviewService } from '@renderer/services/ImagePreviewService'
import { COMPOSER_FILE_KIND, type ComposerFileKind, FILE_TYPE } from '@renderer/types/file'
import { formatFileSize } from '@renderer/utils/file'
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileUrlString } from '@shared/types/file'
import { fileUrlToPath } from '@shared/utils/file'
import { Boxes, FileText, Folder, Link2, MessagesSquare, TextQuote, ToolCase, X } from 'lucide-react'
import {
  type ComponentType,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  lazy,
  type MouseEvent as ReactMouseEvent,
  type MouseEventHandler,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import type { ChatInputTokenKind, ChatTokenView } from '../chatTokenView'
import { parseComposerLink } from '../linkToken'
import { type FileTokenPresentation, getFileTokenPresentation } from './fileTokenPresentation'

const QuoteTokenEditDialog = lazy(() => import('./QuoteTokenEditDialog'))

const tokenIconClassName = 'size-[1em] shrink-0 text-current opacity-80'
const tokenRemoveIconClassName = 'size-[0.95em] shrink-0 text-current'
const TOKEN_POPOVER_OPEN_DELAY_MS = 120
const TOKEN_POPOVER_CLOSE_DELAY_MS = 160
const TOKEN_TOOLTIP_DELAY_MS = 300
type TokenPopoverOpenReason = 'keyboard' | 'pointer'
const tokenPreviewHeaderClassName =
  'flex h-20 items-center justify-center border-border-subtle border-b bg-[repeating-linear-gradient(135deg,var(--border-subtle)_0,var(--border-subtle)_1px,transparent_1px,transparent_8px)] bg-muted'
const pastedTextPreviewCache = new Map<string, Promise<string>>()

const tokenIconByKind: Record<ChatInputTokenKind, ReactNode> = {
  skill: <ToolCase className={tokenIconClassName} />,
  link: <Link2 className={tokenIconClassName} />,
  file: <FileText className={tokenIconClassName} />,
  folder: <Folder className={tokenIconClassName} />,
  knowledge: <Boxes className={tokenIconClassName} />,
  reference: <MessagesSquare className={tokenIconClassName} />,
  quote: <TextQuote className={tokenIconClassName} />,
  promptVariable: <BracesVariableIcon className={tokenIconClassName} />
}

function stopTokenActionEvent(event: ReactMouseEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
}

export interface ComposerTokenProps {
  token: ChatTokenView
  readOnly?: boolean
  readOnlyFilePreview?: ReadOnlyComposerFileTokenPreview
  imageIconPreview?: boolean
  selected?: boolean
  className?: string
  children?: ReactNode
  maxWidthClassName?: string
  onMouseDown?: MouseEventHandler<HTMLSpanElement>
  onEdit?: (content: string) => void
  getEditMaxLength?: () => number
  onRemove?: () => void
  removeLabel?: string
}

export interface ReadOnlyComposerFileTokenPreview {
  url?: string
  mediaType?: string
  composerFileKind?: ComposerFileKind
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
  overlay = true,
  className,
  iconClassName
}: {
  label: string
  onRemove: () => void
  overlay?: boolean
  className?: string
  iconClassName?: string
}) {
  const handleRemove = (event: ReactMouseEvent<HTMLButtonElement>) => {
    stopTokenActionEvent(event)
    onRemove()
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-composer-token-remove=""
      className={cn(
        'pointer-events-none inline-flex items-center justify-center border-0 bg-transparent p-0 text-current leading-none opacity-0 outline-none transition-opacity',
        overlay && 'absolute inset-0',
        'hover:opacity-100',
        'focus-visible:pointer-events-auto focus-visible:opacity-100',
        'group-focus-within/composer-token:pointer-events-auto group-focus-within/composer-token:opacity-100 group-hover/composer-token:pointer-events-auto group-hover/composer-token:opacity-100',
        className
      )}
      onMouseDown={stopTokenActionEvent}
      onClick={handleRemove}
      onKeyDown={(event) => event.stopPropagation()}>
      <X className={cn(tokenRemoveIconClassName, iconClassName)} aria-hidden />
    </button>
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
      <span className="inline-flex shrink-0 transition-opacity group-focus-within/composer-token:opacity-0 group-hover/composer-token:opacity-0">
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

function FileTokenImageIcon({ previewUrl, fallbackIcon }: { previewUrl?: string; fallbackIcon: ReactNode }) {
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string>()
  if (!previewUrl || previewUrl === failedPreviewUrl) return fallbackIcon

  return (
    <img
      src={previewUrl}
      alt=""
      aria-hidden
      draggable={false}
      className="block size-4.5! shrink-0 object-cover"
      data-file-token-icon-thumbnail=""
      onError={() => setFailedPreviewUrl(previewUrl)}
    />
  )
}

function isSvgFile(file: ComposerAttachment | undefined, label: string) {
  const extension = file?.ext || label.match(/\.[^.]+$/)?.[0] || ''
  return extension.replace(/^\./, '').toLowerCase() === 'svg'
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

  return (
    <span
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
    </span>
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

  const openLink = () => {
    void ipcApi.request('system.shell.open_website', link.url)
  }
  const handleClick: MouseEventHandler<HTMLSpanElement> = (event) => {
    stopTokenActionEvent(event)
    openLink()
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    openLink()
  }

  // The chip only shows the truncated label; hover must surface the full url the label stands for.
  const chipElement = renderActiveComposerTokenElement({
    ...props,
    colorClassName: 'text-link',
    className: cn('cursor-pointer rounded-[4px] focus-visible:bg-accent focus-visible:outline-none', props.className),
    icon: props.readOnly ? (
      <span
        className="inline-flex size-[1em] shrink-0 items-center justify-center overflow-hidden rounded-[4px] [&>img]:block [&>img]:size-full! [&>img]:object-contain [&>span]:size-full!"
        data-composer-link-favicon="">
        <Favicon hostname={link.hostname} alt="" />
      </span>
    ) : (
      tokenIconByKind.link
    ),
    children: <span className="min-w-0 truncate">{link.label}</span>,
    hideNativeTitle: true,
    interactionProps: {
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
  let request = pastedTextPreviewCache.get(path)
  if (!request) {
    request = window.api.fs.readText(path).catch((error) => {
      pastedTextPreviewCache.delete(path)
      throw error
    })
    pastedTextPreviewCache.set(path, request)
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
        <span className="shrink-0 text-neutral-300" data-token-size="">
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
        <span
          className={cn(
            'inline-flex size-12 items-center justify-center rounded-xl bg-background',
            presentation.iconClassName
          )}>
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
        } else {
          openPopover('keyboard')
        }
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

export function FileComposerToken(props: FileComposerTokenProps) {
  const openFilePreviewTab = useOptionalOpenFilePreviewTab()
  const { imageIconPreview = false, onRemove, removeLabel: removeLabelProp, tooltipActions } = props
  const tokenFile = isComposerAttachment(props.token.payload) ? props.token.payload : undefined
  const previewFileType = props.readOnlyFilePreview?.mediaType?.startsWith('image/') ? FILE_TYPE.IMAGE : undefined
  const file = props.readOnlyFilePreview
    ? ({
        ...tokenFile,
        ...(!tokenFile?.type && previewFileType && { type: previewFileType }),
        ...(props.readOnlyFilePreview.composerFileKind && {
          composerFileKind: props.readOnlyFilePreview.composerFileKind
        })
      } as ComposerAttachment)
    : tokenFile
  const label = file?.origin_name || file?.name || props.token.label
  const imagePreviewUrl = props.readOnlyFilePreview?.mediaType?.startsWith('image/')
    ? props.readOnlyFilePreview.url
    : undefined
  const presentation = getFileTokenPresentation(file, label, imagePreviewUrl)
  const openImagePreview = useCallback(() => {
    if (!presentation.previewUrl) return
    void ImagePreviewService.show(presentation.previewUrl)
  }, [presentation.previewUrl])
  const title = props.token.description ?? props.token.promptText ?? label
  const accessibleTitle = props.readOnly ? label : title
  const removeLabel = removeLabelProp ?? 'Remove'
  const shouldShowPopover =
    shouldShowFileTokenPopover(file) && (!props.readOnly || Boolean(props.readOnlyFilePreview?.url))
  const readOnlyFilePreviewPath = getReadOnlyFilePreviewPath(props.readOnlyFilePreview)
  const pathTooltipPath = props.readOnly ? readOnlyFilePreviewPath : file?.path
  const filePreviewPath = props.readOnly ? readOnlyFilePreviewPath : getEditableFilePreviewPath(file)
  const canOpenFilePreview = presentation.variant === 'markdown' && Boolean(filePreviewPath && openFilePreviewTab)
  const openFilePreview = useCallback(() => {
    if (!canOpenFilePreview || !filePreviewPath || !openFilePreviewTab) return
    openFilePreviewTab(filePreviewPath, label)
  }, [canOpenFilePreview, filePreviewPath, label, openFilePreviewTab])
  const handleFilePreviewClick = useCallback(
    (event: ReactMouseEvent<HTMLSpanElement>) => {
      if (!canOpenFilePreview || (event.target as HTMLElement | null)?.closest('[data-composer-token-remove]')) return
      stopTokenActionEvent(event)
      openFilePreview()
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
      openFilePreview()
    },
    [canOpenFilePreview, openFilePreview]
  )
  const shouldShowPathTooltip = Boolean(pathTooltipPath) && !shouldShowFileTokenPopover(file)
  const shouldUseNeutralImageIcon = imageIconPreview && presentation.variant === 'image'
  const tokenIcon = props.token.icon ? (
    props.token.icon
  ) : shouldUseNeutralImageIcon && !isSvgFile(file, label) ? (
    <FileTokenImageIcon previewUrl={presentation.previewUrl} fallbackIcon={presentation.icon} />
  ) : (
    presentation.icon
  )

  const chipElement = (
    <span
      className={cn(
        'group/composer-token mx-0.5 my-0.5 inline-flex h-6 max-w-[calc(100%_-_0.25rem)] select-none items-center gap-1 overflow-hidden rounded-md border px-1.5 align-middle font-medium text-foreground text-xs leading-[1.4] transition-[color,box-shadow,border-color]',
        'group-focus-visible:border-primary',
        (props.readOnly || canOpenFilePreview) && 'focus-visible:border-primary focus-visible:outline-none',
        canOpenFilePreview && 'cursor-pointer',
        presentation.containerClassName,
        props.selected && 'border-primary ring-1 ring-primary/40',
        props.className
      )}
      title={props.readOnly || shouldShowPathTooltip ? undefined : title}
      data-composer-token-kind={props.token.kind}
      data-file-token-variant={presentation.variant}
      role={canOpenFilePreview ? 'button' : undefined}
      tabIndex={canOpenFilePreview ? 0 : undefined}
      aria-label={canOpenFilePreview ? accessibleTitle : undefined}
      onClick={canOpenFilePreview ? handleFilePreviewClick : undefined}
      onKeyDown={canOpenFilePreview ? handleFilePreviewKeyDown : undefined}
      onMouseDown={props.onMouseDown}>
      <span
        className={cn(
          'inline-flex size-4.5 shrink-0 items-center justify-center overflow-hidden rounded-[5px] border-0 leading-none',
          shouldUseNeutralImageIcon ? 'bg-accent text-muted-foreground' : presentation.iconClassName
        )}
        data-file-token-icon={presentation.variant}>
        <InlineTokenIconSlot
          icon={tokenIcon}
          removeLabel={removeLabel}
          onRemove={onRemove}
          slotClassName="size-full items-center justify-center"
          removeButtonClassName="size-full rounded-[5px] bg-muted text-foreground"
          removeIconClassName="size-3"
        />
      </span>
      {props.children ?? (
        <span className={cn('whitespace-nowrap! min-w-0 max-w-full truncate break-normal', props.maxWidthClassName)}>
          {label}
        </span>
      )}
    </span>
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
        triggerProps={props.readOnly ? { tabIndex: 0, 'aria-label': accessibleTitle } : undefined}>
        {chipElement}
      </NormalTooltip>
    )
  }

  if (props.readOnly && !shouldShowPopover) {
    const sizeLabel = typeof file?.size === 'number' ? formatFileSize(file.size) : undefined
    const detail = [presentation.typeLabel, sizeLabel].filter(Boolean).join(' · ')

    return (
      <NormalTooltip
        content={<TokenPathTooltipContent path={label} sizeLabel={detail} />}
        side="top"
        sideOffset={6}
        delayDuration={TOKEN_TOOLTIP_DELAY_MS}
        triggerProps={{ tabIndex: 0, 'aria-label': accessibleTitle }}>
        {chipElement}
      </NormalTooltip>
    )
  }

  if (!shouldShowPopover) return chipElement

  return (
    <ComposerTokenHoverPopover
      trigger={chipElement}
      ariaLabel={accessibleTitle}
      contentClassName={presentation.previewUrl ? 'rounded-lg border-0 bg-transparent' : undefined}
      onActivate={presentation.previewUrl ? openImagePreview : undefined}
      content={
        <FileTokenPreviewCard
          file={file}
          label={label}
          presentation={presentation}
          readOnlyFilePreview={props.readOnlyFilePreview}
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
        'group/composer-token mx-0.5 my-0.5 inline-flex h-6 max-w-[calc(100%_-_0.25rem)] select-none items-center gap-1 overflow-hidden rounded-md border px-1.5 align-baseline font-medium text-foreground text-xs leading-[inherit] transition-[color,box-shadow,border-color]',
        'group-focus-visible:border-primary',
        props.readOnly && 'focus-visible:border-primary focus-visible:outline-none',
        'border-border bg-background hover:bg-accent',
        props.selected && 'border-primary ring-1 ring-primary/40',
        props.className
      )}
      title={path ? undefined : title}
      data-composer-token-kind={props.token.kind}
      onMouseDown={props.onMouseDown}>
      <span
        className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border-0 bg-accent text-muted-foreground leading-none"
        data-folder-token-icon="">
        <InlineTokenIconSlot
          icon={props.token.icon ? props.token.icon : <Folder className={tokenIconClassName} aria-hidden />}
          removeLabel={removeLabel}
          onRemove={props.onRemove}
          removeButtonClassName="size-full rounded-[5px]"
          removeIconClassName="size-3"
        />
      </span>
      {props.children ?? (
        <span className={cn('whitespace-nowrap! min-w-0 max-w-full truncate break-normal', props.maxWidthClassName)}>
          {props.token.label}
        </span>
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
  const { t } = useTranslation()
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editDialogLoaded, setEditDialogLoaded] = useState(false)
  const [editMaxLength, setEditMaxLength] = useState(0)
  const quoteTooltipContent = getQuoteTooltipContent(props.token.description, props.token.promptText)
  const canEdit = !props.readOnly && Boolean(quoteTooltipContent && props.onEdit && props.getEditMaxLength)
  const editLabel = `${t('common.edit')} ${props.token.label}`

  const openEditor = () => {
    if (!canEdit || !props.getEditMaxLength) return
    setEditMaxLength(props.getEditMaxLength())
    setEditDialogLoaded(true)
    setEditDialogOpen(true)
  }

  const handleEditClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    stopTokenActionEvent(event)
    openEditor()
  }
  const handleEditKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    openEditor()
  }

  const tokenElement = canEdit ? (
    <span
      className={cn(
        'group/composer-token relative mx-0.5 inline-flex max-w-[calc(100%_-_0.25rem)] select-none items-baseline align-baseline text-primary leading-[inherit]',
        props.selected && 'text-primary underline decoration-primary/40 underline-offset-2',
        props.className
      )}
      data-composer-token-kind={props.token.kind}
      onMouseDown={props.onMouseDown}>
      <button
        type="button"
        className="inline-flex min-w-0 max-w-full cursor-pointer appearance-none items-baseline gap-1 rounded-[4px] border-0 bg-transparent p-0 text-current leading-[inherit] [font:inherit] focus-visible:bg-accent focus-visible:outline-none"
        aria-label={editLabel}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={handleEditClick}
        onKeyDown={handleEditKeyDown}>
        <span className="inline-flex shrink-0 translate-y-[0.08em] items-baseline text-current leading-[inherit] transition-opacity group-focus-within/composer-token:opacity-0 group-hover/composer-token:opacity-0">
          {props.token.icon ? props.token.icon : tokenIconByKind.quote}
        </span>
        {props.children ?? <span className="min-w-0 truncate">{props.token.label}</span>}
      </button>
      {props.onRemove && (
        <InlineTokenRemoveButton
          label={props.removeLabel ?? 'Remove'}
          onRemove={props.onRemove}
          overlay={false}
          className="absolute top-[0.08em] left-0 size-[1em] rounded-[4px]"
        />
      )}
    </span>
  ) : (
    renderActiveComposerTokenElement({ ...props, icon: tokenIconByKind.quote })
  )

  const previewElement = quoteTooltipContent ? (
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
  ) : (
    tokenElement
  )

  const handleSave = (content: string) => {
    props.onEdit?.(content)
    setEditDialogOpen(false)
  }

  return (
    <>
      {previewElement}
      {editDialogLoaded && quoteTooltipContent !== undefined && (
        <Suspense fallback={null}>
          <QuoteTokenEditDialog
            content={quoteTooltipContent}
            label={props.token.label}
            maxLength={editMaxLength}
            open={editDialogOpen}
            onCancel={() => setEditDialogOpen(false)}
            onSave={handleSave}
          />
        </Suspense>
      )}
    </>
  )
}

export function PromptVariableComposerToken(props: ComposerTokenProps) {
  return <ActiveComposerToken {...props} icon={tokenIconByKind.promptVariable} colorClassName="text-info" />
}

export const composerInputTokenComponentByKind = {
  skill: SkillComposerToken,
  link: LinkComposerToken,
  file: FileComposerToken,
  folder: FolderComposerToken,
  knowledge: KnowledgeComposerToken,
  reference: ReferenceComposerToken,
  quote: QuoteComposerToken,
  promptVariable: PromptVariableComposerToken
} satisfies Record<ChatInputTokenKind, ComponentType<ComposerTokenProps>>

export function ComposerToken(props: ComposerTokenProps) {
  const TokenComponent = composerInputTokenComponentByKind[props.token.kind]
  return <TokenComponent {...props} />
}
