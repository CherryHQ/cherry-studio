import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { LambdaAvatar } from './avatar'
import { LambdaDark } from './dark'
import { LambdaLight } from './light'

const Lambda = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <LambdaLight className={cn('dark:hidden', className)} {...props} />
    <LambdaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const LambdaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lambda, {
  Light: LambdaLight,
  Dark: LambdaDark,
  Avatar: LambdaAvatar,
  colorPrimary: '#000000'
})

export default LambdaIcon
