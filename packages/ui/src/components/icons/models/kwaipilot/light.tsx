import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const KwaipilotLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" {...props}>
      <path
        fill={`url(#${iconId}-kwaipilotlight__a)`}
        d="M12 4.00137C7.58171 4.00137 4 7.58377 4 12.0007C4 14.4123 5.06786 16.5748 6.75543 18.0427L10.7132 9.92742H15.1404L10.3152 19.8223C10.869 19.941 11.4338 20.0007 12 20.0007C16.4183 20.0007 20 16.4183 20 12C20 7.58171 16.4176 4 12 4V4.00137Z"
      />
      <path
        fill={`url(#${iconId}-kwaipilotlight__b)`}
        d="M6.75543 18.042L11.1216 9.08879C11.1332 9.06408 11.1456 9.03869 11.1593 9.0133L11.2183 8.88977H11.2218C11.6135 8.15366 12.198 7.53798 12.9129 7.10868C13.6277 6.67939 14.4459 6.45266 15.2797 6.45277C17.1904 6.45277 18.8285 7.61946 19.5237 9.27752C18.4106 6.19954 15.4609 4 12 4C7.58171 4 4 7.58171 4 12C4 14.4116 5.06786 16.5748 6.75543 18.042Z"
      />
      <defs>
        <linearGradient
          id={`${iconId}-kwaipilotlight__a`}
          x1={13.169}
          x2={12.543}
          y1={7.291}
          y2={18.6}
          gradientUnits="userSpaceOnUse">
          <stop offset={0.313} stopColor="#9EC0E0" />
          <stop offset={1} stopColor="#fff" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-kwaipilotlight__b`}
          x1={13.355}
          x2={7.801}
          y1={6.883}
          y2={15.912}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" />
          <stop offset={1} stopColor="#BCD5EC" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { KwaipilotLight }
export default KwaipilotLight
