import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { InflectionAvatar } from './avatar'
import { InflectionDark } from './dark'
import { InflectionLight } from './light'

const Inflection = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <InflectionLight className={cn('dark:hidden', className)} {...props} />
    <InflectionDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const InflectionIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Inflection, {
  Light: InflectionLight,
  Dark: InflectionDark,
  Avatar: InflectionAvatar,
  colorPrimary: '#000000'
})

export default InflectionIcon
