import { AlertCircle, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EMFJS, RTFJS, WMFJS } from 'rtf.js'

import { EmptyState } from '@cherrystudio/ui'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import { FilePreviewTooLarge } from '../../FilePreviewTooLarge'
import { usePreviewHost } from '../../previewContext'
import { PreviewError, readPreviewDocument } from '../../source'
import type { FilePreviewPluginProps } from '../../types'

const RTF_PREVIEW_MAX_SOURCE_BYTES = 10 * 1024 * 1024
const SAFE_LINK_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

RTFJS.loggingEnabled(false)
WMFJS.loggingEnabled(false)
EMFJS.loggingEnabled(false)

export default function RtfFilePreview({ fileName, document: previewDocument }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const { failDocument } = usePreviewHost()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    body.replaceChildren()

    void (async () => {
      try {
        const bytes = await readPreviewDocument(previewDocument, RTF_PREVIEW_MAX_SOURCE_BYTES, controller.signal)
        controller.signal.throwIfAborted()
        const rtf = new RTFJS.Document(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
          onHyperlink: (_create, hyperlink) => {
            let element: HTMLElement = document.createElement('span')
            try {
              const url = new URL(hyperlink.url())
              if (SAFE_LINK_PROTOCOLS.has(url.protocol)) {
                const anchor = document.createElement('a')
                anchor.href = url.href
                anchor.target = '_blank'
                anchor.rel = 'noopener noreferrer'
                element = anchor
              }
            } catch {
              // Relative and invalid links have no trusted base in a local document.
            }
            return { element, content: element }
          }
        })
        const elements = await rtf.render()
        if (!controller.signal.aborted) body.replaceChildren(...elements)
      } catch (loadError) {
        if (controller.signal.aborted) return
        const normalized = loadError instanceof Error ? loadError : new Error(String(loadError))
        failDocument?.(normalized)
        setError(normalized)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => {
      controller.abort()
      body.replaceChildren()
    }
  }, [previewDocument, failDocument])

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content>
        {loading ? (
          <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            <span>{t('file_preview.loading')}</span>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="h-full">
            {error instanceof PreviewError && error.code === 'too_large' ? (
              <FilePreviewTooLarge sizeBytes={previewDocument.size} limitBytes={RTF_PREVIEW_MAX_SOURCE_BYTES} />
            ) : (
              <EmptyState
                icon={AlertCircle}
                title={t('file_preview.load_error.title')}
                description={t('file_preview.load_error.description')}
                className="h-full"
              />
            )}
          </div>
        ) : null}
        <div hidden={loading || error !== null} className="p-4">
          {/* A white document canvas preserves authored RTF foreground and highlight colors in either theme. */}
          <div
            ref={bodyRef}
            role="document"
            aria-label={fileName}
            tabIndex={0}
            className="mx-auto min-h-48 max-w-4xl rounded-sm bg-white p-6 text-black wrap-anywhere focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset [&_a]:underline [&_img]:max-w-full [&_svg]:max-w-full"
          />
        </div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
