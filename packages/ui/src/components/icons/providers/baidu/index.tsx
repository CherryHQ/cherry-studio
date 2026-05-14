import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BaiduAvatar } from './avatar'
import { BaiduDark } from './dark'
import { BaiduLight } from './light'

const Baidu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BaiduLight {...props} className={className} />
  if (variant === 'dark') return <BaiduDark {...props} className={className} />
  return (
    <>
      <BaiduLight className={cn('dark:hidden', className)} {...props} />
      <BaiduDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const BaiduIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baidu, {
  Avatar: BaiduAvatar,
  colorPrimary: '#2932E1'
})

export default BaiduIcon
