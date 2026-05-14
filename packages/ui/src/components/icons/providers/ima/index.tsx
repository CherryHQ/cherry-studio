import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ImaAvatar } from './avatar'
import { ImaDark } from './dark'
import { ImaLight } from './light'

const Ima = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ImaLight className={cn('dark:hidden', className)} {...props} />
    <ImaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ImaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ima, {
  Light: ImaLight,
  Dark: ImaDark,
  Avatar: ImaAvatar,
  colorPrimary: '#000000'
})

export default ImaIcon
