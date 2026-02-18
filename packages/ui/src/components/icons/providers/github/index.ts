import type { CompoundIcon } from '../../types'
import { GithubAvatar } from './avatar'
import { Github } from './color'
import { GithubMono } from './mono'

export const GithubIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Github, {
  Color: Github,
  Mono: GithubMono,
  Avatar: GithubAvatar,
  colorPrimary: '#000000'
})
export default GithubIcon
