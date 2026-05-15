import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const Vidu: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    style={{
      flex: '0 0 auto',
      lineHeight: 1
    }}
    viewBox="0 0 24 24"
    {...props}>
    <path
      fill="url(#vidu__a)"
      d="M20.607 2.247c-2.917-.966-5.426 1.084-6.011 2.96 0 0-2.105 6.76-3.002 9.58-.428 1.346-1.489 3.548-3.487 3.548-1.627 0-2.463-1.527-2.816-2.437L2.865 9.431c-.281-.681.013-2.04 1.14-2.447 1.204-.432 1.978.575 2.178 1.11l3.022 7.74c.72-.928 1.178-2.438 1.476-3.507l-1.984-5.21C7.756 4.686 5.267 3.58 2.962 4.43 1.095 5.118-.702 7.474.275 10.435l2.504 6.44c.38.976 1.881 4.163 5.275 4.163 4.073 0 5.601-3.473 6.449-6.218.424-1.373 2.749-8.797 2.749-8.797.338-1.109 1.71-1.428 2.568-1.148.605.196 1.698 1.031 1.345 2.325-.066.236-1.92 6.209-2.604 8.026-.357.948-1.262 3.006-3.324 2.72-.628 1.39-1.15 2.199-1.94 2.925 2.572 1.218 6.32-.009 7.898-4.776.586-1.773 2.644-8.166 2.644-8.166.598-1.963-.469-4.768-3.232-5.682z"
    />
    <defs>
      <linearGradient id="vidu__a" x1={0.759} x2={26.155} y1={5.637} y2={17.311} gradientUnits="userSpaceOnUse">
        <stop stopColor="#40EDD8" />
        <stop offset={0.024} stopColor="#38E7E2" />
        <stop offset={0.084} stopColor="#28DAF7" />
        <stop offset={0.124} stopColor="#22D5FF" />
        <stop offset={0.36} stopColor="#1ABFFF" />
        <stop offset={0.85} stopColor="#0786FE" />
        <stop offset={0.909} stopColor="#047FFE" />
      </linearGradient>
    </defs>
  </svg>
)
export { Vidu }
export default Vidu
