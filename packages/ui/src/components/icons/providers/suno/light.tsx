import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const SunoLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="16 16 88 88" {...props}>
    <g clipPath="url(#sunolight__a)">
      <path
        fill="#FEFEFE"
        d="M17 17C45.38 17 73.76 17 103 17C103 45.38 103 73.76 103 103C74.62 103 46.24 103 17 103C17 74.62 17 46.24 17 17Z"
      />
      <path
        fill="#020202"
        d="M73.92 36.0275C79.6992 39.3127 82.5286 45.0274 84.2701 51.2882C85.0097 54.2939 84.9366 56.8137 84.9366 60C78.6973 60 72.4494 60 66.0166 60C66.0166 61.8447 66.0166 63.6894 66.0166 65.59C65.148 72.2722 62.2799 78.5846 57.0812 82.9362C54.4754 84.8884 51.9943 85.3657 48.8166 84.94C44.0608 83.6371 41.4077 80.9152 38.9266 76.77C36.1789 71.4165 35.0566 65.9856 35.0566 60C41.3045 60 47.5481 60 53.9766 60C53.9766 58.0134 53.9766 56.0268 53.9766 53.98C54.8968 47.53 57.6531 41.5616 62.5766 37.21C66.1499 34.6515 69.9167 34.114 73.92 36.0275Z"
      />
    </g>
    <defs>
      <clipPath id="sunolight__a">
        <rect width={86} height={86} x={17} y={17} fill="#fff" rx={24} />
      </clipPath>
    </defs>
  </svg>
)
export { SunoLight }
export default SunoLight
