import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { VolcengineAvatar } from './avatar'
import { VolcengineDark } from './dark'
import { VolcengineLight } from './light'

const Volcengine = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <VolcengineLight className={cn('dark:hidden', className)} {...props} />
    <VolcengineDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const VolcengineIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Volcengine, {
  Light: VolcengineLight,
  Dark: VolcengineDark,
  Avatar: VolcengineAvatar,
  colorPrimary: '#00E5E5'
})

export default VolcengineIcon
