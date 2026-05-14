import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { IbmAvatar } from './avatar'
import { IbmDark } from './dark'
import { IbmLight } from './light'

const Ibm = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <IbmLight className={cn('dark:hidden', className)} {...props} />
    <IbmDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const IbmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ibm, {
  Light: IbmLight,
  Dark: IbmDark,
  Avatar: IbmAvatar,
  colorPrimary: '#DFE9F3'
})

export default IbmIcon
