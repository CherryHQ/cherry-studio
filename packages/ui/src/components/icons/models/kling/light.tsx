import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const KlingLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" {...props}>
      <path
        fill={`url(#${iconId}-klinglight__a)`}
        d="M7.60816 12.8497C7.94642 11.8157 8.39288 10.8202 8.94012 9.87983C11.0534 6.21861 14.1366 4.04201 15.8266 5.01732C12.0254 2.82272 7.06551 4.29601 4.74825 8.30921C4.47169 8.78802 4.24025 9.2915 4.05694 9.81317C3.88427 10.3058 4.11827 10.8358 4.57025 11.0971L7.60816 12.8504V12.8497Z"
      />
      <path
        fill={`url(#${iconId}-klinglight__b)`}
        d="M16.3918 10.4425C16.0534 11.4766 15.6067 12.4721 15.0592 13.4124C12.9459 17.0736 9.86268 19.2509 8.17273 18.2749C11.9746 20.4702 16.9345 18.9962 19.2517 14.983C19.5282 14.5044 19.7596 14.0012 19.943 13.4797C20.1157 12.9878 19.8817 12.4571 19.4297 12.1965L16.3918 10.4432V10.4425Z"
      />
      <path
        fill={`url(#${iconId}-klinglight__c)`}
        d="M15.0599 13.4131C17.1732 9.75185 17.5172 5.9933 15.8266 5.01733C14.138 4.04203 11.0547 6.21996 8.94012 9.87984C10.3227 7.48658 12.8127 6.33662 14.5026 7.31192C16.1919 8.28789 16.4412 11.0185 15.0593 13.4124L15.0599 13.4131Z"
      />
      <path
        fill={`url(#${iconId}-klinglight__d)`}
        d="M8.94005 9.87985C6.82678 13.5411 6.48279 17.2996 8.17341 18.2749C9.86269 19.2509 12.9459 17.0736 15.0599 13.4124C13.6772 15.8063 11.1873 16.9563 9.49737 15.9803C7.80809 15.005 7.55876 12.2738 8.94072 9.88052L8.94005 9.87985Z"
      />
      <defs>
        <radialGradient
          id={`${iconId}-klinglight__a`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="matrix(4.985 -8.33988 11.42878 6.83132 7.449 12.758)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.095} stopColor="#FFF959" />
          <stop offset={0.326} stopColor="#0DF35E" />
          <stop offset={0.64} stopColor="#0BF2F9" />
          <stop offset={1} stopColor="#04A6F0" />
        </radialGradient>
        <radialGradient
          id={`${iconId}-klinglight__b`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="matrix(-4.985 8.33988 -11.4288 -6.83131 16.55 10.534)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.095} stopColor="#FFF959" />
          <stop offset={0.326} stopColor="#0DF35E" />
          <stop offset={0.64} stopColor="#0BF2F9" />
          <stop offset={1} stopColor="#04A6F0" />
        </radialGradient>
        <linearGradient
          id={`${iconId}-klinglight__c`}
          x1={14.385}
          x2={16.041}
          y1={4.865}
          y2={10.241}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#003EFF" />
          <stop offset={1} stopColor="#0BFFE7" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-klinglight__d`}
          x1={9.615}
          x2={7.959}
          y1={18.428}
          y2={13.052}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#003EFF" />
          <stop offset={1} stopColor="#0BFFE7" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { KlingLight }
export default KlingLight
