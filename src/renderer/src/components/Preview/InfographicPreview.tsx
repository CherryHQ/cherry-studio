import type { Infographic } from '@antv/infographic'
import { useInfographic } from '@renderer/hooks/useInfographic'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
import { ShadowTransparentContainer } from './styles'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'

const InfographicPreview = ({
  children,
  enableToolbar = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  const {
    Infographic: InfographicClass,
    isLoading: isLoadingInfographic,
    error: infographicError,
    forceRenderKey,
    theme
  } = useInfographic()
  const [isVisible, setIsVisible] = useState(true)
  const infographicInstanceRef = useRef<Infographic | null>(null)

  const renderInfographic = useCallback(
    async (content: string, container: HTMLDivElement) => {
      if (!InfographicClass) return

      const { width } = container.getBoundingClientRect()
      if (width === 0) return

      if (infographicInstanceRef.current) {
        infographicInstanceRef.current.destroy()
        infographicInstanceRef.current = null
      }

      container.innerHTML = ''

      const infographic = new InfographicClass({
        container,
        width,
        height: Math.min(width * 0.6, 400),
        editable: false,
        theme
      })

      try {
        await infographic.render(content)
        infographicInstanceRef.current = infographic
      } catch (err) {
        infographic.destroy()
        throw err
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [InfographicClass, forceRenderKey, theme]
  )

  const shouldRender = useCallback(() => {
    return !isLoadingInfographic && isVisible && !!InfographicClass
  }, [isLoadingInfographic, isVisible, InfographicClass])

  const {
    containerRef,
    error: renderError,
    isLoading: isRendering
  } = useDebouncedRender(children, renderInfographic, {
    debounceDelay: 300,
    shouldRender
  })

  useEffect(() => {
    if (!containerRef.current) return

    const checkVisibility = () => {
      const element = containerRef.current
      if (!element) return

      const currentlyVisible = element.offsetParent !== null && element.offsetWidth > 0 && element.offsetHeight > 0
      setIsVisible(currentlyVisible)
    }

    checkVisibility()

    const observer = new MutationObserver(() => {
      checkVisibility()
    })

    let targetElement = containerRef.current.parentElement
    while (targetElement) {
      observer.observe(targetElement, {
        attributes: true,
        attributeFilter: ['class', 'style']
      })

      if (targetElement.className?.includes('fold')) {
        break
      }

      targetElement = targetElement.parentElement
    }

    return () => {
      observer.disconnect()
    }
  }, [containerRef])

  useEffect(() => {
    return () => {
      if (infographicInstanceRef.current) {
        infographicInstanceRef.current.destroy()
        infographicInstanceRef.current = null
      }
    }
  }, [])

  const isLoading = isLoadingInfographic || isRendering
  const error = infographicError || renderError

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      enableToolbar={enableToolbar}
      ref={ref}
      imageRef={containerRef}
      source="infographic">
      <ShadowTransparentContainer ref={containerRef} className="infographic special-preview" />
    </ImagePreviewLayout>
  )
}

export default memo(InfographicPreview)
