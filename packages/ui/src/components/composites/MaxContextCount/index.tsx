/**
 * @deprecated 此组件使用频率仅为 1 次，不符合 UI 库提取标准（需 ≥3 次）
 * 计划在未来版本中移除。此组件与业务逻辑耦合，不适合通用 UI 库。
 *
 * This component has only 1 usage and does not meet the UI library extraction criteria (requires ≥3 usages).
 * Planned for removal in future versions. This component is coupled with business logic and not suitable for a general UI library.
 */

// Original path: src/renderer/src/components/MaxContextCount.tsx
import { Infinity as InfinityIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

const MAX_CONTEXT_COUNT = 100

type Props = {
  maxContext: number
  style?: CSSProperties
  size?: number
  className?: string
  ref?: React.Ref<HTMLSpanElement>
}

export default function MaxContextCount({ maxContext, style, size = 14, className, ref }: Props) {
  return maxContext === MAX_CONTEXT_COUNT ? (
    <InfinityIcon size={size} style={style} className={className} aria-label="infinity" />
  ) : (
    <span ref={ref} style={style} className={className}>
      {maxContext.toString()}
    </span>
  )
}
