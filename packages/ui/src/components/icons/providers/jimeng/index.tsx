import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { JimengAvatar } from './avatar'
import { JimengDark } from './dark'
import { JimengLight } from './light'

const Jimeng = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <JimengLight className={cn('dark:hidden', className)} {...props} />
    <JimengDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const JimengIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Jimeng, {
  Light: JimengLight,
  Dark: JimengDark,
  Avatar: JimengAvatar,
  colorPrimary: '#000000'
})

export default JimengIcon
