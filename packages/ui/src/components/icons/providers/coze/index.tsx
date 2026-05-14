import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { CozeAvatar } from './avatar'
import { CozeDark } from './dark'
import { CozeLight } from './light'

const Coze = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <CozeLight className={cn('dark:hidden', className)} {...props} />
    <CozeDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const CozeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Coze, {
  Light: CozeLight,
  Dark: CozeDark,
  Avatar: CozeAvatar,
  colorPrimary: '#4D53E8'
})

export default CozeIcon
