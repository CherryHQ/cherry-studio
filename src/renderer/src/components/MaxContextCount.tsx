import { MAX_CONTEXT_COUNT } from '@renderer/config/constant'
import { Infinity as InfinityIcon } from 'lucide-react'
import { CSSProperties } from 'react'

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
