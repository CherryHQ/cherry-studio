import { FileQuestion, FileWarning, LoaderCircle } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { I18nextProvider, useTranslation } from 'react-i18next'

import { EmptyState, PortalContainerProvider } from '@cherrystudio/ui'

import { FilePreviewLayout } from './FilePreviewLayout'
import { resolvePreviewPlugin } from './filePreviewRegistry'
import { FilePreviewToolbarPortalHost, FilePreviewToolbarPortalProvider } from './FilePreviewToolbar'
import { createPreviewI18n } from './i18n'
import { PreviewHostContext } from './previewContext'
import type { PreviewSelection } from './selection'
import { assertPreviewRange, type PreviewDocument, PreviewError, type PreviewSource } from './source'
import type { PreviewDiagnostic, PreviewResources } from './types'

export interface PreviewProps {
  source: PreviewSource
  locale?: string
  header?: ReactNode
  refreshKey?: number
  resources?: PreviewResources
  onSelection?: (selection: PreviewSelection | null) => void
  onDiagnostic?: (diagnostic: PreviewDiagnostic) => void
  onError?: (error: PreviewError) => void
  onRequestOpen?: (reason: 'unsupported' | 'too_large') => void
}

function PreviewState({ kind }: { kind: 'loading' | 'error' | 'unsupported' }) {
  const { t } = useTranslation()
  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content>
        {kind === 'loading' ? (
          <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            <span>{t('file_preview.loading')}</span>
          </div>
        ) : (
          <EmptyState
            icon={kind === 'unsupported' ? FileQuestion : FileWarning}
            title={t(kind === 'unsupported' ? 'file_preview.unsupported.title' : 'file_preview.load_error.title')}
            description={t(
              kind === 'unsupported' ? 'file_preview.unsupported.description' : 'file_preview.load_error.description'
            )}
            className="h-full"
          />
        )}
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}

export function Preview({ locale = 'en-us', ...props }: PreviewProps) {
  const i18n = useMemo(() => createPreviewI18n(locale), [locale])
  return (
    <I18nextProvider i18n={i18n}>
      <PreviewSession {...props} />
    </I18nextProvider>
  )
}

function PreviewSession({
  source,
  header,
  refreshKey = 0,
  resources,
  onSelection,
  onDiagnostic,
  onError,
  onRequestOpen
}: Omit<PreviewProps, 'locale'>) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [session, setSession] = useState<{
    source: PreviewSource
    refreshKey: number
    document: PreviewDocument
  } | null>(null)
  const [failure, setFailure] = useState<{ source: PreviewSource; refreshKey: number } | null>(null)
  const closeRef = useRef<(() => void) | undefined>(undefined)
  const callbacks = useRef({ onDiagnostic, onError, onRequestOpen })
  callbacks.current = { onDiagnostic, onError, onRequestOpen }
  const failDocument = useCallback((error: unknown) => {
    closeRef.current?.()
    callbacks.current.onError?.(
      error instanceof PreviewError ? error : new PreviewError('load_error', 'Failed to load preview', { cause: error })
    )
  }, [])
  const reportDiagnostic = useCallback(
    (diagnostic: PreviewDiagnostic) => callbacks.current.onDiagnostic?.(diagnostic),
    []
  )
  const requestOpen = useCallback(
    (reason: 'unsupported' | 'too_large') => callbacks.current.onRequestOpen?.(reason),
    []
  )
  const hasOpenAction = onRequestOpen !== undefined
  const host = useMemo(
    () => ({
      resources,
      onDiagnostic: reportDiagnostic,
      onRequestOpen: hasOpenAction ? requestOpen : undefined,
      failDocument
    }),
    [resources, reportDiagnostic, requestOpen, hasOpenAction, failDocument]
  )
  const plugin = useMemo(() => resolvePreviewPlugin(source.name), [source.name])
  const Plugin = useMemo(() => (plugin ? lazy(plugin.load) : null), [plugin])

  useEffect(() => {
    setSession(null)
    setFailure(null)
    if (!plugin) {
      callbacks.current.onRequestOpen?.('unsupported')
      return
    }
    const controller = new AbortController()
    let opened: PreviewDocument | null = null
    let closed = false
    const close = () => {
      if (!opened || closed) return
      closed = true
      void opened.close().catch((error: unknown) =>
        callbacks.current.onDiagnostic?.({
          level: 'warn',
          context: 'Preview',
          message: 'Failed to close preview source',
          detail: error
        })
      )
    }
    closeRef.current = close
    void (async () => {
      try {
        opened = await source.open(controller.signal)
        if (controller.signal.aborted) {
          close()
          return
        }
        assertPreviewRange(opened.size, 0, opened.size)
        setSession({ source, refreshKey, document: opened })
      } catch (error) {
        close()
        if (controller.signal.aborted) return
        setFailure({ source, refreshKey })
        callbacks.current.onError?.(
          error instanceof PreviewError
            ? error
            : new PreviewError('load_error', 'Failed to open preview source', { cause: error })
        )
      }
    })()
    return () => {
      controller.abort()
      close()
      if (closeRef.current === close) closeRef.current = undefined
    }
  }, [source, refreshKey, plugin])

  const ready = session?.source === source && session.refreshKey === refreshKey ? session : null
  const failed = failure?.source === source && failure.refreshKey === refreshKey
  const content = !Plugin ? (
    <PreviewState kind="unsupported" />
  ) : failed ? (
    <PreviewState kind="error" />
  ) : !ready ? (
    <PreviewState kind="loading" />
  ) : (
    <ErrorBoundary
      key={`${source.id}:${refreshKey}:${ready.document.revision}`}
      resetKeys={[ready.document]}
      fallback={<PreviewState kind="error" />}
      onError={(error) => {
        failDocument(error)
        reportDiagnostic({ level: 'error', context: 'Preview', message: 'Failed to render preview', detail: error })
      }}>
      <Suspense fallback={<PreviewState kind="loading" />}>
        <Plugin
          key={`${source.id}:${refreshKey}:${ready.document.revision}`}
          sourceId={source.id}
          fileName={source.name}
          mediaType={source.mediaType}
          document={ready.document}
          onSelection={onSelection}
        />
      </Suspense>
    </ErrorBoundary>
  )

  return (
    <div ref={setRoot} data-file-preview-root="" className="file-preview-root h-full min-h-0 w-full">
      <PortalContainerProvider container={root}>
        <PreviewHostContext value={host}>
          {header === undefined ? (
            content
          ) : (
            <FilePreviewToolbarPortalProvider>
              <FilePreviewLayout.Frame>
                <div
                  data-testid="file-preview-header"
                  className="relative flex h-11 min-h-11 shrink-0 items-center px-3 after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-3 after:border-b after:border-border after:content-['']">
                  <div className="flex min-w-0 flex-1 items-center gap-2">{header}</div>
                  <FilePreviewToolbarPortalHost />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
              </FilePreviewLayout.Frame>
            </FilePreviewToolbarPortalProvider>
          )}
        </PreviewHostContext>
      </PortalContainerProvider>
    </div>
  )
}
