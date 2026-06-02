import { NormalTooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  getQuoteTooltipContent,
  QUOTE_TOOLTIP_BODY_CLASS_NAME,
  QUOTE_TOOLTIP_CONTENT_CLASS_NAME
} from '@renderer/components/chat/utils/quoteToken'
import { FILE_TYPE, type FileMetadata } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import type { FilePath } from '@shared/file/types'
import { toSafeFileUrl } from '@shared/file/urlUtil'
import { Boxes, Braces, File, FileCode2, FileImage, FileText, TextQuote, Zap } from 'lucide-react'
import type { ComponentType, MouseEventHandler, ReactNode } from 'react'

import type { ActiveComposerInputToken, ActiveComposerInputTokenKind } from './tokens'

const tokenIconClassName = 'size-[1em] shrink-0 text-current opacity-80'
const fileTokenIconClassName = 'size-3 shrink-0 text-current'

const tokenIconByKind: Record<ActiveComposerInputTokenKind, ReactNode> = {
  skill: <Zap className={tokenIconClassName} />,
  file: <FileText className={tokenIconClassName} />,
  knowledge: <Boxes className={tokenIconClassName} />,
  quote: <TextQuote className={tokenIconClassName} />,
  promptVariable: <Braces className={tokenIconClassName} />
}

export interface ComposerTokenProps {
  token: ActiveComposerInputToken
  selected?: boolean
  className?: string
  children?: ReactNode
  maxWidthClassName?: string
  onMouseDown?: MouseEventHandler<HTMLSpanElement>
}

interface ActiveComposerTokenProps extends ComposerTokenProps {
  icon: ReactNode
  colorClassName?: string
}

type FileTokenVariant = 'image' | 'document' | 'text' | 'fallback'

interface FileTokenPresentation {
  variant: FileTokenVariant
  icon: ReactNode
  containerClassName: string
  iconClassName: string
  typeLabel: string
  previewUrl?: string
}

