import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Ph8Avatar } from './avatar'
import { Ph8Dark } from './dark'
import { Ph8Light } from './light'

const Ph8 = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Ph8Light className={cn('dark:hidden', className)} {...props} />
    <Ph8Dark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Ph8Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ph8, {
  Light: Ph8Light,
  Dark: Ph8Dark,
  Avatar: Ph8Avatar,
  colorPrimary: '#00F0FF'
})

export default Ph8Icon
