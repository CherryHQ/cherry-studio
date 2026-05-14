import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const ViduDark: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <g clipPath="url(#vidudark__a)">
      <path
        fill="url(#vidudark__b)"
        d="M90.8423 25.0518C80.3897 21.5903 71.3991 28.9361 69.3029 35.6584C69.3029 35.6584 61.76 59.8818 58.5457 69.9868C57.012 74.8099 53.2101 82.7004 46.0506 82.7004C40.2205 82.7004 37.2249 77.2287 35.96 73.9679L27.2668 50.7944C26.2599 48.3542 27.3134 43.4844 31.3518 42.026C35.6661 40.478 38.4396 44.0864 39.1563 46.0035L49.9851 73.7385C52.5651 70.4132 54.2063 65.0024 55.2741 61.1718L48.1648 42.5026C44.7929 33.7915 35.874 29.8284 27.6144 32.8742C20.9243 35.3395 14.485 43.7819 17.986 54.3921L26.9586 77.4688C28.3203 80.9661 33.6989 92.3862 45.8607 92.3862C60.4556 92.3862 65.931 79.9413 68.9696 70.105C70.489 65.1851 78.8202 38.5824 78.8202 38.5824C80.0314 34.6085 84.9477 33.4654 88.0222 34.4688C90.1901 35.1711 94.1067 38.1632 92.8418 42.8C92.6053 43.6457 85.9618 65.0489 83.5108 71.5599C82.2315 74.9569 78.9886 82.3314 71.5998 81.3065C69.3495 86.2874 67.479 89.1863 64.6481 91.7878C73.8645 96.1523 87.2948 91.7555 92.9493 74.6738C95.0491 68.3205 102.424 45.4123 102.424 45.4123C104.566 38.3782 100.743 28.3269 90.8423 25.0518Z"
      />
    </g>
    <defs>
      <linearGradient id="vidudark__b" x1={19.72} x2={110.723} y1={37.199} y2={79.031} gradientUnits="userSpaceOnUse">
        <stop stopColor="#40EDD8" />
        <stop offset={0.024} stopColor="#38E7E2" />
        <stop offset={0.084} stopColor="#28DAF7" />
        <stop offset={0.124} stopColor="#22D5FF" />
        <stop offset={0.36} stopColor="#1ABFFF" />
        <stop offset={0.85} stopColor="#0786FE" />
        <stop offset={0.909} stopColor="#047FFE" />
      </linearGradient>
      <clipPath id="vidudark__a">
        <path fill="#fff" d="M0 0H86V86H0z" transform="translate(17 17)" />
      </clipPath>
    </defs>
  </svg>
)
export { ViduDark }
export default ViduDark
