import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const OpencodeGoMono: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 512 512" {...props}>
    <rect width="512" height="512" fill="currentColor" />
    <path d="M320 224V352H192V224H320Z" fill="#5A5858" />
    <path fillRule="evenodd" clipRule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="white" />
  </svg>
)
export { OpencodeGoMono }
export default OpencodeGoMono
