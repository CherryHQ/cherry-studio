import { ChevronLeft, ChevronRight } from 'lucide-react'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { plantUmlRenderService } from '@renderer/services/PlantUmlRenderService'

import ImagePreviewLayout from './ImagePreviewLayout'
import { ShadowWhiteContainer } from './styles'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'
import { renderSvgInShadowHost } from './utils'

const logger = loggerService.withContext('PlantUmlPreview')

const PlantUmlPreview = ({
  children,
  enableToolbar = false,
  isStreaming = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [svgs, setSvgs] = useState<string[]>([])
  const [page, setPage] = useState(0)
  const source = isStreaming ? '' : children.trim()

  useLayoutEffect(() => {
    const container = containerRef.current
    container?.shadowRoot?.replaceChildren()
    setError(null)
    setSvgs([])
    setPage(0)
    setIsLoading(Boolean(source))
    if (!container || !source) return

    const controller = new AbortController()
    const { signal } = controller
    const timer = setTimeout(async () => {
      try {
        const result = await plantUmlRenderService.render(source, signal)
        if (signal.aborted) return
        if ('error' in result) {
          setError(result.line ? `${result.line}: ${result.error}` : result.error)
          setSvgs([])
        } else {
          setSvgs(result.svgs)
          setPage(0)
          renderSvgInShadowHost(result.svgs[0], container, {
            sanitize: {
              USE_PROFILES: { svg: true, svgFilters: true },
              FORBID_TAGS: ['style', 'image', 'feImage', 'use', 'animate', 'animateMotion', 'animateTransform', 'set']
            }
          })
        }
      } catch (error) {
        if (signal.aborted) return
        logger.warn('Local PlantUML rendering failed', {
          message: error instanceof Error ? error.message : String(error)
        })
        setError(
          error instanceof DOMException && error.name === 'TimeoutError'
            ? t('error.request_timeout')
            : t('error.render.block')
        )
      } finally {
        if (!signal.aborted) setIsLoading(false)
      }
    }, 300)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [source, t])

  const goToPage = (next: number) => {
    const svg = svgs[next]
    const container = containerRef.current
    if (!svg || !container) return
    setPage(next)
    renderSvgInShadowHost(svg, container, {
      sanitize: {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['style', 'image', 'feImage', 'use', 'animate', 'animateMotion', 'animateTransform', 'set']
      }
    })
  }

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      enableToolbar={enableToolbar}
      ref={ref}
      imageRef={containerRef}
      source="plantuml">
      <ShadowWhiteContainer
        ref={containerRef}
        className="plantuml-preview special-preview flex items-center justify-center"
      />
      {svgs.length > 1 && (
        <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 shadow-sm">
          <button
            type="button"
            aria-label={t('common.previous')}
            title={t('common.previous')}
            disabled={page === 0}
            onClick={() => goToPage(page - 1)}
            className="flex items-center disabled:opacity-40">
            <ChevronLeft size="0.9rem" />
          </button>
          <span className="min-w-14 text-center text-muted-foreground text-xs">
            {t('preview.page_indicator', { current: page + 1, total: svgs.length })}
          </span>
          <button
            type="button"
            aria-label={t('common.next')}
            title={t('common.next')}
            disabled={page === svgs.length - 1}
            onClick={() => goToPage(page + 1)}
            className="flex items-center disabled:opacity-40">
            <ChevronRight size="0.9rem" />
          </button>
        </div>
      )}
    </ImagePreviewLayout>
  )
}

export default memo(PlantUmlPreview)
