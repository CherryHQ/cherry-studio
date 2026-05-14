import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { SunoAvatar } from './avatar'
import { SunoDark } from './dark'
import { SunoLight } from './light'

const Suno = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <SunoLight className={cn('dark:hidden', className)} {...props} />
    <SunoDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const SunoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Suno, {
  Light: SunoLight,
  Dark: SunoDark,
  Avatar: SunoAvatar,
  colorPrimary: '#FEFEFE'
})

export default SunoIcon
