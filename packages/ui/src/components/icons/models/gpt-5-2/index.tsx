import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt52Avatar } from './avatar'
import { Gpt52Light } from './light'

const Gpt52 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt52Light {...props} className={className} />
  return <Gpt52Light {...props} className={className} />
}

export const Gpt52Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt52, {
  Avatar: Gpt52Avatar,
  colorPrimary: '#000000'
})

export default Gpt52Icon
