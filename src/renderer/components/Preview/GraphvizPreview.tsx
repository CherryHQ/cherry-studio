import React, { memo, useCallback } from 'react'

import { resolveMermaidTheme } from '@cherrystudio/ui/mermaid'
import { useTheme } from '@renderer/hooks/useTheme'
import { AsyncInitializer } from '@shared/utils/async'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
import { ShadowTransparentContainer } from './styles'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'
import { renderSvgInShadowHost } from './utils'

// 管理 viz 实例
const vizInitializer = new AsyncInitializer(async () => {
  const module = await import('@viz-js/viz')
  return await module.instance()
})

/**
 * 预览 Graphviz 图表
 * - 使用 useDebouncedRender 改善体验
 * - 使用 shadow dom 渲染 SVG
 */
const GraphvizPreview = ({
  children,
  enableToolbar = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  const { theme } = useTheme()

  // Default colours come from the design tokens behind the diagram; the DOT source can still override them.
  const renderGraphviz = useCallback(
    async (content: string, container: HTMLDivElement) => {
      const viz = await vizInitializer.get()
      const { roles } = resolveMermaidTheme(container)
      // Viz ignores its node/edge default options, so prepend defaults to the body; Helvetica has Graphviz metrics.
      // ponytail: assumes the first `{` opens the body; a `{` in a quoted graph name before it would break this.
      const font = 'fontname="Helvetica,Arial,sans-serif"'
      const defaults = [
        `graph [bgcolor="transparent" color="${roles.border}" fontcolor="${roles.text}" ${font}];`,
        `node [color="${roles.border}" fontcolor="${roles.text}" ${font}];`,
        `edge [color="${roles.line}" fontcolor="${roles.text}" ${font}];`
      ].join(' ')
      const svg = viz.renderString(content.replace('{', `{ ${defaults}`), { format: 'svg' })
      renderSvgInShadowHost(svg, container)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme]
  )

  // 使用预览渲染器 hook
  const { containerRef, error, isLoading } = useDebouncedRender(children, renderGraphviz, {
    debounceDelay: 300
  })

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      enableToolbar={enableToolbar}
      ref={ref}
      imageRef={containerRef}
      source="graphviz">
      <ShadowTransparentContainer
        ref={containerRef}
        className="graphviz special-preview flex items-center justify-center"
      />
    </ImagePreviewLayout>
  )
}

export default memo(GraphvizPreview)
