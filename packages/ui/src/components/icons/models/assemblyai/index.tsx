import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AssemblyaiAvatar } from './avatar'
import { AssemblyaiLight } from './light'

const Assemblyai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AssemblyaiLight {...props} className={className} />
  return <AssemblyaiLight {...props} className={className} />
}

export const AssemblyaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Assemblyai, {
  Avatar: AssemblyaiAvatar,
  colorPrimary: '#2545D3'
})

export default AssemblyaiIcon
