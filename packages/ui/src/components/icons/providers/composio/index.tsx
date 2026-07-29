import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ComposioAvatar } from './avatar'
import { ComposioDark } from './dark'
import { ComposioLight } from './light'

const Composio = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ComposioLight {...props} className={className} />
  if (variant === 'dark') return <ComposioDark {...props} className={className} />
  return (
    <>
      <ComposioLight className={cn('dark:hidden', className)} {...props} />
      <ComposioDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ComposioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Composio, {
  Avatar: ComposioAvatar,
  colorPrimary: '#000000'
})

export default ComposioIcon
