import { Icon } from '@iconify/react'
import { FileText } from 'lucide-react'
import type { ReactNode } from 'react'

import { loggerService } from '@logger'
import { FILE_TYPE } from '@renderer/types/file'
import { getFileIconName } from '@renderer/utils/fileIconName'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { fileUrlToPath, toSafeFileUrl } from '@shared/utils/file'

const logger = loggerService.withContext('fileTokenPresentation')

// `getFilePreviewUrl` runs on every token render; dedupe the warn per offending
// path/URL so a bad attachment can't flood the log across rerenders.
const warnedPreviewKeys = new Set<string>()

const MATERIAL_ICON_PREFIX = 'material-icon-theme:'

/**
 * The glyph comes from the app-wide file-icon convention — `getFileIconName` + material-icon-theme,
 * the same mapping the file tree, clickable file paths and agent file mentions use — so every file
 * surface names a `.ts` a TypeScript icon instead of a token-local "code" bucket. The chip owns the
 * slot size (`composerChipIconBoxClassName` is em-based), so the icon just fills it.
 */
const fileTokenIconClassName = 'size-full shrink-0'
const fileTokenPreviewIconClassName = 'size-7'

interface FileTokenVisualPreset {
  defaultTypeLabel: string
  displayExtensions?: readonly string[]
}

const fileTokenVisualPresetByVariant = {
  image: {
    defaultTypeLabel: 'IMAGE',
    displayExtensions: ['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp']
  },
  word: {
    defaultTypeLabel: 'WORD',
    displayExtensions: ['doc', 'docx']
  },
  excel: {
    defaultTypeLabel: 'EXCEL',
    displayExtensions: ['csv', 'xls', 'xlsx']
  },
  powerpoint: {
    defaultTypeLabel: 'PPT',
    displayExtensions: ['ppt', 'pptx']
  },
  pdf: {
    defaultTypeLabel: 'PDF',
    displayExtensions: ['pdf']
  },
  markdown: {
    defaultTypeLabel: 'MD',
    displayExtensions: ['markdown', 'md', 'mdx']
  },
  json: {
    defaultTypeLabel: 'JSON',
    displayExtensions: ['json', 'jsonl']
  },
  code: {
    defaultTypeLabel: 'CODE',
    displayExtensions: ['css', 'go', 'html', 'java', 'js', 'jsx', 'py', 'rs', 'ts', 'tsx', 'xml', 'yaml', 'yml']
  },
  document: {
    defaultTypeLabel: 'DOCUMENT'
  },
  text: {
    defaultTypeLabel: 'TEXT',
    displayExtensions: ['log', 'text', 'txt']
  },
  fallback: {
    defaultTypeLabel: 'FILE'
  }
} satisfies Record<string, FileTokenVisualPreset>

type FileTokenVariant = keyof typeof fileTokenVisualPresetByVariant

export interface FileTokenPresentation {
  variant: FileTokenVariant
  icon: ReactNode
  previewIcon: ReactNode
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

function getFilePreviewUrl(file: ComposerAttachment | undefined, fallbackLabel: string, readOnlyPreviewUrl?: string) {
  if (file?.type !== FILE_TYPE.IMAGE) return undefined
  const extension = getNormalizedFileExtension(file, fallbackLabel)
  // A path-less attachment (the message-editing round-trip) previews from its stored `file://` URL.
  const previewUrl = readOnlyPreviewUrl ?? file.previewUrl

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

/**
 * Tokens restored from a message have no attachment, so the label stands in for the file name — it
 * carries the extension (and the path, when the attachment was unknown) either way.
 */
function getFileTokenIcon(file: ComposerAttachment | undefined, fallbackLabel: string, className: string) {
  const iconName = getFileIconName(file?.origin_name || file?.name || fallbackLabel || file?.path || '')
  return (
    <Icon
      icon={`${MATERIAL_ICON_PREFIX}${iconName}`}
      className={className}
      aria-hidden
      fallback={<FileText className={className} aria-hidden />}
    />
  )
}

export function getFileTokenPresentation(
  file: ComposerAttachment | undefined,
  fallbackLabel: string,
  previewUrl?: string
): FileTokenPresentation {
  const extensionLabel = getFileExtensionLabel(file, fallbackLabel)
  const variant = getFileTokenVariant(file, fallbackLabel)
  const preset = fileTokenVisualPresetByVariant[variant]

  return {
    variant,
    icon: getFileTokenIcon(file, fallbackLabel, fileTokenIconClassName),
    previewIcon: getFileTokenIcon(file, fallbackLabel, fileTokenPreviewIconClassName),
    typeLabel: extensionLabel || preset.defaultTypeLabel,
    previewUrl: variant === 'image' ? getFilePreviewUrl(file, fallbackLabel, previewUrl) : undefined
  }
}
