// Original path: src/renderer/src/components/MaxContextCount.tsx
import { Infinity as InfinityIcon } from 'lucide-react'
import { CSSProperties } from 'react'

const MAX_CONTEXT_COUNT = 100

type Props = {
  maxContext: number
  style?: CSSProperties
  size?: number
}

export default function MaxContextCount({ maxContext, style, size = 14 }: Props) {
  return maxContext === MAX_CONTEXT_COUNT ? (
    <InfinityIcon size={size} style={style} aria-label="infinity" />
  ) : (
    <span style={style}>{maxContext.toString()}</span>
  )
}
