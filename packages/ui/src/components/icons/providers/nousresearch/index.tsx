import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { NousresearchAvatar } from './avatar'
import { NousresearchDark } from './dark'
import { NousresearchLight } from './light'

const Nousresearch = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <NousresearchLight className={cn('dark:hidden', className)} {...props} />
    <NousresearchDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const NousresearchIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nousresearch, {
  Light: NousresearchLight,
  Dark: NousresearchDark,
  Avatar: NousresearchAvatar,
  colorPrimary: '#000000'
})

export default NousresearchIcon
