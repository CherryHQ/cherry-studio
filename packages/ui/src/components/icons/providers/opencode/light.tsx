import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const OpencodeLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="-30 0 300 300" {...props}>
    <path fill="#211E1E" d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" />
    <path fill="#CFCECD" d="M180 240H60V120H180V240Z" />
  </svg>
)
export { OpencodeLight }
export default OpencodeLight
