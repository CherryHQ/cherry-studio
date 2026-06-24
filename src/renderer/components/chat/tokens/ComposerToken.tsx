import { Button, NormalTooltip, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  getQuoteTooltipContent,
  QUOTE_TOOLTIP_BODY_CLASS_NAME,
  QUOTE_TOOLTIP_CONTENT_CLASS_NAME
} from '@renderer/components/chat/utils/quoteToken'
import { FILE_TYPE } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FilePath } from '@shared/types/file'
import { toSafeFileUrl } from '@shared/utils/file/urlUtil'
import {
  Boxes,
  Braces,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  Presentation,
  TextQuote,
  Trash2,
  Zap
} from 'lucide-react'
import {
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type MouseEventHandler,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import type { ChatInputTokenKind, ChatTokenView } from './tokenView'

const tokenIconClassName = 'size-[1em] shrink-0 text-current opacity-80'
const fileTokenIconClassName = 'size-3 shrink-0 text-current'
const fileTokenContainerClassName = 'border-border bg-background hover:bg-accent'

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

type FileTokenVariant =
  | 'image'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'pdf'
  | 'markdown'
  | 'archive'
  | 'audio'
  | 'video'
  | 'json'
  | 'code'
  | 'document'
  | 'text'
  | 'fallback'

interface FileTokenPresentation {
  variant: FileTokenVariant
  icon: ReactNode
  previewIcon: ReactNode
  containerClassName: string
  iconClassName: string
  typeLabel: string
  previewUrl?: string
}

interface FileTokenVisualPreset {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: true }>
  iconClassName: string
  defaultTypeLabel: string
}

const fileExtensionGroups = {
  image: new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp']),
  word: new Set(['doc', 'docx']),
  excel: new Set(['csv', 'xls', 'xlsx']),
  powerpoint: new Set(['ppt', 'pptx']),
  pdf: new Set(['pdf']),
  markdown: new Set(['markdown', 'md', 'mdx']),
  archive: new Set(['7z', 'gz', 'rar', 'tar', 'zip']),
  audio: new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']),
  video: new Set(['avi', 'm4v', 'mov', 'mp4', 'mpeg', 'webm']),
  json: new Set(['json', 'jsonl']),
  code: new Set(['css', 'go', 'html', 'java', 'js', 'jsx', 'py', 'rs', 'ts', 'tsx', 'xml', 'yaml', 'yml']),
  text: new Set(['log', 'text', 'txt'])
}

