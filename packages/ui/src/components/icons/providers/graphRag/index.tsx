import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GraphRagAvatar } from './avatar'
import { GraphRagDark } from './dark'
import { GraphRagLight } from './light'

const GraphRag = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GraphRagLight {...props} className={className} />
  if (variant === 'dark') return <GraphRagDark {...props} className={className} />
  return (
    <>
      <GraphRagLight className={cn('dark:hidden', className)} {...props} />
      <GraphRagDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GraphRagIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GraphRag, {
  Avatar: GraphRagAvatar,
  colorPrimary: '#F8E71C'
})

export default GraphRagIcon
