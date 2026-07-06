import { OpenCode as OpenCodeGeneral } from '../../general/open-code'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OpenCodeGoAvatar } from './avatar'
import { meta } from './meta'

const OpenCodeGo = ({ className, ...props }: CompoundIconProps) => {
  return <OpenCodeGeneral {...props} className={className} />
}

export const OpenCodeGoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(OpenCodeGo, {
  Avatar: OpenCodeGoAvatar,
  colorPrimary: meta.colorPrimary
})

export default OpenCodeGoIcon
