import type { SVGProps } from 'react'

import { OpenCode } from '../../general/open-code'

const OpenCodeGoDark = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 120 120" {...props}>
    <path fill="#131010" d="M0 0h120v120H0z" />
    <OpenCode x={18} y={18} width={84} height={84} viewBox="17 17 86 86" color="#FFFFFF" />
  </svg>
)

export { OpenCodeGoDark }
