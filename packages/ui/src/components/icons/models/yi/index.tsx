import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { YiAvatar } from './avatar'
import { YiDark } from './dark'
import { YiLight } from './light'

const Yi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <YiLight {...props} className={className} />
  if (variant === 'dark') return <YiDark {...props} className={className} />
  return (
    <>
      <YiLight className={cn('dark:hidden', className)} {...props} />
      <YiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const YiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Yi, {
  Avatar: YiAvatar,
  colorPrimary: '#000000'
})

export default YiIcon
