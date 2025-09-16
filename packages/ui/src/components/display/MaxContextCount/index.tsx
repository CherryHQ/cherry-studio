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
