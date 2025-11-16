// Original: src/renderer/src/components/Ellipsis/index.tsx
import type { HTMLAttributes } from 'react'

import { cn } from '../../../utils'

type Props = {
  maxLine?: number
  className?: string
  ref?: React.Ref<HTMLDivElement>
} & HTMLAttributes<HTMLDivElement>

const Ellipsis = (props: Props) => {
  const { maxLine = 1, children, className, ref, ...rest } = props

  const ellipsisClasses = cn(
    'overflow-hidden text-ellipsis',
    maxLine > 1 ? `line-clamp-${maxLine} break-words` : 'block whitespace-nowrap',
    className
  )

  return (
    <div ref={ref} className={ellipsisClasses} {...rest}>
      {children}
    </div>
  )
}

export default Ellipsis
