import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const Twitter: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="1em"
    height="1em"
    fill="currentColor"
    className="twitter__size-5 twitter__group-hover:scale-110 twitter__transition-transform twitter__duration-150"
    viewBox="0 0 512 512"
    {...props}>
    <path d="M389.2 48h70.6L305.6 224.2 487 464H345L233.7 318.6 106.5 464H35.8L200.7 275.5 26.8 48H172.4L272.9 180.9 389.2 48zM364.4 421.8h39.1L151.1 88h-42L364.4 421.8z" />
  </svg>
)
export { Twitter }
export default Twitter
