import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ComfyuiAvatar } from './avatar'
import { ComfyuiLight } from './light'

// ComfyUI's official mark is a single-color design used as-is in both variants.
const Comfyui = ({ className, ...props }: CompoundIconProps) => {
  return <ComfyuiLight {...props} className={className} />
}

export const ComfyuiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Comfyui, {
  Avatar: ComfyuiAvatar,
  colorPrimary: '#211927'
})

export default ComfyuiIcon
