import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { OpenclawAvatar } from './avatar'
import { OpenclawDark } from './dark'
import { OpenclawLight } from './light'

const Openclaw = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <OpenclawLight className={cn('dark:hidden', className)} {...props} />
    <OpenclawDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const OpenclawIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openclaw, {
  Light: OpenclawLight,
  Dark: OpenclawDark,
  Avatar: OpenclawAvatar,
  colorPrimary: '#FF4D4D'
})

export default OpenclawIcon