function ActiveComposerToken({
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

export function SkillComposerToken(props: ComposerTokenProps) {
  return <ActiveComposerToken {...props} icon={tokenIconByKind.skill} />
}

function isFileMetadata(value: unknown): value is FileMetadata {
  return typeof value === 'object' && value !== null
}

function normalizeFileExtension(file: FileMetadata | undefined, fallbackLabel: string) {
  const extension = file?.ext || fallbackLabel.match(/\.[^.]+$/)?.[0] || ''
  return extension.replace(/^\./, '').toUpperCase()
}

function getFilePreviewUrl(file: FileMetadata | undefined) {
  if (!file?.path || file.type !== FILE_TYPE.IMAGE) return undefined
  return toSafeFileUrl(file.path as FilePath, file.ext?.replace(/^\./, '') || null)
}

function getFileTokenPresentation(file: FileMetadata | undefined, fallbackLabel: string): FileTokenPresentation {
  const extensionLabel = normalizeFileExtension(file, fallbackLabel)

  if (file?.type === FILE_TYPE.IMAGE) {
    return {
      variant: 'image',
      icon: <FileImage className={fileTokenIconClassName} aria-hidden />,
      containerClassName: 'border-success bg-[var(--color-success-bg)] hover:bg-[var(--color-success-bg-hover)]',
      iconClassName: 'border-success bg-background text-success',
      typeLabel: 'IMAGE',
      previewUrl: getFilePreviewUrl(file)
    }
  }

  if (file?.type === FILE_TYPE.DOCUMENT) {
    return {
      variant: 'document',
      icon: <FileText className={fileTokenIconClassName} aria-hidden />,
      containerClassName: 'border-destructive bg-[var(--color-error-bg)] hover:bg-[var(--color-error-bg-hover)]',
      iconClassName: 'border-destructive bg-background text-destructive',
      typeLabel: extensionLabel || 'DOCUMENT'
    }
  }

  if (file?.type === FILE_TYPE.TEXT) {
    return {
      variant: 'text',
      icon: <FileCode2 className={fileTokenIconClassName} aria-hidden />,
      containerClassName: 'border-info bg-[var(--color-info-bg)] hover:bg-[var(--color-info-bg-hover)]',
      iconClassName: 'border-info bg-background text-info',
      typeLabel: extensionLabel || 'TEXT'
    }
  }

  return {
    variant: 'fallback',
    icon: <File className={fileTokenIconClassName} aria-hidden />,
    containerClassName: 'border-border bg-background hover:bg-accent',
    iconClassName: 'border-border bg-background text-muted-foreground',
    typeLabel: extensionLabel || 'FILE'
  }
}

function FileTokenTooltip({
  file,
  label,
  presentation
}: {
  file: FileMetadata | undefined
  label: string
  presentation: FileTokenPresentation
}) {
  const sizeLabel = typeof file?.size === 'number' ? formatFileSize(file.size) : undefined
  const hasPreview = Boolean(presentation.previewUrl)

  return (
    <div className={cn('space-y-2 text-left', hasPreview ? 'w-56' : 'min-w-36 max-w-56')}>
      {presentation.previewUrl && (
        <div className="overflow-hidden rounded-md border border-border bg-background">
          <img src={presentation.previewUrl} alt={label} className="h-28 w-full object-cover" />
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate font-medium text-popover-foreground text-xs leading-4">{label}</div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground leading-4">
          <span className="shrink-0 rounded-sm bg-muted px-1 font-medium uppercase">{presentation.typeLabel}</span>
          {sizeLabel && (
            <>
              <span className="text-border-muted">/</span>
              <span className="shrink-0">{sizeLabel}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function FileComposerToken(props: ComposerTokenProps) {
  const file = isFileMetadata(props.token.payload) ? props.token.payload : undefined
  const label = file?.origin_name || file?.name || props.token.label
  const presentation = getFileTokenPresentation(file, label)
  const title = props.token.description ?? props.token.promptText ?? label
  const tokenElement = (
    <span
      className={cn(
        'mx-0.5 inline-flex h-6 max-w-52 select-none items-center gap-1 rounded-md border px-1.5 align-baseline font-medium text-foreground text-xs leading-[inherit] transition-colors',
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
          'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border leading-none',
          presentation.iconClassName
        )}
        data-file-token-icon={presentation.variant}>
        {props.token.icon ? props.token.icon : presentation.icon}
      </span>
      {props.children ?? <span className={cn('min-w-0 truncate', props.maxWidthClassName)}>{label}</span>}
    </span>
  )

  return (
    <NormalTooltip
      content={<FileTokenTooltip file={file} label={label} presentation={presentation} />}
      side="top"
      sideOffset={8}
      delayDuration={300}
      contentProps={{
        className:
          'w-fit max-w-64 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg dark:bg-popover dark:text-popover-foreground [&_svg]:fill-popover dark:[&_svg]:fill-popover'
      }}>
      {tokenElement}
    </NormalTooltip>
  )
}

export function KnowledgeComposerToken(props: ComposerTokenProps) {
  return <ActiveComposerToken {...props} icon={tokenIconByKind.knowledge} />
}

export function QuoteComposerToken(props: ComposerTokenProps) {
  const quoteTooltipContent = getQuoteTooltipContent(props.token.description, props.token.promptText)
  const tokenElement = <ActiveComposerToken {...props} icon={tokenIconByKind.quote} />

  if (!quoteTooltipContent) return tokenElement

  return (
    <NormalTooltip
      content={<div className={QUOTE_TOOLTIP_BODY_CLASS_NAME}>{quoteTooltipContent}</div>}
      side="top"
      sideOffset={6}
      delayDuration={300}
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
} satisfies Record<ActiveComposerInputTokenKind, ComponentType<ComposerTokenProps>>

export function ComposerToken(props: ComposerTokenProps) {
  const TokenComponent = composerInputTokenComponentByKind[props.token.kind]
  return <TokenComponent {...props} />
}
