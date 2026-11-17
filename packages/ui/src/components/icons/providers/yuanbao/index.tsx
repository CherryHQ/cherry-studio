import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { YuanbaoAvatar } from './avatar'
import { YuanbaoDark } from './dark'
import { YuanbaoLight } from './light'

const Yuanbao = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <YuanbaoLight {...props} className={className} />
  if (variant === 'dark') return <YuanbaoDark {...props} className={className} />
  return (
    <>
      <YuanbaoLight className={cn('dark:hidden', className)} {...props} />
      <YuanbaoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const YuanbaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Yuanbao, {
  Avatar: YuanbaoAvatar,
  colorPrimary: '#38CF6F'
})

export default YuanbaoIcon
