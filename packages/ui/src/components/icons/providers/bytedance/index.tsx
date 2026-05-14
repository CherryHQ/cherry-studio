import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { BytedanceAvatar } from './avatar'
import { BytedanceDark } from './dark'
import { BytedanceLight } from './light'

const Bytedance = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <BytedanceLight className={cn('dark:hidden', className)} {...props} />
    <BytedanceDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const BytedanceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bytedance, {
  Light: BytedanceLight,
  Dark: BytedanceDark,
  Avatar: BytedanceAvatar,
  colorPrimary: '#00C8D2'
})

export default BytedanceIcon
