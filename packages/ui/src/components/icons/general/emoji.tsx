import type { SVGProps } from 'react'

import type { IconComponent } from '../types'
const Emoji: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0.537 0.537 22.926 22.926"
    {...props}>
    <path
      stroke="#000"
      strokeLinecap="round"
      strokeOpacity={0.9}
      strokeWidth={1.5}
      d="M8.9126 15.9331C10.1709 16.2485 11.5985 16.2487 13.0351 15.8638C14.4717 15.4788 15.7079 14.7649 16.64 13.8626"
    />
    <ellipse cx={14.509} cy={9.775} fill="#000" fillOpacity={0.9} rx={1} ry={1.5} transform="rotate(-15 14.51 9.775)" />
    <ellipse
      cx={8.714}
      cy={11.328}
      fill="#000"
      fillOpacity={0.9}
      rx={1}
      ry={1.5}
      transform="rotate(-15 8.714 11.328)"
    />
    <path
      stroke="#000"
      strokeOpacity={0.9}
      strokeWidth={1.5}
      d="M3.20356 14.357C2.09246 10.2103 1.53691 8.13698 2.47995 6.50359C3.42298 4.87021 5.49632 4.31466 9.643 3.20356C13.7897 2.09246 15.863 1.53691 17.4964 2.47995C19.1298 3.42298 19.6853 5.49632 20.7964 9.643C21.9075 13.7897 22.4631 15.863 21.5201 17.4964C20.577 19.1298 18.5037 19.6853 14.357 20.7964C10.2103 21.9075 8.13698 22.4631 6.50359 21.5201C4.87021 20.577 4.31466 18.5037 3.20356 14.357Z"
    />
    <path
      stroke="#000"
      strokeOpacity={0.9}
      strokeWidth={1.5}
      d="M13 15.9999L13.478 16.9737C13.8393 17.7099 14.7249 18.0193 15.4661 17.6685C16.2223 17.3105 16.5394 16.403 16.1708 15.6519L15.7115 14.7163"
    />
  </svg>
)
export { Emoji }
export default Emoji
