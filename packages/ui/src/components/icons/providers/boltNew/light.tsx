import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const BoltNewLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <g clipPath="url(#boltnewlight__a)">
      <path
        fill="#000"
        d="M81.25 18H39.75C28.2901 18 19 27.2901 19 38.75V80.25C19 91.7099 28.2901 101 39.75 101H81.25C92.7099 101 102 91.7099 102 80.25V38.75C102 27.2901 92.7099 18 81.25 18Z"
      />
      <g filter="url(#boltnewlight__b)">
        <path
          fill="#fff"
          fillRule="evenodd"
          d="M63.8391 79.073C60.0838 79.073 56.3967 77.7325 54.2801 74.8503L53.5336 78.2492L39.75 85.4375L41.238 78.2492L51.2759 33.5625H63.566L60.0155 49.3135C62.8832 46.2303 65.546 45.0909 68.9599 45.0909C76.3338 45.0909 81.25 49.8497 81.25 58.563C81.25 67.5445 75.5832 79.073 63.8391 79.073ZM68.5503 61.11C68.5503 65.2656 65.546 68.4158 61.6542 68.4158C59.4692 68.4158 57.4892 67.6115 56.1919 66.204L58.1037 57.9598C59.5376 56.5523 61.1762 55.7479 63.088 55.7479C66.024 55.7479 68.5503 57.8928 68.5503 61.11Z"
          clipRule="evenodd"
        />
      </g>
    </g>
    <defs>
      <clipPath id="boltnewlight__a">
        <path fill="#fff" d="M0 0H83V83H0z" transform="translate(19 18)" />
      </clipPath>
      <filter
        id="boltnewlight__b"
        width={41.5}
        height={51.875}
        x={39.75}
        y={33.563}
        colorInterpolationFilters="sRGB"
        filterUnits="userSpaceOnUse">
        <feFlood floodOpacity={0} result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
        <feOffset />
        <feGaussianBlur stdDeviation={0.1} />
        <feComposite in2="hardAlpha" k2={-1} k3={1} operator="arithmetic" />
        <feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.95 0" />
        <feBlend in2="shape" result="effect1_innerShadow_34_21063" />
      </filter>
    </defs>
  </svg>
)
export { BoltNewLight }
export default BoltNewLight
