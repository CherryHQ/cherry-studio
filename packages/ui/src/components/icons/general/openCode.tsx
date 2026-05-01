import type { SVGProps } from 'react'
const OpenCode = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <g clipPath="url(#opencode__a)">
      <path
        fill="#000"
        fillRule="evenodd"
        d="M77.2 34.2H42.8V85.8H77.2V34.2ZM94.4 103H25.6V17H94.4V103Z"
        clipRule="evenodd"
      />
    </g>
    <defs>
      <clipPath id="opencode__a">
        <path fill="#fff" d="M0 0H86V86H0z" transform="translate(17 17)" />
      </clipPath>
    </defs>
  </svg>
)
export { OpenCode }
export default OpenCode
