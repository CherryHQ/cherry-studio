import { type CompoundIcon } from '../../types'
import { AwsBedrockAvatar } from './avatar'
import { AwsBedrock } from './color'
import { AwsBedrockMono } from './mono'

export const AwsBedrockIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AwsBedrock, {
  Color: AwsBedrock,
  Mono: AwsBedrockMono,
  Avatar: AwsBedrockAvatar,
  colorPrimary: '#055F4E'
})

export default AwsBedrockIcon
