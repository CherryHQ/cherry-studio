import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const KwaipilotLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="17.785 17.807 85.036 85.035"
    {...props}>
    <path
      fill="url(#kwaipilotlight__a)"
      d="M60.3031 18.8139C37.3753 18.8139 18.7852 37.4037 18.7852 60.3311C18.7852 72.8483 24.3278 84.071 33.0858 91.6859L53.6245 49.5696H76.6004L51.559 100.919C54.3819 101.525 57.3011 101.842 60.3031 101.842C83.231 101.842 101.821 83.2516 101.821 60.3243C101.821 37.3968 83.231 18.807 60.3031 18.807V18.8139Z"
    />
    <path
      fill="url(#kwaipilotlight__b)"
      d="M33.0858 91.679L55.7451 45.2183C55.8071 45.0875 55.8691 44.9567 55.9379 44.8258L56.2478 44.1855H56.2614C60.2755 36.6601 68.2006 31.5376 77.3234 31.5376C87.2383 31.5376 95.7416 37.5896 99.3495 46.196C93.5726 30.2225 78.2667 18.807 60.3031 18.807C37.3753 18.807 18.7852 37.3968 18.7852 60.3243C18.7852 72.8415 24.3278 84.0642 33.0858 91.679Z"
    />
    <defs>
      <linearGradient
        id="kwaipilotlight__a"
        x1={66.37}
        x2={63.126}
        y1={35.883}
        y2={94.578}
        gradientUnits="userSpaceOnUse">
        <stop offset={0.313} stopColor="#9EC0E0" />
        <stop offset={1} stopColor="#fff" />
      </linearGradient>
      <linearGradient
        id="kwaipilotlight__b"
        x1={67.333}
        x2={38.515}
        y1={33.768}
        y2={80.631}
        gradientUnits="userSpaceOnUse">
        <stop stopColor="#fff" />
        <stop offset={1} stopColor="#BCD5EC" />
      </linearGradient>
    </defs>
  </svg>
)
export { KwaipilotLight }
export default KwaipilotLight
