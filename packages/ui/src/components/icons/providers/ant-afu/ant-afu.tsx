import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AntAfuAvatar } from './avatar'
import { AntAfuDark } from './dark'
import { AntAfuLight } from './light'

const AntAfu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AntAfuLight {...props} className={className} />
  if (variant === 'dark') return <AntAfuDark {...props} className={className} />
  return (
    <>
      <AntAfuLight className={cn('dark:hidden', className)} {...props} />
      <AntAfuDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AntAfuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AntAfu, {
  Avatar: AntAfuAvatar,
  colorPrimary: '#000000'
})

export default AntAfuIcon
