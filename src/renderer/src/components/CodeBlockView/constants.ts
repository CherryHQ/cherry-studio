import { GraphvizPreview, MermaidPreview, PlantUmlPreview, SvgPreview } from '@renderer/components/Preview'

/**
 * 特殊视图语言列表
 */
export const SPECIAL_VIEWS = ['mermaid', 'plantuml', 'svg', 'dot', 'graphviz']

/**
 * 特殊视图组件映射表
 */
export const SPECIAL_VIEW_COMPONENTS = {
  mermaid: MermaidPreview,
  plantuml: PlantUmlPreview,
  svg: SvgPreview,
  dot: GraphvizPreview,
  graphviz: GraphvizPreview
} as const
