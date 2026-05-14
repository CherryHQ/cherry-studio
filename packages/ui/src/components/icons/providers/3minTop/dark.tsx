import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const MinTop3Dark: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <g clipPath="url(#mintop3dark__a)">
      <path
        fill="#FFF0A0"
        d="M82.3025 18H38.6975C27.8189 18 19 26.8189 19 37.6975V81.3025C19 92.1811 27.8189 101 38.6975 101H82.3025C93.1811 101 102 92.1811 102 81.3025V37.6975C102 26.8189 93.1811 18 82.3025 18Z"
      />
      <path
        fill="#fff"
        fillOpacity={0.9}
        stroke="#222"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={5.513}
        d="M63.0067 34.4395L37.9463 64.512H60.5007L57.9946 84.5603L83.0551 54.4878H60.5007L63.0067 34.4395Z"
      />
    </g>
    <defs>
      <clipPath id="mintop3dark__a">
        <path fill="#fff" d="M0 0H83V83H0z" transform="translate(19 18)" />
      </clipPath>
    </defs>
  </svg>
)
export { MinTop3Dark }
export default MinTop3Dark
