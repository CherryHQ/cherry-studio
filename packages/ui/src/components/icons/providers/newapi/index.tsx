import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NewapiAvatar } from './avatar'
import { NewapiLight } from './light'

const Newapi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NewapiLight {...props} className={className} />
  return <NewapiLight {...props} className={className} />
}

export const NewapiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Newapi, {
  Avatar: NewapiAvatar,
  colorPrimary: '#000000'
})

export default NewapiIcon
