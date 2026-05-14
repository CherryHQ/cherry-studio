import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TencentCloudTiAvatar } from './avatar'
import { TencentCloudTiDark } from './dark'
import { TencentCloudTiLight } from './light'

const TencentCloudTi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TencentCloudTiLight {...props} className={className} />
  if (variant === 'dark') return <TencentCloudTiDark {...props} className={className} />
  return (
    <>
      <TencentCloudTiLight className={cn('dark:hidden', className)} {...props} />
      <TencentCloudTiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const TencentCloudTiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(TencentCloudTi, {
  Avatar: TencentCloudTiAvatar,
  colorPrimary: '#00A3FF'
})

export default TencentCloudTiIcon
