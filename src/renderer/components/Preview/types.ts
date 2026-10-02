/**
 * 预览组件的基本 props
 */
export interface BasicPreviewProps {
  children: string
  enableToolbar?: boolean
  /** True while the source is still being streamed / generated. */
  isStreaming?: boolean
}

/**
 * 通过 useImperativeHandle 暴露的方法类型
 */
export interface BasicPreviewHandles {
  pan: (dx: number, dy: number, absolute?: boolean) => void
  zoom: (delta: number, absolute?: boolean) => void
  copy: () => Promise<boolean>
  download: (format: 'svg' | 'png') => Promise<void>
}
