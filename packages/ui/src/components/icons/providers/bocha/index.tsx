import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { BochaAvatar } from './avatar'
import { BochaDark } from './dark'
import { BochaLight } from './light'

const Bocha = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <BochaLight className={cn('dark:hidden', className)} {...props} />
    <BochaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const BochaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bocha, {
  Light: BochaLight,
  Dark: BochaDark,
  Avatar: BochaAvatar,
  colorPrimary: '#A5CCFF'
})

export default BochaIcon
