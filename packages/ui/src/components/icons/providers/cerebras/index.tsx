import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CerebrasAvatar } from './avatar'
import { CerebrasDark } from './dark'
import { CerebrasLight } from './light'

const Cerebras = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CerebrasLight {...props} className={className} />
  if (variant === 'dark') return <CerebrasDark {...props} className={className} />
  return (
    <>
      <CerebrasLight className={cn('dark:hidden', className)} {...props} />
      <CerebrasDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const CerebrasIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cerebras, {
  Avatar: CerebrasAvatar,
  colorPrimary: '#F05A28'
})

export default CerebrasIcon
