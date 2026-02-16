import type { CompoundIcon } from '../../types'
import { Github } from './color'
import { GithubMono } from './mono'

export const GithubIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Github, {
  Color: Github,
  Mono: GithubMono,
  colorPrimary: '#000000'
})
export default GithubIcon
