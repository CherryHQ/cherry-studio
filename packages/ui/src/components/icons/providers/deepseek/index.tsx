import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DeepseekAvatar } from './avatar'
import { DeepseekDark } from './dark'
import { DeepseekLight } from './light'

const Deepseek = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DeepseekLight className={cn('dark:hidden', className)} {...props} />
    <DeepseekDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DeepseekIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Deepseek, {
  Light: DeepseekLight,
  Dark: DeepseekDark,
  Avatar: DeepseekAvatar,
  colorPrimary: '#4D6BFE'
})

export default DeepseekIcon
