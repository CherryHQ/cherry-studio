import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const AcedatacloudLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill={`url(#${iconId}-acedatacloudlight__a)`}
      viewBox="0 0 103 103"
      width="1em"
      height="1em"
      {...props}>
      <defs>
        <linearGradient
          id={`${iconId}-acedatacloudlight__a`}
          x1={51.5}
          x2={51.5}
          y1={3}
          y2={99}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#17E6B0" />
          <stop offset={1} stopColor="#28A5FA" />
        </linearGradient>
      </defs>
      <path d="M44 9C47 3 56 3 59 9L101 86C103 90 102 95 98 97C94 99 89 98 87 94L59 43C56 36 48 36 44 43L16 94C14 98 9 99 5 97C1 95 0 90 2 86Z" />
      <circle cx={51.5} cy={63} r={8.5} />
    </svg>
  )
}
export { AcedatacloudLight }
export default AcedatacloudLight
