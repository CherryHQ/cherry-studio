import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { CerebrasAvatar } from './avatar'
import { CerebrasDark } from './dark'
import { CerebrasLight } from './light'

const Cerebras = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <CerebrasLight className={cn('dark:hidden', className)} {...props} />
    <CerebrasDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const CerebrasIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cerebras, {
  Light: CerebrasLight,
  Dark: CerebrasDark,
  Avatar: CerebrasAvatar,
  colorPrimary: '#F05A28'
})

export default CerebrasIcon
