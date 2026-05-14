import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { XinghuoAvatar } from './avatar'
import { XinghuoDark } from './dark'
import { XinghuoLight } from './light'

const Xinghuo = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <XinghuoLight className={cn('dark:hidden', className)} {...props} />
    <XinghuoDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const XinghuoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xinghuo, {
  Light: XinghuoLight,
  Dark: XinghuoDark,
  Avatar: XinghuoAvatar,
  colorPrimary: '#3DC8F9'
})

export default XinghuoIcon
