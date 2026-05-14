import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { VertexaiAvatar } from './avatar'
import { VertexaiDark } from './dark'
import { VertexaiLight } from './light'

const Vertexai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <VertexaiLight {...props} className={className} />
  if (variant === 'dark') return <VertexaiDark {...props} className={className} />
  return (
    <>
      <VertexaiLight className={cn('dark:hidden', className)} {...props} />
      <VertexaiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const VertexaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vertexai, {
  Avatar: VertexaiAvatar,
  colorPrimary: '#4285F4'
})

export default VertexaiIcon
