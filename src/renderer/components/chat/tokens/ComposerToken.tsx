import { Button, NormalTooltip, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  getQuoteTooltipContent,
  QUOTE_TOOLTIP_BODY_CLASS_NAME,
  QUOTE_TOOLTIP_CONTENT_CLASS_NAME
} from '@renderer/components/chat/utils/quoteToken'
import { formatFileSize } from '@renderer/utils'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { Boxes, Braces, FileText, TextQuote, Trash2, Zap } from 'lucide-react'
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

import { type FileTokenPresentation, getFileTokenPresentation } from './fileTokenPresentation'
import type { ChatInputTokenKind, ChatTokenView } from './tokenView'

const tokenIconClassName = 'size-[1em] shrink-0 text-current opacity-80'
const FILE_TOKEN_POPOVER_OPEN_DELAY_MS = 120
const FILE_TOKEN_POPOVER_CLOSE_DELAY_MS = 160
type FileTokenPopoverOpenReason = 'keyboard' | 'pointer'

const tokenIconByKind: Record<ChatInputTokenKind, ReactNode> = {
  skill: <Zap className={tokenIconClassName} />,
  file: <FileText className={tokenIconClassName} />,
  knowledge: <Boxes className={tokenIconClassName} />,
  quote: <TextQuote className={tokenIconClassName} />,
  promptVariable: <Braces className={tokenIconClassName} />
}

function stopFileTokenActionEvent(event: ReactMouseEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
}

export interface ComposerTokenProps {
  token: ChatTokenView
  selected?: boolean
  className?: string
  children?: ReactNode
  maxWidthClassName?: string
  onMouseDown?: MouseEventHandler<HTMLSpanElement>
}

interface FileComposerTokenProps extends ComposerTokenProps {
  tooltipActions?: ReactNode
  onRemove?: () => void
  removeLabel?: string
}

interface ActiveComposerTokenProps extends ComposerTokenProps {
  icon: ReactNode
  colorClassName?: string
}

function renderActiveComposerTokenElement({
  token,
  selected = false,
  className,
  children,
  maxWidthClassName = 'max-w-52',
  onMouseDown,
  icon,
  colorClassName = 'text-primary'
}: ActiveComposerTokenProps) {
  const title = token.kind === 'quote' ? undefined : (token.description ?? token.promptText ?? token.label)

  return (
    <span
      className={cn(
        'mx-0.5 inline-flex select-none items-baseline gap-1 align-baseline leading-[inherit]',
        maxWidthClassName,
        colorClassName,
        selected && 'text-primary underline decoration-primary/40 underline-offset-2',
        className
      )}
      title={title}
      data-composer-token-kind={token.kind}
      onMouseDown={onMouseDown}>
      <span className="inline-flex shrink-0 translate-y-[0.08em] items-baseline text-current leading-[inherit]">
        {token.icon ? token.icon : icon}
      </span>
      {children ?? <span className="min-w-0 truncate">{token.label}</span>}
    </span>
  )
}

function ActiveComposerToken(props: ActiveComposerTokenProps) {
  return renderActiveComposerTokenElement(props)
}

export function SkillComposerToken(props: ComposerTokenProps) {
  return <ActiveComposerToken {...props} icon={tokenIconByKind.skill} />
}

function isComposerAttachment(value: unknown): value is ComposerAttachment {
  return typeof value === 'object' && value !== null
}

