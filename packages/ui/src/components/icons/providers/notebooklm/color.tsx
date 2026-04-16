import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const Notebooklm: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 16 16" {...props}>
    <circle cx={8} cy={8} r={8} fill="var(--color-background, white)" />
    <path
      fill="currentColor"
      d="M8 3.5C5.23833 3.5 3 5.72 3 8.45917V10.8333H3.92167V10.5967C3.92167 9.48583 4.82917 8.585 5.94917 8.585C7.06917 8.585 7.97667 9.48583 7.97667 10.5967V10.8333H8.89833V10.5967C8.89833 8.98083 7.5775 7.67167 5.94917 7.67167C5.315 7.67167 4.7275 7.87 4.24667 8.20833C4.75 7.21583 5.78667 6.535 6.98333 6.535C8.67417 6.535 10.045 7.895 10.045 9.57167V10.8333H10.9667V9.57167C10.9667 7.39 9.18333 5.62083 6.98333 5.62083C5.99417 5.62083 5.08917 5.97833 4.3925 6.57083C5.07667 5.28833 6.435 4.41417 8 4.41417C10.2525 4.41417 12.0783 6.225 12.0783 8.45917V10.8333H13V8.45917C13 5.72 10.7617 3.5 8 3.5Z"
    />
  </svg>
)
export { Notebooklm }
export default Notebooklm
