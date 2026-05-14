import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AwsBedrockAvatar } from './avatar'
import { AwsBedrockLight } from './light'

const AwsBedrock = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AwsBedrockLight {...props} className={className} />
  return <AwsBedrockLight {...props} className={className} />
}

export const AwsBedrockIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AwsBedrock, {
  Avatar: AwsBedrockAvatar,
  colorPrimary: '#000000'
})

export default AwsBedrockIcon
