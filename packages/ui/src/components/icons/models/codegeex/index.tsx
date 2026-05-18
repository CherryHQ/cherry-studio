import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CodegeexAvatar } from './avatar'
import { CodegeexLight } from './light'

const Codegeex = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CodegeexLight {...props} className={className} />
  return <CodegeexLight {...props} className={className} />
}

export const CodegeexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Codegeex, {
  Avatar: CodegeexAvatar,
  colorPrimary: '#171E1E'
})

export default CodegeexIcon
