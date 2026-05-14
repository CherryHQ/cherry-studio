import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { AlayanewAvatar } from './avatar'
import { AlayanewDark } from './dark'
import { AlayanewLight } from './light'

const Alayanew = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <AlayanewLight className={cn('dark:hidden', className)} {...props} />
    <AlayanewDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const AlayanewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Alayanew, {
  Light: AlayanewLight,
  Dark: AlayanewDark,
  Avatar: AlayanewAvatar,
  colorPrimary: '#4362FF'
})

export default AlayanewIcon
