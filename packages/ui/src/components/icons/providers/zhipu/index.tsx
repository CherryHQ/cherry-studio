import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ZhipuAvatar } from './avatar'
import { ZhipuDark } from './dark'
import { ZhipuLight } from './light'

const Zhipu = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ZhipuLight className={cn('dark:hidden', className)} {...props} />
    <ZhipuDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ZhipuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Zhipu, {
  Light: ZhipuLight,
  Dark: ZhipuDark,
  Avatar: ZhipuAvatar,
  colorPrimary: '#3859FF'
})

export default ZhipuIcon
