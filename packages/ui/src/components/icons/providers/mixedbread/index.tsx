import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MixedbreadAvatar } from './avatar'
import { MixedbreadDark } from './dark'
import { MixedbreadLight } from './light'

const Mixedbread = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MixedbreadLight className={cn('dark:hidden', className)} {...props} />
    <MixedbreadDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MixedbreadIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mixedbread, {
  Light: MixedbreadLight,
  Dark: MixedbreadDark,
  Avatar: MixedbreadAvatar,
  colorPrimary: '#EC6168'
})

export default MixedbreadIcon
