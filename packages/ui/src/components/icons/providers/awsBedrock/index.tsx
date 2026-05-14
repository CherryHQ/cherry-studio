import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { AwsBedrockAvatar } from './avatar'
import { AwsBedrockDark } from './dark'
import { AwsBedrockLight } from './light'

const AwsBedrock = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <AwsBedrockLight className={cn('dark:hidden', className)} {...props} />
    <AwsBedrockDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const AwsBedrockIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AwsBedrock, {
  Light: AwsBedrockLight,
  Dark: AwsBedrockDark,
  Avatar: AwsBedrockAvatar,
  colorPrimary: '#000000'
})

export default AwsBedrockIcon
