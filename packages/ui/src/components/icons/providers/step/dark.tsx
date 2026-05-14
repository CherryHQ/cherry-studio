import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const StepDark: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <g clipPath="url(#stepdark__a)">
      <mask
        id="stepdark__b"
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
      <g mask="url(#stepdark__b)">
        <path
          fill="url(#stepdark__c)"
          fillRule="evenodd"
          d="M95.8763 17H99.5743V20.3218H103V23.7904H99.5743V30.545H95.8763V23.794H89.1468V20.3182H95.8763V17ZM26.3167 61.3294V23.7008H29.7889V61.333H26.3131L26.3167 61.3294ZM63.6657 63.6944H102.903V66.9839H80.6579V101.309H63.6657V63.6908V63.6944ZM37.1706 28.9433V73.2189H17V89.3798H54.2165V45.6667H91.7447L91.734 28.9397L37.1706 28.9433Z"
          clipRule="evenodd"
        />
      </g>
    </g>
    <defs>
      <linearGradient id="stepdark__c" x1={22.898} x2={82.725} y1={23.866} y2={96.159} gradientUnits="userSpaceOnUse">
        <stop stopColor="#01A9FF" />
        <stop offset={1} stopColor="#0160FF" />
      </linearGradient>
      <clipPath id="stepdark__a">
        <path fill="#fff" d="M0 0H86V86H0z" transform="translate(17 17)" />
      </clipPath>
    </defs>
  </svg>
)
export { StepDark }
export default StepDark
