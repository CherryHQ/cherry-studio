import type { LucideIcon } from 'lucide-react'
import {
  AlignLeft,
  Copy,
  Eye,
  Pencil,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  Trash,
  WrapText,
  Wrench
} from 'lucide-react'
import React from 'react'

// 创建一个 Icon 工厂函数
export function createIcon(IconComponent: LucideIcon, defaultSize: string | number = '1rem') {
  const Icon = ({
    ref,
    ...props
  }: React.ComponentProps<typeof IconComponent> & { ref?: React.RefObject<SVGSVGElement | null> }) => (
    <IconComponent ref={ref} size={defaultSize} {...props} />
  )
  Icon.displayName = `Icon(${IconComponent.displayName || IconComponent.name})`
  return Icon
}

// 预定义的常用图标（向后兼容，只导入需要的图标）
export const CopyIcon = createIcon(Copy)
export const DeleteIcon = createIcon(Trash)
export const EditIcon = createIcon(Pencil)
export const RefreshIcon = createIcon(RefreshCw)
export const ResetIcon = createIcon(RotateCcw)

/**
 * @deprecated 此组件使用频率为 0 次，不符合 UI 库提取标准（需 ≥3 次）
 * 计划在未来版本中移除。虽然主项目中有本地副本，但完全未被导入使用。
 *
 * This icon has 0 usages and does not meet the UI library extraction criteria (requires ≥3 usages).
 * Planned for removal in future versions.
 */
export const ToolIcon = createIcon(Wrench)

export const VisionIcon = createIcon(Eye)
export const WebSearchIcon = createIcon(Search)
export const WrapIcon = createIcon(WrapText)
export const UnWrapIcon = createIcon(AlignLeft)
export const OcrIcon = createIcon(ScanLine)

// 导出 createIcon 以便用户自行创建图标组件
export type { LucideIcon }
export type { LucideProps } from 'lucide-react'
