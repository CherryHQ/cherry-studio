import { Button, Tooltip } from '@cherrystudio/ui'
import HtmlPreviewFrame from '@renderer/components/CodeBlockView/HtmlPreviewFrame'
import CodeViewer from '@renderer/components/CodeViewer'
import { Code2, Eye, ZoomIn, ZoomOut } from 'lucide-react'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const DESKTOP_VIEWPORT_WIDTH = 1440
const DESKTOP_VIEWPORT_HEIGHT = 810
const DEFAULT_ZOOM = 100
const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10

interface HtmlArtifactViewProps {
  html: string
  title: string
}

const DesktopHtmlPreview = memo(function DesktopHtmlPreview({
  html,
  title,
  zoom
}: {
  html: string
  title: string
  zoom: number
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const zoomScale = zoom / 100

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const canvas = canvasRef.current
    if (!viewport || !canvas) return

    const syncScale = () => {
      const scale = Math.min(
        viewport.clientWidth / DESKTOP_VIEWPORT_WIDTH,
        viewport.clientHeight / DESKTOP_VIEWPORT_HEIGHT
      )
      if (scale > 0) canvas.style.transform = `scale(${scale})`
    }
    syncScale()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncScale)
      return () => window.removeEventListener('resize', syncScale)
    }

    const resizeObserver = new ResizeObserver(syncScale)
    resizeObserver.observe(viewport)
    return () => resizeObserver.disconnect()
  }, [])

  return (
    <div
      ref={viewportRef}
      data-testid="desktop-html-preview"
      className="relative aspect-video w-full overflow-hidden bg-background">
      <div
        ref={canvasRef}
        data-testid="desktop-html-canvas"
        className="absolute top-0 left-0 origin-top-left"
        style={{ width: DESKTOP_VIEWPORT_WIDTH, height: DESKTOP_VIEWPORT_HEIGHT }}>
        <div
          data-testid="desktop-html-zoom-layer"
          className="origin-top-left"
          style={{
            width: `${100 / zoomScale}%`,
            height: `${100 / zoomScale}%`,
            transform: `scale(${zoomScale})`
          }}>
          <HtmlPreviewFrame html={html} title={title} />
        </div>
      </div>
    </div>
  )
})

export const HtmlArtifactView = memo(function HtmlArtifactView({ html, title }: HtmlArtifactViewProps) {
  const { t } = useTranslation()
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const showCode = viewMode === 'code'
  const toggleLabel = t(showCode ? 'html_artifacts.preview' : 'html_artifacts.code')
  const handleToggle = () => {
    setViewMode((current) => (current === 'preview' ? 'code' : 'preview'))
  }
  const handleZoomOut = () => {
    setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))
  }
  const handleZoomIn = () => {
    setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))
  }
  const handleResetZoom = () => {
    setZoom(DEFAULT_ZOOM)
  }

  return (
    <div data-testid="html-artifact-view" className="w-full">
      <div
        data-testid="html-artifact-surface"
        className="group relative aspect-video w-full overflow-hidden rounded-xl border border-border-subtle bg-background">
        {showCode ? (
          <div className="h-full min-h-0">
            <CodeViewer value={html} language="html" height="100%" expanded={false} className="h-full" />
          </div>
        ) : (
          <DesktopHtmlPreview html={html} title={title} zoom={zoom} />
        )}

        <div
          data-testid="html-artifact-controls"
          className="pointer-events-none absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-md border border-border-subtle bg-popover p-0.5 opacity-0 shadow-sm transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 motion-reduce:transition-none">
          {!showCode && (
            <>
              <Tooltip content={t('preview.zoom_out')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  aria-label={t('preview.zoom_out')}
                  disabled={zoom <= MIN_ZOOM}
                  onClick={handleZoomOut}>
                  <ZoomOut className="size-3" />
                </Button>
              </Tooltip>
              <Tooltip content={t('preview.reset')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 min-h-6 min-w-9 px-1 text-muted-foreground text-xs tabular-nums"
                  aria-label={t('preview.reset')}
                  onClick={handleResetZoom}>
                  {zoom}%
                </Button>
              </Tooltip>
              <Tooltip content={t('preview.zoom_in')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  aria-label={t('preview.zoom_in')}
                  disabled={zoom >= MAX_ZOOM}
                  onClick={handleZoomIn}>
                  <ZoomIn className="size-3" />
                </Button>
              </Tooltip>
              <span className="h-3.5 w-px bg-border-subtle" />
            </>
          )}
          <Tooltip content={toggleLabel} delay={500}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6"
              aria-label={toggleLabel}
              aria-pressed={showCode}
              onClick={handleToggle}>
              {showCode ? <Eye className="size-3" /> : <Code2 className="size-3" />}
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
})
