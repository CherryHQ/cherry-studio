import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BaiduCloudAvatar } from './avatar'
import { BaiduCloudDark } from './dark'
import { BaiduCloudLight } from './light'

const BaiduCloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BaiduCloudLight {...props} className={className} />
  if (variant === 'dark') return <BaiduCloudDark {...props} className={className} />
  return (
    <>
      <BaiduCloudLight className={cn('dark:hidden', className)} {...props} />
      <BaiduCloudDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const BaiduCloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(BaiduCloud, {
  Avatar: BaiduCloudAvatar,
  colorPrimary: '#5BCA87'
})

export default BaiduCloudIcon
