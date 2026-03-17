import { type CompoundIcon } from '../../types'
import { CodegeexAvatar } from './avatar'
import { Codegeex } from './color'
import { CodegeexMono } from './mono'

export const CodegeexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Codegeex, {
  Color: Codegeex,
  Mono: CodegeexMono,
  Avatar: CodegeexAvatar,
  colorPrimary: '#171E1E'
})

export default CodegeexIcon
