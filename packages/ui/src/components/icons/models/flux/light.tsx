import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'

const FluxLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="var(--icon-neutral-background, #FFFFFF)" d="M0 0H120V120H0z" />
    <g fill="#000" fillRule="evenodd" clipRule="evenodd">
      <path
        d="M4 18.122L12.0067 6L20 18.122H18.5113L12.006 8.252L6.314 16.8707H14.3953L15.2213 18.122H4Z"
        transform="translate(-2.48 -2.826)scale(5.20661)"
      />
      <path
        d="M9.3793 15.4827L10.7613 13.406L12.144 15.4827H9.3793ZM16.16 18.122L12.3813 12.3173H13.8326L17.6233 18.122H16.16ZM17.16 12.1173L18.58 9.99066L20 12.1173H17.16Z"
        transform="translate(-2.48 -2.826)scale(5.20661)"
      />
    </g>
  </svg>
)

export { FluxLight }

export default FluxLight
