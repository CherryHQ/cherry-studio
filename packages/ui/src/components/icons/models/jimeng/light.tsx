import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const JimengLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      fill="none"
      style={{
        flex: 'none',
        lineHeight: 1
      }}
      viewBox="0 0 24 24"
      {...props}>
      <g clipPath={`url(#${iconId}-jimenglight__a)`}>
        <g
          fill={`url(#${iconId}-jimenglight__b)`}
          shapeRendering="crispEdges"
          transform="matrix(-.00927 -.01745 .0215 -.01349 13.047 18.23)">
          <path d="M0 0H1077.71V666.506H0z" />
          <path d="M0 0H1077.71V666.506H0z" transform="scale(1 -1)" />
          <path d="M0 0H1077.71V666.506H0z" transform="scale(-1 1)" />
          <path d="M0 0H1077.71V666.506H0z" transform="scale(-1)" />
        </g>
      </g>
      <g clipPath={`url(#${iconId}-jimenglight__c)`}>
        <g
          fill={`url(#${iconId}-jimenglight__d)`}
          shapeRendering="crispEdges"
          transform="matrix(-.00283 -.0049 .00972 -.00561 16.59 23.223)">
          <path d="M0 0H4828.03V1485.61H0z" />
          <path d="M0 0H4828.03V1485.61H0z" transform="scale(1 -1)" />
          <path d="M0 0H4828.03V1485.61H0z" transform="scale(-1 1)" />
          <path d="M0 0H4828.03V1485.61H0z" transform="scale(-1)" />
        </g>
      </g>
      <defs>
        <linearGradient id={`${iconId}-jimenglight__b`} x1={0} x2={500} y1={0} y2={500} gradientUnits="userSpaceOnUse">
          <stop stopColor="#27B2F0" />
          <stop offset={0.203} stopColor="#26DFFB" />
          <stop offset={0.406} stopColor="#30F5FE" />
          <stop offset={0.653} stopColor="#F0FEFC" />
          <stop offset={0.863} stopColor="#FBC610" />
          <stop offset={1} stopColor="#FD9C22" />
        </linearGradient>
        <linearGradient id={`${iconId}-jimenglight__d`} x1={0} x2={500} y1={0} y2={500} gradientUnits="userSpaceOnUse">
          <stop stopColor="#1C6FFF" />
          <stop offset={1} stopColor="#24B5EF" />
        </linearGradient>
        <clipPath id={`${iconId}-jimenglight__a`}>
          <path d="M5.25711 1.80765C8.76812 6.74075 14.4314 9.45056 20.0636 8.40323C20.4619 8.32917 20.8947 8.19661 21.3451 8.02311C22.2001 7.69374 23.3197 9.03389 22.6709 9.68084C22.2415 10.1091 21.8312 10.5013 21.4634 10.8278C18.9269 13.0793 16.1264 15.1096 13.0744 16.8717C10.003 18.6449 6.8237 20.0618 3.58429 21.1352C3.13145 21.2853 2.60446 21.4391 2.038 21.5917C1.15348 21.8301 0.554197 20.1919 1.2674 19.617C1.6464 19.3114 1.98071 19.0005 2.246 18.6902C5.96908 14.3363 6.29888 8.17371 3.71732 2.69665C3.6056 2.45961 3.48162 2.17153 3.35287 1.85684C2.99465 0.981289 4.04156 0.335123 4.65576 1.05462C4.89891 1.33945 5.10904 1.5996 5.25711 1.80765Z" />
        </clipPath>
        <clipPath id={`${iconId}-jimenglight__c`}>
          <path d="M19.529 13.6948C17.2056 16.5579 16.7138 19.6388 17.1514 22.2781C17.1594 22.3264 17.1678 22.3799 17.1763 22.4375C17.2926 23.2284 16.3596 23.7154 15.7279 23.2254C15.6957 23.2004 15.6645 23.1765 15.6347 23.1538C13.5149 21.5401 11.0142 20.326 7.68635 20.7079C9.70085 20.1175 11.7605 19.243 13.7728 18.0812C15.9822 16.8056 17.9201 15.3074 19.529 13.6948Z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { JimengLight }
export default JimengLight
