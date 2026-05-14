import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { NomicAvatar } from './avatar'
import { NomicDark } from './dark'
import { NomicLight } from './light'

const Nomic = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <NomicLight className={cn('dark:hidden', className)} {...props} />
    <NomicDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const NomicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nomic, {
  Light: NomicLight,
  Dark: NomicDark,
  Avatar: NomicAvatar,
  colorPrimary: '#000000'
})

export default NomicIcon
