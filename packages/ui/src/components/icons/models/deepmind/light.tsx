import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const DeepmindLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g clipPath={`url(#${iconId}-deepmindlight__a)`}>
        <path
          fill="#4285F4"
          fillRule="evenodd"
          d="M2.994 0.811C2.54408 1.25104 2.19701 1.78511 1.97763 2.37497C1.75825 2.96483 1.67198 3.5959 1.725 4.223C1.8995 6.427 3.978 8.2205 5.863 8.2205C7.6165 8.2205 8.303 6.69 8.1335 5.6505C8.0709 5.26868 7.90685 4.9107 7.6585 4.614C7.9745 4.784 8.2805 5.002 8.563 5.264C9.323 5.9715 9.783 6.8785 9.8565 7.814C10.02 9.8815 8.49 12 5.9315 12C5.084 12 4.1915 11.784 3.4415 11.4285C1.408 10.4685 0 8.3985 0 6.001C0 3.7855 1.2025 1.85 2.994 0.811ZM6.068 0C6.916 0 7.8085 0.216 8.558 0.5715C10.593 1.5315 12 3.6015 12 5.999C12 8.2145 10.7975 10.1505 9.006 11.189C9.45592 10.749 9.80299 10.2149 10.0224 9.62503C10.2418 9.03517 10.328 8.4041 10.275 7.777C10.1005 5.573 8.022 3.7795 6.137 3.7795C4.3835 3.7795 3.697 5.31 3.8665 6.3495C3.9291 6.7316 4.09373 7.08971 4.343 7.386C4.01478 7.20892 3.71064 6.99047 3.438 6.736C2.678 6.0285 2.218 5.1225 2.1435 4.186C1.98 2.1185 3.5095 0 6.068 0Z"
          clipRule="evenodd"
        />
      </g>
      <defs>
        <clipPath id={`${iconId}-deepmindlight__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { DeepmindLight }
export default DeepmindLight
