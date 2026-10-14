import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const AzureaiLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
      <mask
        id={`${iconId}-azureailight__a`}
        width={65}
        height={65}
        x={27}
        y={27}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M92 27H27V92H92V27Z" />
      </mask>
      <g mask={`url(#${iconId}-azureailight__a)`}>
        <mask
          id={`${iconId}-azureailight__b`}
          width={65}
          height={65}
          x={27}
          y={27}
          maskUnits="userSpaceOnUse"
          style={{
            maskType: 'luminance'
          }}>
          <path fill="#fff" d="M92 27H27V92H92V27Z" />
        </mask>
        <g mask={`url(#${iconId}-azureailight__b)`}>
          <path
            fill={`url(#${iconId}-azureailight__c)`}
            fillRule="evenodd"
            d="M70.9652 27C72.8962 27 74.6079 28.4923 75.2227 30.5994C75.8375 32.7065 79.4341 45.739 79.4341 45.739V71.636H66.3989L66.6644 27H70.9652Z"
            clipRule="evenodd"
          />
          <path
            fill={`url(#${iconId}-azureailight__d)`}
            d="M90.0998 47.2316C90.0998 46.3108 89.3553 45.6066 88.4751 45.6066H80.797C78.2013 45.6088 75.7126 46.641 73.8774 48.4767C72.0423 50.3124 71.0107 52.8015 71.009 55.3972V71.6363H80.3149C82.9098 71.6336 85.3974 70.6012 87.232 68.7663C89.0666 66.9311 90.0982 64.4433 90.0998 61.8484V47.2316Z"
          />
          <path
            fill={`url(#${iconId}-azureailight__e)`}
            fillRule="evenodd"
            d="M70.9646 27.0001C70.612 26.9976 70.2626 27.0651 69.9366 27.1988C69.6104 27.3325 69.3142 27.5297 69.065 27.7789C68.8156 28.0282 68.6184 28.3245 68.4846 28.6506C68.3511 28.9767 68.2834 29.3262 68.2861 29.6786L68.0234 78.9648C68.0226 82.4217 66.6489 85.7369 64.2046 88.1812C61.7601 90.6259 58.4451 91.9992 54.9882 92H31.3335C31.0745 92.0015 30.819 91.941 30.5884 91.8231C30.3578 91.7052 30.1589 91.5337 30.0084 91.3228C29.8578 91.1119 29.7602 90.8685 29.7235 90.6123C29.6869 90.3553 29.7124 90.0938 29.7979 89.8497L48.7562 35.7344C49.6493 33.1864 51.3107 30.978 53.5114 29.4137C55.7121 27.8494 58.3438 27.0061 61.044 27.0001H71.0079H70.9646Z"
            clipRule="evenodd"
          />
        </g>
      </g>
      <defs>
        <linearGradient
          id={`${iconId}-azureailight__c`}
          x1={76.406}
          x2={65.435}
          y1={72.6}
          y2={28.668}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#712575" />
          <stop offset={0.09} stopColor="#9A2884" />
          <stop offset={0.18} stopColor="#BF2C92" />
          <stop offset={0.27} stopColor="#DA2E9C" />
          <stop offset={0.34} stopColor="#EB30A2" />
          <stop offset={0.4} stopColor="#F131A5" />
          <stop offset={0.5} stopColor="#EC30A3" />
          <stop offset={0.61} stopColor="#DF2F9E" />
          <stop offset={0.72} stopColor="#C92D96" />
          <stop offset={0.83} stopColor="#AA2A8A" />
          <stop offset={0.95} stopColor="#83267C" />
          <stop offset={1} stopColor="#712575" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-azureailight__d`}
          x1={80.578}
          x2={80.578}
          y1={27.921}
          y2={89.894}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#DA7ED0" />
          <stop offset={0.08} stopColor="#B17BD5" />
          <stop offset={0.19} stopColor="#8778DB" />
          <stop offset={0.3} stopColor="#6276E1" />
          <stop offset={0.41} stopColor="#4574E5" />
          <stop offset={0.54} stopColor="#2E72E8" />
          <stop offset={0.67} stopColor="#1D71EB" />
          <stop offset={0.81} stopColor="#1471EC" />
          <stop offset={1} stopColor="#1171ED" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-azureailight__e`}
          x1={76.844}
          x2={35.764}
          y1={29.326}
          y2={95.204}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#DA7ED0" />
          <stop offset={0.05} stopColor="#B77BD4" />
          <stop offset={0.11} stopColor="#9079DA" />
          <stop offset={0.18} stopColor="#6E77DF" />
          <stop offset={0.25} stopColor="#5175E3" />
          <stop offset={0.33} stopColor="#3973E7" />
          <stop offset={0.42} stopColor="#2772E9" />
          <stop offset={0.54} stopColor="#1A71EB" />
          <stop offset={0.68} stopColor="#1371EC" />
          <stop offset={1} stopColor="#1171ED" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { AzureaiLight }
export default AzureaiLight
