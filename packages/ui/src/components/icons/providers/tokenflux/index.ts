import type { CompoundIcon } from '../../types'
import { TokenfluxAvatar } from './avatar'
import { Tokenflux } from './color'
import { TokenfluxMono } from './mono'

export const TokenfluxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tokenflux, {
  Color: Tokenflux,
  Mono: TokenfluxMono,
  Avatar: TokenfluxAvatar,
  colorPrimary: '#FEFEFE'
})
export default TokenfluxIcon
