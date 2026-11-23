import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'

const TwitterLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="var(--icon-neutral-background, #FFFFFF)" d="M0 0H120V120H0z" />
    <path
      fill="#000"
      d="M79.1864 31H89.1582L67.3785 55.9899L93 90H72.9435L57.2231 69.3783L39.2571 90H29.2711L52.5621 63.2656L28 31H48.565L62.7599 49.8488L79.1864 31ZM75.6836 84.0148H81.2062L45.5564 36.6731H39.6243L75.6836 84.0148Z"
      transform="matrix(1.27919 0 0 1.27919 -17.39 -17.39)"
    />
  </svg>
)

export { TwitterLight }

export default TwitterLight
