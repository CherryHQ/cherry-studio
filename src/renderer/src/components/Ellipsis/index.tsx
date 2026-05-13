import { cn } from '@cherrystudio/ui/lib/utils'
import type { CSSProperties, HTMLAttributes } from 'react'

type Props = {
  maxLine?: number
} & HTMLAttributes<HTMLDivElement>

const Ellipsis = (props: Props) => {
  const { maxLine = 1, children, className, style, ...rest } = props
  const ellipsisStyle: CSSProperties =
    maxLine > 1
      ? {
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: maxLine,
          overflowWrap: 'break-word',
          ...style
        }
      : {
          ...style
        }

  return (
    <div
      className={cn('overflow-hidden text-ellipsis', maxLine > 1 ? undefined : 'block whitespace-nowrap', className)}
      style={ellipsisStyle}
      {...rest}>
      {children}
    </div>
  )
}

export default Ellipsis