function FileTokenPreviewCard({
  file,
  label,
  presentation,
  primaryAction,
  secondaryAction
}: {
  file: ComposerAttachment | undefined
  label: string
  presentation: FileTokenPresentation
  primaryAction?: ReactNode
  secondaryAction?: ReactNode
}) {
  const sizeLabel = typeof file?.size === 'number' ? formatFileSize(file.size) : undefined
  const hasActions = Boolean(primaryAction || secondaryAction)

  return (
    <div className="w-72 overflow-hidden text-left">
      {presentation.previewUrl && (
        <div className="h-24 overflow-hidden border-border-subtle border-b bg-muted">
          <img src={presentation.previewUrl} alt={label} className="h-full w-full object-cover" />
        </div>
      )}
      {!presentation.previewUrl && (
        <div className="flex h-20 items-center justify-center border-border-subtle border-b bg-[repeating-linear-gradient(135deg,var(--color-border-subtle)_0,var(--color-border-subtle)_1px,transparent_1px,transparent_8px)] bg-muted">
          <span
            className={cn(
              'inline-flex size-12 items-center justify-center rounded-xl bg-background',
              presentation.iconClassName
            )}>
            {presentation.previewIcon}
          </span>
        </div>
      )}
      <div className="space-y-2.5 p-3">
        <div
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1"
          data-file-token-actions={hasActions ? '' : undefined}>
          <div className="flex h-6 min-w-0 items-center">
            <span className="truncate font-semibold text-popover-foreground text-sm leading-5">{label}</span>
          </div>
          {primaryAction && (
            <div className="flex h-6 shrink-0 items-center justify-end" onMouseDown={stopFileTokenActionEvent}>
              {primaryAction}
            </div>
          )}
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
            <div className="flex min-h-4 shrink-0 items-center justify-end" onMouseDown={stopFileTokenActionEvent}>
              {secondaryAction}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function FileComposerToken(props: FileComposerTokenProps) {
  const { onRemove, removeLabel: removeLabelProp, tooltipActions } = props
  const [popoverOpen, setPopoverOpen] = useState(false)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const popoverOpenReasonRef = useRef<FileTokenPopoverOpenReason>('pointer')
  const file = isComposerAttachment(props.token.payload) ? props.token.payload : undefined
  const label = file?.origin_name || file?.name || props.token.label
  const presentation = getFileTokenPresentation(file, label)
  const title = props.token.description ?? props.token.promptText ?? label
  const removeLabel = removeLabelProp ?? 'Remove'

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
    (reason: FileTokenPopoverOpenReason = 'pointer') => {
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
    }, FILE_TOKEN_POPOVER_OPEN_DELAY_MS)
  }, [clearCloseTimer, popoverOpen])

  const scheduleClosePopover = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      setPopoverOpen(false)
      closeTimerRef.current = null
    }, FILE_TOKEN_POPOVER_CLOSE_DELAY_MS)
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

  const handleRemove = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      stopFileTokenActionEvent(event)
      setPopoverOpen(false)
      onRemove?.()
    },
    [onRemove]
  )

  const removeAction = onRemove ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={removeLabel}
      title={removeLabel}
      className="size-6 rounded-md border border-border-subtle bg-background text-muted-foreground shadow-none hover:bg-[var(--color-error-bg)] hover:text-destructive"
      onMouseDown={stopFileTokenActionEvent}
      onClick={handleRemove}>
      <Trash2 className="size-3" aria-hidden />
    </Button>
  ) : undefined

  const tooltipContent = (
    <FileTokenPreviewCard
      file={file}
      label={label}
      presentation={presentation}
      primaryAction={removeAction}
      secondaryAction={tooltipActions}
    />
  )

  const chipElement = (
    <span
      className={cn(
        'mx-0.5 my-0.5 inline-flex h-6 max-w-52 select-none items-center gap-1 overflow-hidden rounded-md border px-1.5 align-baseline font-medium text-foreground text-xs leading-[inherit] transition-[color,box-shadow,border-color]',
        'group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50 group-data-[state=open]:ring-1 group-data-[state=open]:ring-ring/50',
        presentation.containerClassName,
        props.selected && 'border-primary ring-1 ring-ring',
        props.className
      )}
      title={title}
      data-composer-token-kind={props.token.kind}
      data-file-token-variant={presentation.variant}
      onMouseDown={props.onMouseDown}>
      <span
        className={cn(
          'inline-flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border-0 leading-none',
          presentation.iconClassName
        )}
        data-file-token-icon={presentation.variant}>
        {props.token.icon ? props.token.icon : presentation.icon}
      </span>
      {props.children ?? (
        <span className={cn('whitespace-nowrap! min-w-0 max-w-full truncate break-normal', props.maxWidthClassName)}>
          {label}
        </span>
      )}
    </span>
  )

  const tokenElement = (
    <span
      ref={triggerRef}
      className="group inline-flex align-baseline outline-none"
      role="button"
      tabIndex={0}
      aria-label={title}
      onMouseEnter={scheduleOpenPopover}
      onMouseLeave={scheduleClosePopover}
      onMouseMove={scheduleOpenPopover}
      onPointerDown={markPointerOpenReason}
      onBlur={handleTriggerBlur}
      onKeyDownCapture={handleTriggerKeyDown}>
      {chipElement}
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
        className="w-fit max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl p-0 shadow-xl"
        onMouseEnter={openPointerPopover}
        onMouseLeave={scheduleClosePopover}
        onFocus={openPointerPopover}
        onBlur={handleContentBlur}
        onOpenAutoFocus={handlePopoverOpenAutoFocus}
        onCloseAutoFocus={handlePopoverCloseAutoFocus}>
        {tooltipContent}
      </PopoverContent>
    </Popover>
  )
}

export function KnowledgeComposerToken(props: ComposerTokenProps) {
  return <ActiveComposerToken {...props} icon={tokenIconByKind.knowledge} />
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
      contentProps={{ className: QUOTE_TOOLTIP_CONTENT_CLASS_NAME }}>
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
  knowledge: KnowledgeComposerToken,
  quote: QuoteComposerToken,
  promptVariable: PromptVariableComposerToken
} satisfies Record<ChatInputTokenKind, ComponentType<ComposerTokenProps>>

export function ComposerToken(props: ComposerTokenProps) {
  const TokenComponent = composerInputTokenComponentByKind[props.token.kind]
  return <TokenComponent {...props} />
}
