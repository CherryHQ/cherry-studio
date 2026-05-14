import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { SensenovaAvatar } from './avatar'
import { SensenovaDark } from './dark'
import { SensenovaLight } from './light'

const Sensenova = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <SensenovaLight className={cn('dark:hidden', className)} {...props} />
    <SensenovaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const SensenovaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sensenova, {
  Light: SensenovaLight,
  Dark: SensenovaDark,
  Avatar: SensenovaAvatar,
  colorPrimary: '#01FFB9'
})

export default SensenovaIcon
