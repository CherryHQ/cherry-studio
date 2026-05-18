import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const OpenrouterDark: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="16 23.013 88.086 73.821"
    {...props}>
    <g clipPath="url(#openrouterdark__a)">
      <mask
        id="openrouterdark__b"
        width={86}
        height={86}
        x={17}
        y={17}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M103 17H17V103H103V17Z" />
      </mask>
      <g mask="url(#openrouterdark__b)">
        <path
          fill="#fff"
          fillRule="evenodd"
          d="M77.2143 24.0127L103.086 38.7223V39.034L76.9492 53.5858L77.0101 46L74.0682 45.8925C70.2734 45.7922 68.2954 45.8997 65.9412 46.2867C62.1285 46.9138 58.6383 48.3543 54.6644 51.1314L46.9029 56.5242C45.8853 57.2229 45.1292 57.7282 44.4663 58.1546L42.6208 59.3084L41.1982 60.1469L42.5778 60.9711L44.477 62.1823C46.1827 63.3074 48.6695 65.0346 54.1556 68.8688C58.1331 71.6458 61.6197 73.0863 65.4323 73.7134L66.5073 73.8747C68.9942 74.2008 71.4344 74.2115 76.6303 73.9929L76.7091 66.2565L102.581 80.9661V81.2778L76.4439 95.8333L76.4941 89.1612L74.2187 89.24C69.2522 89.3905 66.5611 89.2472 62.9742 88.6595C56.904 87.6562 51.2925 85.3413 45.4839 81.2814L37.7511 75.9064C36.8616 75.2933 35.9596 74.6981 35.0457 74.1219L33.3722 73.1186C32.4685 72.5979 31.5607 72.0844 30.6489 71.5778C27.4203 69.7825 19.0174 67.5823 17 67.5823V52.4321L17.5017 52.4464C19.5227 52.4214 27.9292 50.2176 31.1506 48.4188L34.7913 46.3404L36.3608 45.3586C37.8944 44.3553 40.2021 42.7571 45.9856 38.7187C51.7942 34.6588 57.4021 32.3404 63.4758 31.3406C67.6038 30.6598 70.5493 30.5774 77.1427 30.8461L77.2143 24.0127Z"
          clipRule="evenodd"
        />
      </g>
    </g>
    <defs>
      <clipPath id="openrouterdark__a">
        <path fill="#fff" d="M0 0H86V86H0z" transform="translate(17 17)" />
      </clipPath>
    </defs>
  </svg>
)
export { OpenrouterDark }
export default OpenrouterDark
