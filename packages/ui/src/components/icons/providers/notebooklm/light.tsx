import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const NotebooklmLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <g clipPath="url(#notebooklmlight__a)">
      <path
        fill="#fff"
        d="M60 103C83.7482 103 103 83.7482 103 60C103 36.2518 83.7482 17 60 17C36.2518 17 17 36.2518 17 60C17 83.7482 36.2518 103 60 103Z"
      />
      <mask
        id="notebooklmlight__b"
        width={54}
        height={41}
        x={33}
        y={35}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M86.875 35.8125H33.125V75.2291H86.875V35.8125Z" />
      </mask>
      <g mask="url(#notebooklmlight__b)">
        <path
          fill="#000"
          d="M60 35.8125C45.156 35.8125 33.125 47.745 33.125 62.468V75.229H38.079V73.9573C38.079 67.9863 42.9568 63.1444 48.9768 63.1444C54.9968 63.1444 59.8746 67.9863 59.8746 73.9573V75.229H64.8285V73.9573C64.8285 65.272 57.7291 58.2352 48.9768 58.2352C45.5681 58.2352 42.4103 59.3013 39.8259 61.1198C42.5312 55.7851 48.1033 52.1256 54.5354 52.1256C63.6237 52.1256 70.9919 59.4356 70.9919 68.4477V75.229H75.946V68.4477C75.946 56.7212 66.3604 47.212 54.5354 47.212C49.2187 47.212 44.3543 49.1335 40.6097 52.3182C44.2871 45.4248 51.5881 40.7262 60 40.7262C72.1072 40.7262 81.9209 50.4594 81.9209 62.468V75.229H86.875V62.468C86.875 47.745 74.8441 35.8125 60 35.8125Z"
        />
      </g>
    </g>
    <defs>
      <clipPath id="notebooklmlight__a">
        <path fill="#fff" d="M0 0H86V86H0z" transform="translate(17 17)" />
      </clipPath>
    </defs>
  </svg>
)
export { NotebooklmLight }
export default NotebooklmLight
