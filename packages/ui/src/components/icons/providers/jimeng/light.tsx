import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const JimengLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
      <mask
        id={`${iconId}-jimenglight__a`}
        width={63}
        height={60}
        x={29}
        y={27}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path
          fill="#fff"
          d="M41.34 30.0472C51.4044 44.1867 67.6361 51.9541 83.7796 48.9513C84.9206 48.7389 86.1618 48.359 87.4524 47.8625C89.9034 46.9174 93.1124 50.7593 91.2524 52.6136C90.1303 53.7419 88.9763 54.8381 87.7918 55.9006C80.3827 62.4728 72.3263 68.2769 63.7464 73.224C55.1181 78.212 46.0035 82.3068 36.5441 85.4449C35.2475 85.8756 33.7371 86.3167 32.113 86.7534C29.5782 87.4368 27.8599 82.7411 29.9042 81.0931C30.9899 80.2183 31.9485 79.327 32.7097 78.4372C43.3812 65.9576 44.3264 48.2933 36.9269 32.5954C36.5584 31.8017 36.2099 30.9989 35.8816 30.1877C34.8557 27.6768 37.8556 25.8255 39.6157 27.8862C40.2205 28.5816 40.7957 29.3035 41.34 30.0472Z"
        />
      </mask>
      <g mask={`url(#${iconId}-jimenglight__a)`}>
        <path
          fill={`url(#${iconId}-jimenglight__b)`}
          d="M35.0311 23.2189L63.6691 77.1152L104.745 51.3485L76.1069 -2.54922L35.0311 23.2189Z"
        />
        <path
          fill={`url(#${iconId}-jimenglight__c)`}
          d="M35.031 23.2191L63.669 77.1153L22.5933 102.883L-6.04468 48.9872L35.031 23.2191Z"
        />
        <path
          fill={`url(#${iconId}-jimenglight__d)`}
          d="M92.3083 131.013L63.6704 77.1167L104.746 51.347L133.384 105.245L92.3083 131.013Z"
        />
        <path
          fill={`url(#${iconId}-jimenglight__e)`}
          d="M92.3067 131.013L63.6687 77.1167L22.5929 102.883L51.2309 156.781L92.3067 131.013Z"
        />
      </g>
      <mask
        id={`${iconId}-jimenglight__f`}
        width={35}
        height={28}
        x={48}
        y={64}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path
          fill="#fff"
          d="M82.2453 64.1184C75.5875 72.3255 74.1773 81.1562 75.4319 88.7217L75.5022 89.1778C75.8357 91.4448 73.1618 92.8415 71.3509 91.436L71.0847 91.231C65.0087 86.6056 57.8409 83.1257 48.3014 84.2203C54.0754 82.529 59.9809 80.0211 65.7474 76.6922C72.0807 73.0358 77.6348 68.7408 82.2453 64.1184Z"
        />
      </mask>
      <g mask={`url(#${iconId}-jimenglight__f)`}>
        <path
          fill={`url(#${iconId}-jimenglight__g)`}
          d="M34.718 23.6992L73.8212 91.4288L115.204 67.5356L76.1004 -0.193665L34.718 23.6992Z"
        />
        <path
          fill={`url(#${iconId}-jimenglight__h)`}
          d="M34.7188 23.6991L73.822 91.428L32.4382 115.321L-6.66797 47.592L34.7188 23.6991Z"
        />
        <path
          fill={`url(#${iconId}-jimenglight__i)`}
          d="M112.927 159.159L73.8207 91.4297L115.206 67.5356L154.311 135.265L112.927 159.159Z"
        />
        <path
          fill={`url(#${iconId}-jimenglight__j)`}
          d="M112.928 159.159L73.8218 91.4297L32.441 115.32L71.5443 183.05L112.928 159.159Z"
        />
      </g>
      <defs>
        <linearGradient
          id={`${iconId}-jimenglight__b`}
          x1={63.669}
          x2={69.567}
          y1={77.115}
          y2={31.282}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#27B2F0" />
          <stop offset={0.203} stopColor="#26DFFB" />
          <stop offset={0.406} stopColor="#30F5FE" />
          <stop offset={0.653} stopColor="#F0FEFC" />
          <stop offset={0.863} stopColor="#FBC610" />
          <stop offset={1} stopColor="#FD9C22" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-jimenglight__c`}
          x1={63.669}
          x2={23.588}
          y1={77.115}
          y2={61.271}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#27B2F0" />
          <stop offset={0.203} stopColor="#26DFFB" />
          <stop offset={0.406} stopColor="#30F5FE" />
          <stop offset={0.653} stopColor="#F0FEFC" />
          <stop offset={0.863} stopColor="#FBC610" />
          <stop offset={1} stopColor="#FD9C22" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-jimenglight__d`}
          x1={63.67}
          x2={103.75}
          y1={77.115}
          y2={92.961}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#27B2F0" />
          <stop offset={0.203} stopColor="#26DFFB" />
          <stop offset={0.406} stopColor="#30F5FE" />
          <stop offset={0.653} stopColor="#F0FEFC" />
          <stop offset={0.863} stopColor="#FBC610" />
          <stop offset={1} stopColor="#FD9C22" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-jimenglight__e`}
          x1={63.669}
          x2={57.77}
          y1={77.115}
          y2={122.948}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#27B2F0" />
          <stop offset={0.203} stopColor="#26DFFB" />
          <stop offset={0.406} stopColor="#30F5FE" />
          <stop offset={0.653} stopColor="#F0FEFC" />
          <stop offset={0.863} stopColor="#FBC610" />
          <stop offset={1} stopColor="#FD9C22" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-jimenglight__g`}
          x1={73.821}
          x2={72.996}
          y1={91.429}
          y2={76.985}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#1C6FFF" />
          <stop offset={1} stopColor="#24B5EF" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-jimenglight__h`}
          x1={73.822}
          x2={61.725}
          y1={91.428}
          y2={83.492}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#1C6FFF" />
          <stop offset={1} stopColor="#24B5EF" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-jimenglight__i`}
          x1={73.822}
          x2={85.919}
          y1={91.429}
          y2={99.366}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#1C6FFF" />
          <stop offset={1} stopColor="#24B5EF" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-jimenglight__j`}
          x1={73.823}
          x2={74.649}
          y1={91.428}
          y2={105.873}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#1C6FFF" />
          <stop offset={1} stopColor="#24B5EF" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { JimengLight }
export default JimengLight
