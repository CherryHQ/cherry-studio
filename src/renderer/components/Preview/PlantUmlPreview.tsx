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
  const source = isStreaming ? '' : children.trim()

  useLayoutEffect(() => {
    const container = containerRef.current
    container?.shadowRoot?.replaceChildren()
    setError(null)
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
        } else {
          renderSvgInShadowHost(result.svg, container, {
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
    </ImagePreviewLayout>
  )
}

export default memo(PlantUmlPreview)
