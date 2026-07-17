import { NormalTooltip, Popover, PopoverContent, PopoverTrigger, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  getQuoteTooltipContent,
  QUOTE_TOOLTIP_BODY_CLASS_NAME,
  QUOTE_TOOLTIP_CONTENT_CLASS_NAME
} from '@renderer/components/composer/quoteToken'
import SkillIcon from '@renderer/components/icons/SkillIcon'
import { COMPOSER_FILE_KIND, type ComposerFileKind, FILE_TYPE } from '@renderer/types/file'
import { formatFileSize } from '@renderer/utils/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileUrlString } from '@shared/types/file'
import { fileUrlToPath } from '@shared/utils/file'
import { Boxes, Braces, FileText, Folder, TextQuote, X } from 'lucide-react'
import {
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

import type { ChatInputTokenKind, ChatTokenView } from '../chatTokenView'
import { type FileTokenPresentation, getFileTokenPresentation } from './fileTokenPresentation'

const tokenIconClassName = 'size-[1em] shrink-0 text-current opacity-80'
const tokenRemoveIconClassName = 'size-[0.95em] shrink-0 text-current'
const TOKEN_POPOVER_OPEN_DELAY_MS = 120
const TOKEN_POPOVER_CLOSE_DELAY_MS = 160
const TOKEN_TOOLTIP_DELAY_MS = 300
type TokenPopoverOpenReason = 'keyboard' | 'pointer'
const tokenPreviewHeaderClassName =
  'flex h-20 items-center justify-center border-border-subtle border-b bg-[repeating-linear-gradient(135deg,var(--color-border-subtle)_0,var(--color-border-subtle)_1px,transparent_1px,transparent_8px)] bg-muted'
const pastedTextPreviewCache = new Map<string, Promise<string>>()

const tokenIconByKind: Record<ChatInputTokenKind, ReactNode> = {
  skill: <SkillIcon className={tokenIconClassName} />,
  file: <FileText className={tokenIconClassName} />,
  folder: <Folder className={tokenIconClassName} />,
  knowledge: <Boxes className={tokenIconClassName} />,
  quote: <TextQuote className={tokenIconClassName} />,
  promptVariable: <Braces className={tokenIconClassName} />
}

function stopTokenActionEvent(event: ReactMouseEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
}

export interface ComposerTokenProps {
  token: ChatTokenView
  readOnly?: boolean
  readOnlyFilePreview?: ReadOnlyComposerFileTokenPreview
  selected?: boolean
  className?: string
  children?: ReactNode
  maxWidthClassName?: string
  onMouseDown?: MouseEventHandler<HTMLSpanElement>
  onRemove?: () => void
  removeLabel?: string
}

export interface ReadOnlyComposerFileTokenPreview {
  url?: string
  mediaType?: string
  composerFileKind?: ComposerFileKind
}

interface FileComposerTokenProps extends ComposerTokenProps {
  imageIconPreview?: boolean
  tooltipActions?: ReactNode
}

interface ActiveComposerTokenProps extends ComposerTokenProps {
  icon: ReactNode
  colorClassName?: string
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
    <button
      type="button"
      aria-label={label}
      title={label}
      data-composer-token-remove=""
      className={cn(
        'pointer-events-none absolute inset-0 inline-flex items-center justify-center border-0 bg-transparent p-0 text-current leading-none opacity-0 outline-none transition-opacity',
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
  removeButtonClassName,
  removeIconClassName
}: {
  icon: ReactNode
  removeLabel?: string
  onRemove?: () => void
  removeButtonClassName?: string
  removeIconClassName?: string
}) {
  if (!onRemove) return icon

  // The remove button overlays the icon (absolute) instead of sitting beside it in
  // flow, so it never occupies half of the fixed-size icon slot and shift the icon.
  // Icon and button cross-fade via opacity (not display) to keep the slot from
  // collapsing and to keep the button keyboard-focusable.
  return (
    <span className="relative inline-flex shrink-0">
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
  colorClassName = 'text-primary'
}: ActiveComposerTokenProps) {
  const title = token.kind === 'quote' ? undefined : (token.description ?? token.promptText ?? token.label)

  return (
    <span
      className={cn(
        'group/composer-token mx-0.5 inline-flex select-none items-baseline gap-1 align-baseline leading-[inherit]',
        maxWidthClassName,
        colorClassName,
        readOnly && 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected && 'text-primary underline decoration-primary/40 underline-offset-2',
        className
      )}
      title={title}
      data-composer-token-kind={token.kind}
      onMouseDown={onMouseDown}>
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
    return fileUrlToPath(readOnlyFilePreview.url as FileUrlString)
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
  const sizeLabel = typeof file?.size === 'number' ? formatFileSize(file.size) : undefined
  const hasActions = Boolean(secondaryAction)

  if (file?.composerFileKind === COMPOSER_FILE_KIND.PASTED_TEXT) {
    return (
      <PastedTextTokenPreviewCard
        file={file}
        readOnlyFilePreview={readOnlyFilePreview}
        secondaryAction={secondaryAction}
      />
    )
  }

  if (presentation.previewUrl) {
    return (
      <div className="flex max-h-64 max-w-80 overflow-hidden bg-muted text-left" data-file-token-image-preview="">
        <img src={presentation.previewUrl} alt={label} className="block max-h-64 max-w-80 object-contain" />
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
                <span className="text-border-muted">·</span>
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
}

function ComposerTokenHoverPopover({ trigger, content, ariaLabel, contentClassName }: ComposerTokenHoverPopoverProps) {
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
        openPopover('keyboard')
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closePopover()
      }
    },
    [closePopover, openPopover]
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
  const title = props.token.description ?? props.token.promptText ?? label
  const accessibleTitle = props.readOnly ? label : title
  const removeLabel = removeLabelProp ?? 'Remove'
  const shouldShowPopover =
    shouldShowFileTokenPopover(file) && (!props.readOnly || Boolean(props.readOnlyFilePreview?.url))
  const pathTooltipPath = props.readOnly ? getReadOnlyFilePreviewPath(props.readOnlyFilePreview) : file?.path
  const shouldShowPathTooltip = Boolean(pathTooltipPath) && !shouldShowFileTokenPopover(file)
  const tokenIcon = props.token.icon ? (
    props.token.icon
  ) : imageIconPreview && presentation.variant === 'image' && !isSvgFile(file, label) ? (
    <FileTokenImageIcon previewUrl={presentation.previewUrl} fallbackIcon={presentation.icon} />
  ) : (
    presentation.icon
  )

  const chipElement = (
    <span
      className={cn(
        'group/composer-token mx-0.5 my-0.5 inline-flex h-6 max-w-[calc(100%_-_0.25rem)] select-none items-center gap-1 overflow-hidden rounded-md border px-1.5 align-middle font-medium text-foreground text-xs leading-[inherit] transition-[color,box-shadow,border-color]',
        'group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50 group-data-[state=open]:ring-1 group-data-[state=open]:ring-ring/50',
        props.readOnly && 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        presentation.containerClassName,
        props.selected && 'border-primary ring-1 ring-ring',
        props.className
      )}
      title={props.readOnly || shouldShowPathTooltip ? undefined : title}
      data-composer-token-kind={props.token.kind}
      data-file-token-variant={presentation.variant}
      onMouseDown={props.onMouseDown}>
      <span
        className={cn(
          'inline-flex size-4.5 shrink-0 items-center justify-center overflow-hidden rounded-[5px] border-0 leading-none',
          presentation.iconClassName
        )}
        data-file-token-icon={presentation.variant}>
        <InlineTokenIconSlot
          icon={tokenIcon}
          removeLabel={removeLabel}
          onRemove={onRemove}
          removeButtonClassName={cn(
            'size-full rounded-[5px]',
            presentation.variant !== 'text' && presentation.variant !== 'fallback' && 'dark:text-black'
          )}
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
        'group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50',
        props.readOnly && 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'border-border bg-background hover:bg-accent',
        props.selected && 'border-primary ring-1 ring-ring',
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

export const composerInputTokenComponentByKind = {
  skill: SkillComposerToken,
  file: FileComposerToken,
  folder: FolderComposerToken,
  knowledge: KnowledgeComposerToken,
  quote: QuoteComposerToken,
  promptVariable: PromptVariableComposerToken
} satisfies Record<ChatInputTokenKind, ComponentType<ComposerTokenProps>>

export function ComposerToken(props: ComposerTokenProps) {
  const TokenComponent = composerInputTokenComponentByKind[props.token.kind]
  return <TokenComponent {...props} />
}
