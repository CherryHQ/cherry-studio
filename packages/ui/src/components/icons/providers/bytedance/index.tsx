import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BytedanceAvatar } from './avatar'
import { BytedanceDark } from './dark'
import { BytedanceLight } from './light'

const Bytedance = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BytedanceLight {...props} className={className} />
  if (variant === 'dark') return <BytedanceDark {...props} className={className} />
  return (
    <>
      <BytedanceLight className={cn('dark:hidden', className)} {...props} />
      <BytedanceDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const BytedanceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bytedance, {
  Avatar: BytedanceAvatar,
  colorPrimary: '#00C8D2'
})

export default BytedanceIcon
