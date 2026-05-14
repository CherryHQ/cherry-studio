import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { FlowithAvatar } from './avatar'
import { FlowithDark } from './dark'
import { FlowithLight } from './light'

const Flowith = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <FlowithLight className={cn('dark:hidden', className)} {...props} />
    <FlowithDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const FlowithIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Flowith, {
  Light: FlowithLight,
  Dark: FlowithDark,
  Avatar: FlowithAvatar,
  colorPrimary: '#000000'
})

export default FlowithIcon
