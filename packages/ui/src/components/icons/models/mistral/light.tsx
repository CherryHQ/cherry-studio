import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const MistralLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" {...props}>
    <path fill="gold" d="M6.28534 6H8.57134V8.28534H6.28534V6ZM15.428 6H17.7147V8.28534H15.428V6Z" />
    <path
      fill="#FFAF00"
      d="M6.28534 8.28534H10.8567V10.5713H6.28601L6.28534 8.28534ZM13.1427 8.28534H17.714V10.5713H13.1427V8.28534Z"
    />
    <path fill="#FF8205" d="M6.28534 10.572H17.7147V12.8573H6.28534V10.572Z" />
    <path
      fill="#FA500F"
      d="M6.28534 12.8573H8.57134V15.1427H6.28534V12.8573ZM10.8573 12.8573H13.1433V15.1427H10.8573V12.8573ZM15.428 12.8573H17.7147V15.1427H15.428V12.8573Z"
    />
    <path fill="#E10500" d="M4 15.1427H10.8573V17.4287H4V15.1427ZM13.1427 15.1427H20V17.4287H13.1427V15.1427Z" />
  </svg>
)
export { MistralLight }
export default MistralLight
