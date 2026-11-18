import { FileWarning, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@cherrystudio/ui'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import { usePreviewHost, usePreviewLogger } from '../../previewContext'
import type { FilePreviewPluginProps } from '../../types'
import { loadPptdProject, requireProjectFileReader, type PptdProject } from './pptdProject'
import { PptdSlideCanvas } from './PptdSlideCanvas'

type LoadState = { kind: 'loading' } | { kind: 'error'; reason: string } | { kind: 'ready'; project: PptdProject }

function PptdFilePreview({ document }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const { resources, onRequestReload } = usePreviewHost()
  const logger = usePreviewLogger('pptd')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [pageIndex, setPageIndex] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [view, setView] = useState<'preview' | 'source'>('preview')
  const [sourceText, setSourceText] = useState<string | null>(null)

  // AC7: the source toggle reads the manifest text fresh; the plugin never writes.
  useEffect(() => {
    if (view !== 'source') return
    const controller = new AbortController()
    document
      .readRange(0, document.size)
      .then((bytes) => {
        if (!controller.signal.aborted) setSourceText(new TextDecoder().decode(bytes))
      })
      .catch(() => {
        if (!controller.signal.aborted) setSourceText(null)
      })
    return () => controller.abort()
  }, [view, document])

  const readProjectFile = useMemo(() => {
    try {
      return requireProjectFileReader(resources)
    } catch {
      return null
    }
  }, [resources])

  // Declared custom fonts load through the FontFace API for the lifetime of
  // the ready project and are removed on cleanup. A failed load falls back to
  // installed fonts (a warning, never a broken deck).
  useEffect(() => {
    if (state.kind !== 'ready' || typeof FontFace === 'undefined') return
    const declared = state.project.presentation.customFonts ?? []
    if (declared.length === 0) return
    const added: FontFace[] = []
    let cancelled = false
    for (const { family, src } of declared) {
      const face = new FontFace(family, `url("${src}")`)
      face.load().then(
        (loaded) => {
          if (cancelled) return
          // `document` here is the PreviewDocument prop, so reach the DOM
          // font set through globalThis.
          globalThis.document.fonts.add(loaded)
          added.push(loaded)
        },
        (error: unknown) => logger.warn('PPTD custom font failed to load', { family, src, error })
      )
    }
    return () => {
      cancelled = true
      for (const face of added) globalThis.document.fonts.delete(face)
    }
  }, [state, logger])

  useEffect(() => {
    if (!readProjectFile) {
      setState({ kind: 'error', reason: t('file_preview.pptd.no_project_access') })
      return
    }
    const controller = new AbortController()
    setState({ kind: 'loading' })
    loadPptdProject(document, readProjectFile, controller.signal)
      .then((project) => {
        // A stale load (document replaced or reload re-requested while this
        // read was in flight) must not overwrite newer state.
        if (controller.signal.aborted) return
        setState({ kind: 'ready', project })
        setPageIndex(0)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        logger.error('Failed to load PPTD project', error)
        setState({ kind: 'error', reason: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
  }, [document, readProjectFile, reloadNonce, logger, t])

  if (state.kind === 'loading') {
    return (
      <FilePreviewLayout.Frame>
        <FilePreviewLayout.Content>
          <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            <span>{t('file_preview.loading')}</span>
          </div>
        </FilePreviewLayout.Content>
      </FilePreviewLayout.Frame>
    )
  }

  if (state.kind === 'error') {
    return (
      <FilePreviewLayout.Frame>
        <FilePreviewLayout.Content>
          <EmptyState
            icon={FileWarning}
            title={t('file_preview.load_error.title')}
            description={state.reason}
            className="h-full"
          />
        </FilePreviewLayout.Content>
      </FilePreviewLayout.Frame>
    )
  }

  const { project } = state
  const clampedIndex = Math.min(pageIndex, project.pages.length - 1)
  const page = project.pages[clampedIndex]
  const thumbZoom = (140 / project.presentation.size[0]) * 100

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content>
        <div className="flex h-full flex-col">
          <div className="flex flex-1 overflow-hidden">
            {view === 'preview' && (
              <div className="flex w-44 flex-col gap-2 overflow-y-auto border-r border-border p-2">
                {project.pages.map((thumbPage, index) => (
                  <button
                    key={thumbPage.path}
                    type="button"
                    aria-current={index === clampedIndex}
                    onClick={() => setPageIndex(index)}
                    className={`overflow-hidden rounded border text-left ${
                      index === clampedIndex ? 'border-primary' : 'border-border'
                    }`}>
                    <div className="pointer-events-none">
                      <PptdSlideCanvas
                        presentation={project.presentation}
                        page={thumbPage}
                        zoom={thumbZoom}
                        readProjectFile={readProjectFile ?? undefined}
                        thumbnail
                      />
                    </div>
                  </button>
                ))}
              </div>
            )}
            {view === 'source' ? (
              <pre className="flex-1 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">
                {sourceText ?? t('file_preview.loading')}
              </pre>
            ) : (
              <div className="flex flex-1 items-center justify-center overflow-auto p-4">
                // Keyed by page path: two pages may reuse element ids and array // positions, and without a page-bound
                key per-element state (image // failure, natural size) leaks into the next page.
                <PptdSlideCanvas
                  key={page.path}
                  presentation={project.presentation}
                  page={page}
                  zoom={zoom}
                  readProjectFile={readProjectFile ?? undefined}
                />
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-3 border-t border-border p-2 text-sm">
            <button type="button" disabled={clampedIndex <= 0} onClick={() => setPageIndex(clampedIndex - 1)}>
              {t('file_preview.pptd.previous_page')}
            </button>
            <span>
              {clampedIndex + 1} / {project.pages.length}
            </span>
            <button
              type="button"
              disabled={clampedIndex >= project.pages.length - 1}
              onClick={() => setPageIndex(clampedIndex + 1)}>
              {t('file_preview.pptd.next_page')}
            </button>
            <button type="button" onClick={() => setZoom((value) => Math.max(25, value - 10))}>
              -
            </button>
            <span>{zoom}%</span>
            <button type="button" onClick={() => setZoom((value) => Math.min(400, value + 10))}>
              +
            </button>
            {/* AC6: refresh asks the host for a fresh document (new revision)
                when it can; the local nonce re-read is the fallback for hosts
                without document replacement. */}
            <button
              type="button"
              onClick={() => (onRequestReload ? onRequestReload() : setReloadNonce((nonce) => nonce + 1))}>
              {t('file_preview.pptd.refresh')}
            </button>
            <button type="button" onClick={() => setView((value) => (value === 'preview' ? 'source' : 'preview'))}>
              {view === 'preview' ? t('file_preview.pptd.source_view') : t('file_preview.pptd.preview_view')}
            </button>
          </div>
        </div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}

export default PptdFilePreview
