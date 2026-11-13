import { nanoid } from 'nanoid'
import React, { memo, useCallback, useRef } from 'react'

import { resolveMermaidTheme } from '@cherrystudio/ui/mermaid'
import { useTheme } from '@renderer/hooks/useTheme'
import { mermaidRenderService } from '@renderer/services/MermaidRenderService'
import { cn } from '@renderer/utils/style'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
import { ShadowTransparentContainer } from './styles'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'
import { renderSvgInShadowHost } from './utils'

/**
 * Previews a Mermaid diagram rendered by Merman in a Web Worker, themed from the design tokens around it.
 * Rendering is debounced and the SVG lives in a shadow root so its styles stay scoped.
 */
const MermaidPreview = ({
  children,
  enableToolbar = false,
  className,
  fit = 'width',
  ref
}: BasicPreviewProps & {
  className?: string
  /** `contain` fits the diagram inside a host with a fixed height, such as a file preview. */
  fit?: 'width' | 'contain'
  ref?: React.RefObject<BasicPreviewHandles | null>
}) => {
  const { theme } = useTheme()
  const diagramId = useRef<string>(`mermaid-${nanoid(6)}`).current

  const renderMermaid = useCallback(
    async (content: string, container: HTMLDivElement) => {
      const svg = await mermaidRenderService.render(content, { theme: resolveMermaidTheme(container), diagramId })
      renderSvgInShadowHost(svg, container, { fit })
    },
    // Re-render on a theme switch: the diagram reads its colours from the tokens at render time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diagramId, fit, theme]
  )

  const { containerRef, error, isLoading } = useDebouncedRender(children, renderMermaid, { debounceDelay: 300 })

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      enableToolbar={enableToolbar}
      ref={ref}
      imageRef={containerRef}
      source="mermaid"
      className={className}>
      <ShadowTransparentContainer
        ref={containerRef}
        className={cn('mermaid special-preview flex items-center justify-center', fit === 'contain' && 'h-full')}
      />
    </ImagePreviewLayout>
  )
}

export default memo(MermaidPreview)
