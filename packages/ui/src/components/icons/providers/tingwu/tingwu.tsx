import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TingwuAvatar } from './avatar'
import { TingwuDark } from './dark'
import { TingwuLight } from './light'

const Tingwu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TingwuLight {...props} className={className} />
  if (variant === 'dark') return <TingwuDark {...props} className={className} />
  return (
    <>
      <TingwuLight className={cn('dark:hidden', className)} {...props} />
      <TingwuDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const TingwuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tingwu, {
  Avatar: TingwuAvatar,
  colorPrimary: '#000000'
})

export default TingwuIcon
