import type { IconComponent } from '../../types'
import { worldrouterPath } from './mark'

export const WorldrouterDark: IconComponent = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" {...props}>
    <rect width="24" height="24" rx="5" fill="#000000" />
    <path d={worldrouterPath} fill="#FFFFFF" fillRule="evenodd" transform="translate(2 2) scale(0.833333)" />
  </svg>
)
