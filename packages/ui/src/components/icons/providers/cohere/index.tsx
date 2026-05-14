import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CohereAvatar } from './avatar'
import { CohereLight } from './light'

const Cohere = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CohereLight {...props} className={className} />
  return <CohereLight {...props} className={className} />
}

export const CohereIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cohere, {
  Avatar: CohereAvatar,
  colorPrimary: '#39594D'
})

export default CohereIcon
