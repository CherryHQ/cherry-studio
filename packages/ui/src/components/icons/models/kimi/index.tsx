import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { KimiAvatar } from './avatar'
import { KimiDark } from './dark'
import { KimiLight } from './light'

const Kimi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <KimiLight className={cn('dark:hidden', className)} {...props} />
    <KimiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const KimiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kimi, {
  Light: KimiLight,
  Dark: KimiDark,
  Avatar: KimiAvatar,
  colorPrimary: '#000000'
})

export default KimiIcon
