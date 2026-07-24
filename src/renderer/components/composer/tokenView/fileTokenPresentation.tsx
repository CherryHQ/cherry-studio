import { loggerService } from '@logger'
import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { fileUrlToPath, toSafeFileUrl } from '@shared/utils/file'
import { File, FileCode2, FileImage, FileJson, FileSpreadsheet, FileText, FileType2, Presentation } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'

const logger = loggerService.withContext('fileTokenPresentation')

// `getFilePreviewUrl` runs on every token render; dedupe the warn per offending
// path/URL so a bad attachment can't flood the log across rerenders.
const warnedPreviewKeys = new Set<string>()

const fileTokenIconClassName = 'size-3 shrink-0 text-current'
const fileTokenContainerClassName = 'border-border bg-background hover:bg-accent'

interface FileTokenVisualPreset {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: true }>
  iconClassName: string
  defaultTypeLabel: string
  displayExtensions?: readonly string[]
}

const fileTokenVisualPresetByVariant = {
  image: {
    icon: FileImage,
    iconClassName: 'bg-[var(--color-cyan-100)] text-[var(--color-cyan-700)]',
    defaultTypeLabel: 'IMAGE',
    displayExtensions: ['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp']
  },
  word: {
    icon: FileType2,
    iconClassName: 'bg-[var(--color-blue-100)] text-[var(--color-blue-700)]',
    defaultTypeLabel: 'WORD',
    displayExtensions: ['doc', 'docx']
  },
  excel: {
    icon: FileSpreadsheet,
    iconClassName: 'bg-[var(--color-green-100)] text-[var(--color-green-700)]',
    defaultTypeLabel: 'EXCEL',
    displayExtensions: ['csv', 'xls', 'xlsx']
  },
  powerpoint: {
    icon: Presentation,
    iconClassName: 'bg-[var(--color-orange-100)] text-[var(--color-orange-700)]',
    defaultTypeLabel: 'PPT',
    displayExtensions: ['ppt', 'pptx']
  },
  pdf: {
    icon: FileText,
    iconClassName: 'bg-[var(--color-red-100)] text-[var(--color-red-700)]',
    defaultTypeLabel: 'PDF',
    displayExtensions: ['pdf']
  },
  markdown: {
    icon: FileText,
    iconClassName: 'bg-[var(--color-gray-100)] text-[var(--color-gray-700)]',
    defaultTypeLabel: 'MD',
    displayExtensions: ['markdown', 'md', 'mdx']
  },
  json: {
    icon: FileJson,
    iconClassName: 'bg-[var(--color-violet-100)] text-[var(--color-violet-700)]',
    defaultTypeLabel: 'JSON',
    displayExtensions: ['json', 'jsonl']
  },
  code: {
    icon: FileCode2,
    iconClassName: 'bg-[var(--color-indigo-100)] text-[var(--color-indigo-700)]',
    defaultTypeLabel: 'CODE',
    displayExtensions: ['css', 'go', 'html', 'java', 'js', 'jsx', 'py', 'rs', 'ts', 'tsx', 'xml', 'yaml', 'yml']
  },
  document: {
    icon: FileText,
    iconClassName: 'bg-[var(--color-slate-100)] text-[var(--color-slate-700)]',
    defaultTypeLabel: 'DOCUMENT'
  },
  text: {
    icon: FileText,
    iconClassName: 'bg-[var(--color-info-bg)] text-info',
    defaultTypeLabel: 'TEXT',
    displayExtensions: ['log', 'text', 'txt']
  },
  fallback: {
    icon: File,
    iconClassName: 'bg-accent text-muted-foreground',
    defaultTypeLabel: 'FILE'
  }
} satisfies Record<string, FileTokenVisualPreset>

type FileTokenVariant = keyof typeof fileTokenVisualPresetByVariant

export interface FileTokenPresentation {
  variant: FileTokenVariant
  icon: ReactNode
  previewIcon: ReactNode
  containerClassName: string
  iconClassName: string
  typeLabel: string
  previewUrl?: string
}

const fileTokenVariantByExtension = new Map<string, FileTokenVariant>(
  Object.entries(fileTokenVisualPresetByVariant).flatMap(([variant, preset]) => {
    const displayExtensions = 'displayExtensions' in preset ? preset.displayExtensions : undefined
    return (displayExtensions ?? []).map((extension) => [extension, variant as FileTokenVariant])
  })
)

function getNormalizedFileExtension(file: ComposerAttachment | undefined, fallbackLabel: string) {
  const extension = file?.ext || fallbackLabel.match(/\.[^.]+$/)?.[0] || ''
  return extension.replace(/^\./, '').toLowerCase()
}

function getFileExtensionLabel(file: ComposerAttachment | undefined, fallbackLabel: string) {
  return getNormalizedFileExtension(file, fallbackLabel).toUpperCase()
}

function getFilePreviewUrl(file: ComposerAttachment | undefined, fallbackLabel: string, previewUrl?: string) {
  if (file?.type !== FILE_TYPE.IMAGE) return undefined
  const extension = getNormalizedFileExtension(file, fallbackLabel)

  if (previewUrl) {
    // `fileUrlToPath` (decodeURIComponent) throws URIError on malformed percent-
    // encoding like `file:///tmp/100%.png` — which `new URL()` accepts — so the
    // whole conversion (parse, path extraction, schema check, URL rebuild) stays
    // inside one guard; a narrower try around only `new URL` would crash render.
    try {
      const url = new URL(previewUrl)
      if (url.protocol !== 'file:') return previewUrl
      const parsedPath = AbsoluteFilePathSchema.safeParse(fileUrlToPath(url))
      if (!parsedPath.success) {
        if (!warnedPreviewKeys.has(previewUrl)) {
          warnedPreviewKeys.add(previewUrl)
          logger.warn('getFilePreviewUrl: non-absolute path in file: previewUrl', { previewUrl })
        }
        return undefined
      }
      return toSafeFileUrl(parsedPath.data, extension || null)
    } catch {
      return undefined
    }
  }
  if (!file.path) return undefined
  const parsedPath = AbsoluteFilePathSchema.safeParse(file.path)
  if (!parsedPath.success) {
    if (!warnedPreviewKeys.has(file.path)) {
      warnedPreviewKeys.add(file.path)
      logger.warn('getFilePreviewUrl: non-absolute/invalid attachment path', { path: file.path })
    }
    return undefined
  }
  return toSafeFileUrl(parsedPath.data, extension || null)
}

function getFileTokenVariant(file: ComposerAttachment | undefined, fallbackLabel: string): FileTokenVariant {
  const extension = getNormalizedFileExtension(file, fallbackLabel)
  const extensionVariant = fileTokenVariantByExtension.get(extension)

  if (file?.type === FILE_TYPE.IMAGE) return 'image'
  if (extensionVariant) return extensionVariant
  if (file?.type === FILE_TYPE.DOCUMENT) return 'document'
  if (file?.type === FILE_TYPE.TEXT) return 'text'

  return 'fallback'
}

export function getFileTokenPresentation(
  file: ComposerAttachment | undefined,
  fallbackLabel: string,
  previewUrl?: string
): FileTokenPresentation {
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
    previewUrl: variant === 'image' ? getFilePreviewUrl(file, fallbackLabel, previewUrl) : undefined
  }
}
