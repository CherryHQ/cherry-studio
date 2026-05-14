import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AwsBedrockAvatar } from './avatar'
import { AwsBedrockDark } from './dark'
import { AwsBedrockLight } from './light'

const AwsBedrock = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AwsBedrockLight {...props} className={className} />
  if (variant === 'dark') return <AwsBedrockDark {...props} className={className} />
  return (
    <>
      <AwsBedrockLight className={cn('dark:hidden', className)} {...props} />
      <AwsBedrockDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AwsBedrockIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AwsBedrock, {
  Avatar: AwsBedrockAvatar,
  colorPrimary: '#000000'
})

export default AwsBedrockIcon
