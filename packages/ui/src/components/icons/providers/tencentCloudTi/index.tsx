import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { TencentCloudTiAvatar } from './avatar'
import { TencentCloudTiDark } from './dark'
import { TencentCloudTiLight } from './light'

const TencentCloudTi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <TencentCloudTiLight className={cn('dark:hidden', className)} {...props} />
    <TencentCloudTiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const TencentCloudTiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(TencentCloudTi, {
  Light: TencentCloudTiLight,
  Dark: TencentCloudTiDark,
  Avatar: TencentCloudTiAvatar,
  colorPrimary: '#00A3FF'
})

export default TencentCloudTiIcon
