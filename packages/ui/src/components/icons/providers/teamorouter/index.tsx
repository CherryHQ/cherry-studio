import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TeamorouterAvatar } from './avatar'
import { TeamorouterLight } from './light'

const Teamorouter = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TeamorouterLight {...props} className={className} />
  return <TeamorouterLight {...props} className={className} />
}

export const TeamorouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Teamorouter, {
  Avatar: TeamorouterAvatar,
  colorPrimary: '#121212'
})

export default TeamorouterIcon
