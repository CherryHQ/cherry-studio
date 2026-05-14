import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ModelscopeAvatar } from './avatar'
import { ModelscopeDark } from './dark'
import { ModelscopeLight } from './light'

const Modelscope = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ModelscopeLight className={cn('dark:hidden', className)} {...props} />
    <ModelscopeDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ModelscopeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Modelscope, {
  Light: ModelscopeLight,
  Dark: ModelscopeDark,
  Avatar: ModelscopeAvatar,
  colorPrimary: '#624AFF'
})

export default ModelscopeIcon
