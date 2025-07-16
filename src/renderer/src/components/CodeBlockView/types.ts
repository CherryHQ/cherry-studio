import { CodeTool } from '@renderer/components/CodeToolbar'

/**
 * 预览组件的基本 props
 */
export interface BasicPreviewProps {
  children: string
  setTools?: (value: React.SetStateAction<CodeTool[]>) => void
}

/**
 * 视图模式
 */
export type ViewMode = 'source' | 'special' | 'split'
