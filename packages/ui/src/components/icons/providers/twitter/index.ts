import { type CompoundIcon } from '../../types'
import { TwitterAvatar } from './avatar'
import { Twitter } from './color'
import { TwitterMono } from './mono'

export const TwitterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Twitter, {
  Color: Twitter,
  Mono: TwitterMono,
  Avatar: TwitterAvatar,
  colorPrimary: '#000000'
})

export default TwitterIcon
