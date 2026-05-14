import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { BaiduCloudAvatar } from './avatar'
import { BaiduCloudDark } from './dark'
import { BaiduCloudLight } from './light'

const BaiduCloud = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <BaiduCloudLight className={cn('dark:hidden', className)} {...props} />
    <BaiduCloudDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const BaiduCloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(BaiduCloud, {
  Light: BaiduCloudLight,
  Dark: BaiduCloudDark,
  Avatar: BaiduCloudAvatar,
  colorPrimary: '#5BCA87'
})

export default BaiduCloudIcon
