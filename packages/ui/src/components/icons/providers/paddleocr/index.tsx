import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { PaddleocrAvatar } from './avatar'
import { PaddleocrDark } from './dark'
import { PaddleocrLight } from './light'

const Paddleocr = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <PaddleocrLight className={cn('dark:hidden', className)} {...props} />
    <PaddleocrDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const PaddleocrIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Paddleocr, {
  Light: PaddleocrLight,
  Dark: PaddleocrDark,
  Avatar: PaddleocrAvatar,
  colorPrimary: '#363FE5'
})

export default PaddleocrIcon