const fileTokenVisualPresetByVariant: Record<FileTokenVariant, FileTokenVisualPreset> = {
  image: {
    icon: FileImage,
    iconClassName: 'bg-[var(--color-cyan-100)] text-[var(--color-cyan-700)]',
    defaultTypeLabel: 'IMAGE'
  },
  word: {
    icon: FileType2,
    iconClassName: 'bg-[var(--color-blue-100)] text-[var(--color-blue-700)]',
    defaultTypeLabel: 'WORD'
  },
  excel: {
    icon: FileSpreadsheet,
    iconClassName: 'bg-[var(--color-green-100)] text-[var(--color-green-700)]',
    defaultTypeLabel: 'EXCEL'
  },
  powerpoint: {
    icon: Presentation,
    iconClassName: 'bg-[var(--color-orange-100)] text-[var(--color-orange-700)]',
    defaultTypeLabel: 'PPT'
  },
  pdf: {
    icon: FileText,
    iconClassName: 'bg-[var(--color-red-100)] text-[var(--color-red-700)]',
    defaultTypeLabel: 'PDF'
  },
  markdown: {
    icon: FileText,
    iconClassName: 'bg-[var(--color-gray-100)] text-[var(--color-gray-700)]',
    defaultTypeLabel: 'MD'
  },
  archive: {
    icon: FileArchive,
    iconClassName: 'bg-[var(--color-amber-100)] text-[var(--color-amber-700)]',
    defaultTypeLabel: 'ARCHIVE'
  },
  audio: {
    icon: FileAudio,
    iconClassName: 'bg-[var(--color-purple-100)] text-[var(--color-purple-700)]',
    defaultTypeLabel: 'AUDIO'
  },
  video: {
    icon: FileVideo,
    iconClassName: 'bg-[var(--color-pink-100)] text-[var(--color-pink-700)]',
    defaultTypeLabel: 'VIDEO'
  },
  json: {
    icon: FileJson,
    iconClassName: 'bg-[var(--color-violet-100)] text-[var(--color-violet-700)]',
    defaultTypeLabel: 'JSON'
  },
  code: {
    icon: FileCode2,
    iconClassName: 'bg-[var(--color-indigo-100)] text-[var(--color-indigo-700)]',
    defaultTypeLabel: 'CODE'
  },
  document: {
    icon: FileText,
    iconClassName: 'bg-[var(--color-slate-100)] text-[var(--color-slate-700)]',
    defaultTypeLabel: 'DOCUMENT'
  },
  text: {
    icon: FileText,
    iconClassName: 'bg-[var(--color-info-bg)] text-info',
    defaultTypeLabel: 'TEXT'
  },
  fallback: {
    icon: File,
    iconClassName: 'bg-accent text-muted-foreground',
    defaultTypeLabel: 'FILE'
  }
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

function getNormalizedFileExtension(file: ComposerAttachment | undefined, fallbackLabel: string) {
  const extension = file?.ext || fallbackLabel.match(/\.[^.]+$/)?.[0] || ''
  return extension.replace(/^\./, '').toLowerCase()
}

function getFileExtensionLabel(file: ComposerAttachment | undefined, fallbackLabel: string) {
  return getNormalizedFileExtension(file, fallbackLabel).toUpperCase()
}

function getFilePreviewUrl(file: ComposerAttachment | undefined) {
  if (!file?.path || file.type !== FILE_TYPE.IMAGE) return undefined
  return toSafeFileUrl(file.path as FilePath, file.ext?.replace(/^\./, '') || null)
}

function getFileTokenVariant(file: ComposerAttachment | undefined, fallbackLabel: string): FileTokenVariant {
  const extension = getNormalizedFileExtension(file, fallbackLabel)

  if (file?.type === FILE_TYPE.IMAGE || fileExtensionGroups.image.has(extension)) return 'image'
  if (fileExtensionGroups.word.has(extension)) return 'word'
  if (fileExtensionGroups.excel.has(extension)) return 'excel'
  if (fileExtensionGroups.powerpoint.has(extension)) return 'powerpoint'
  if (fileExtensionGroups.pdf.has(extension)) return 'pdf'
  if (fileExtensionGroups.markdown.has(extension)) return 'markdown'
  if (fileExtensionGroups.archive.has(extension)) return 'archive'
  if (fileExtensionGroups.audio.has(extension)) return 'audio'
  if (fileExtensionGroups.video.has(extension)) return 'video'
  if (fileExtensionGroups.json.has(extension)) return 'json'
  if (fileExtensionGroups.code.has(extension)) return 'code'
  if (fileExtensionGroups.text.has(extension)) return 'text'
  if (file?.type === FILE_TYPE.DOCUMENT) return 'document'
  if (file?.type === FILE_TYPE.TEXT) return 'text'

  return 'fallback'
}

function getFileTokenPresentation(file: ComposerAttachment | undefined, fallbackLabel: string): FileTokenPresentation {
  const extensionLabel = getFileExtensionLabel(file, fallbackLabel)
  const variant = getFileTokenVariant(file, fallbackLabel)
  const preset = fileTokenVisualPresetByVariant[variant]
  const Icon = preset.icon

  return {
    variant,
    icon: <Icon className={fileTokenIconClassName} aria-hidden />,
    previewIcon: <Icon className="size-7" aria-hidden />,
    containerClassName: fileTokenContainerClassName,
    iconClassName: preset.iconClassName,
    typeLabel: extensionLabel || preset.defaultTypeLabel,
    previewUrl: variant === 'image' ? getFilePreviewUrl(file) : undefined
  }
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
  const closeTimerRef = useRef<number | null>(null)
  const file = isComposerAttachment(props.token.payload) ? props.token.payload : undefined
  const label = file?.origin_name || file?.name || props.token.label
  const presentation = getFileTokenPresentation(file, label)
  const title = props.token.description ?? props.token.promptText ?? label
  const removeLabel = removeLabelProp ?? 'Remove'

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const openPopover = useCallback(() => {
    clearCloseTimer()
    setPopoverOpen(true)
  }, [clearCloseTimer])

  const scheduleClosePopover = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      setPopoverOpen(false)
      closeTimerRef.current = null
    }, 120)
  }, [clearCloseTimer])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

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
        'mx-0.5 my-0.5 inline-flex h-6 max-w-52 select-none items-center gap-1 overflow-hidden rounded-md border px-1.5 align-baseline font-medium text-foreground text-xs leading-[inherit] transition-colors',
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
      className="inline-flex align-baseline"
      onMouseEnter={openPopover}
      onMouseLeave={scheduleClosePopover}
      onFocus={openPopover}
      onBlur={scheduleClosePopover}>
      {chipElement}
    </span>
  )

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>{tokenElement}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-fit max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl p-0 shadow-xl"
        onMouseEnter={openPopover}
        onMouseLeave={scheduleClosePopover}
        onOpenAutoFocus={(event) => event.preventDefault()}>
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
