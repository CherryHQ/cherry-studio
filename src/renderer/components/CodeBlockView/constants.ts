import { type ComponentType, lazy, type RefObject } from 'react'

import type { BasicPreviewHandles, BasicPreviewProps } from '@renderer/components/Preview/types'

type SpecialViewProps = BasicPreviewProps & { ref?: RefObject<BasicPreviewHandles | null> }

/**
 * 特殊视图组件映射表
 */
export const SPECIAL_VIEW_COMPONENTS = {
  latex: {
    component: lazy(() => import('@renderer/components/Preview/LatexPreview')),
    supportsImageActions: false
  },
  mermaid: {
    component: lazy<ComponentType<SpecialViewProps>>(() => import('@renderer/components/Preview/MermaidPreview')),
    supportsImageActions: true
  },
  plantuml: {
    component: lazy<ComponentType<SpecialViewProps>>(() => import('@renderer/components/Preview/PlantUmlPreview')),
    supportsImageActions: true
  },
  svg: {
    component: lazy<ComponentType<SpecialViewProps>>(() => import('@renderer/components/Preview/SvgPreview')),
    supportsImageActions: true
  },
  dot: {
    component: lazy<ComponentType<SpecialViewProps>>(() => import('@renderer/components/Preview/GraphvizPreview')),
    supportsImageActions: true
  },
  graphviz: {
    component: lazy<ComponentType<SpecialViewProps>>(() => import('@renderer/components/Preview/GraphvizPreview')),
    supportsImageActions: true
  },
  echarts: {
    component: lazy<ComponentType<SpecialViewProps>>(() => import('@renderer/components/Preview/EChartsPreview')),
    supportsImageActions: true
  }
} as const

export const SPECIAL_VIEWS = Object.keys(SPECIAL_VIEW_COMPONENTS)

/**
 * 折叠状态下代码块的最大高度（px）
 */
export const MAX_COLLAPSED_CODE_HEIGHT = 350
