import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { StepAvatar } from './avatar'
import { StepDark } from './dark'
import { StepLight } from './light'

const Step = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <StepLight className={cn('dark:hidden', className)} {...props} />
    <StepDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const StepIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Step, {
  Light: StepLight,
  Dark: StepDark,
  Avatar: StepAvatar,
  colorPrimary: '#000000'
})

export default StepIcon
