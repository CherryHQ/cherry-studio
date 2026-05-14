import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { AyaAvatar } from './avatar'
import { AyaDark } from './dark'
import { AyaLight } from './light'

const Aya = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <AyaLight className={cn('dark:hidden', className)} {...props} />
    <AyaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const AyaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aya, {
  Light: AyaLight,
  Dark: AyaDark,
  Avatar: AyaAvatar,
  colorPrimary: '#010201'
})

export default AyaIcon
