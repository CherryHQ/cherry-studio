import type { BasicPreviewHandles, BasicPreviewProps } from '@renderer/components/Preview/types'
import { type ComponentType, lazy, type RefObject } from 'react'

/**
 * 特殊视图语言列表
 */
export const SPECIAL_VIEWS = ['mermaid', 'plantuml', 'svg', 'dot', 'graphviz']

type SpecialViewProps = BasicPreviewProps & { ref?: RefObject<BasicPreviewHandles | null> }

/**
 * 特殊视图组件映射表
 */
export const SPECIAL_VIEW_COMPONENTS = {
  mermaid: lazy<ComponentType<SpecialViewProps>>(() =>
    import('@renderer/components/Preview/MermaidPreview').then((module) => ({ default: module.default }))
  ),
  plantuml: lazy<ComponentType<SpecialViewProps>>(() =>
    import('@renderer/components/Preview/PlantUmlPreview').then((module) => ({ default: module.default }))
  ),
  svg: lazy<ComponentType<SpecialViewProps>>(() =>
    import('@renderer/components/Preview/SvgPreview').then((module) => ({ default: module.default }))
  ),
  dot: lazy<ComponentType<SpecialViewProps>>(() =>
    import('@renderer/components/Preview/GraphvizPreview').then((module) => ({ default: module.default }))
  ),
  graphviz: lazy<ComponentType<SpecialViewProps>>(() =>
    import('@renderer/components/Preview/GraphvizPreview').then((module) => ({ default: module.default }))
  )
} as const

/**
 * 折叠状态下代码块的最大高度（px）
 */
export const MAX_COLLAPSED_CODE_HEIGHT = 350
