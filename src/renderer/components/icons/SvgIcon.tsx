import { createLucideIcon } from 'lucide-react'
import { type SVGProps, useId } from 'react'

export function McpLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      height="1em"
      width="1em"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}>
      <title>ModelContextProtocol</title>
      <path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z"></path>
      <path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z"></path>
    </svg>
  )
}

export function OpenClawIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      {...props}>
      <path d="M14.4 5.2a5.3 5.3 0 0 1 2.022-2.548L16.8 2.4" />
      <path d="M14.56 8.933v1" />
      <path d="m15.1 18.933.81 2.65" />
      <path d="M18.56 8.433c.833.333 2 1 2 2" />
      <path d="M5.56 8.433c-.833.333-2 1-2 2" />
      <path d="m7.91 18.933-.81 2.65" />
      <path d="M9.56 8.933v1" />
      <path d="M9.6 5.2a5.3 5.3 0 0 0-2.022-2.548L7.2 2.4" />
      <circle cx="12" cy="12" r="7.2" />
    </svg>
  )
}

export const OpenClawSidebarIcon = createLucideIcon('OpenClaw', [
  ['path', { d: 'M8 4Q6 1 4 2' }],
  ['path', { d: 'M16 4q2-3 4-2' }],
  ['circle', { cx: '12', cy: '12', r: '9' }],
  ['circle', { cx: '9', cy: '10', r: '1.5', fill: 'currentColor', stroke: 'none' }],
  ['circle', { cx: '15', cy: '10', r: '1.5', fill: 'currentColor', stroke: 'none' }],
  ['path', { d: 'M9 21v2' }],
  ['path', { d: 'M15 21v2' }]
])

export const FinderIcon = (props: SVGProps<SVGSVGElement>) => {
  const uid = useId()
  const blueGradientId = `finder_blue_${uid}`
  const whiteGradientId = `finder_white_${uid}`

  return (
    <svg xmlns="http://www.w3.org/2000/svg" aria-label="Finder" role="img" viewBox="0 0 512 512" {...props}>
      {/* License: MIT. Made by edent: https://github.com/edent/SuperTinyIcons */}
      <rect width="512" height="512" rx="15%" fill={`url(#${blueGradientId})`} />
      <defs>
        <linearGradient id={blueGradientId} x2="0" y1="100%">
          <stop offset="0" stopColor="#1e73f2" />
          <stop offset="1" stopColor="#19d3fd" />
        </linearGradient>
        <linearGradient id={whiteGradientId} x2="0" y1="100%">
          <stop offset="0" stopColor="#dbe9f4" />
          <stop offset="1" stopColor="#f7f6f6" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${whiteGradientId})`}
        d="M435.2 0H274.4c-21.2 49.2-59.2 129.6-60.8 283.4a9.9 9.9 0 0 0 10 10.1h58.7a9.9 9.9 0 0 1 9.9 10.2A933.3 933.3 0 0 0 311.3 512h123.9a76.8 76.8 0 0 0 76.8-76.8V76.8A76.8 76.8 0 0 0 435.2 0z"
      />
      <path
        fill="none"
        stroke="#000"
        strokeLinecap="round"
        strokeWidth="20"
        d="M371 149v34m-229-34v34m263.4 147.2a215.2 215.2 0 0 1-298.8 0"
      />
    </svg>
  )
}

// https://code.visualstudio.com/brand
export const VsCodeIcon = (props: SVGProps<SVGSVGElement>) => {
  const uid = useId()
  const maskId = `mask0${uid}`
  const filter0Id = `filter0_d${uid}`
  const filter1Id = `filter1_d${uid}`
  const gradientId = `paint0_linear${uid}`

  return (
    <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <mask id={maskId} style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M70.9119 99.3171C72.4869 99.9307 74.2828 99.8914 75.8725 99.1264L96.4608 89.2197C98.6242 88.1787 100 85.9892 100 83.5872V16.4133C100 14.0113 98.6243 11.8218 96.4609 10.7808L75.8725 0.873756C73.7862 -0.130129 71.3446 0.11576 69.5135 1.44695C69.252 1.63711 69.0028 1.84943 68.769 2.08341L29.3551 38.0415L12.1872 25.0096C10.589 23.7965 8.35363 23.8959 6.86933 25.2461L1.36303 30.2549C-0.452552 31.9064 -0.454633 34.7627 1.35853 36.417L16.2471 50.0001L1.35853 63.5832C-0.454633 65.2374 -0.452552 68.0938 1.36303 69.7453L6.86933 74.7541C8.35363 76.1043 10.589 76.2037 12.1872 74.9905L29.3551 61.9587L68.769 97.9167C69.3925 98.5406 70.1246 99.0104 70.9119 99.3171ZM75.0152 27.2989L45.1091 50.0001L75.0152 72.7012V27.2989Z"
          fill="white"
        />
      </mask>
      <g mask={`url(#${maskId})`}>
        <path
          d="M96.4614 10.7962L75.8569 0.875542C73.4719 -0.272773 70.6217 0.211611 68.75 2.08333L1.29858 63.5832C-0.515693 65.2373 -0.513607 68.0937 1.30308 69.7452L6.81272 74.754C8.29793 76.1042 10.5347 76.2036 12.1338 74.9905L93.3609 13.3699C96.086 11.3026 100 13.2462 100 16.6667V16.4275C100 14.0265 98.6246 11.8378 96.4614 10.7962Z"
          fill="#0065A9"
        />
        <g filter={`url(#${filter0Id})`}>
          <path
            d="M96.4614 89.2038L75.8569 99.1245C73.4719 100.273 70.6217 99.7884 68.75 97.9167L1.29858 36.4169C-0.515693 34.7627 -0.513607 31.9063 1.30308 30.2548L6.81272 25.246C8.29793 23.8958 10.5347 23.7964 12.1338 25.0095L93.3609 86.6301C96.086 88.6974 100 86.7538 100 83.3334V83.5726C100 85.9735 98.6246 88.1622 96.4614 89.2038Z"
            fill="#007ACC"
          />
        </g>
        <g filter={`url(#${filter1Id})`}>
          <path
            d="M75.8578 99.1263C73.4721 100.274 70.6219 99.7885 68.75 97.9166C71.0564 100.223 75 98.5895 75 95.3278V4.67213C75 1.41039 71.0564 -0.223106 68.75 2.08329C70.6219 0.211402 73.4721 -0.273666 75.8578 0.873633L96.4587 10.7807C98.6234 11.8217 100 14.0112 100 16.4132V83.5871C100 85.9891 98.6234 88.1786 96.4586 89.2196L75.8578 99.1263Z"
            fill="#1F9CF0"
          />
        </g>
        <g style={{ mixBlendMode: 'overlay' }} opacity="0.25">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M70.8511 99.3171C72.4261 99.9306 74.2221 99.8913 75.8117 99.1264L96.4 89.2197C98.5634 88.1787 99.9392 85.9892 99.9392 83.5871V16.4133C99.9392 14.0112 98.5635 11.8217 96.4001 10.7807L75.8117 0.873695C73.7255 -0.13019 71.2838 0.115699 69.4527 1.44688C69.1912 1.63705 68.942 1.84937 68.7082 2.08335L29.2943 38.0414L12.1264 25.0096C10.5283 23.7964 8.29285 23.8959 6.80855 25.246L1.30225 30.2548C-0.513334 31.9064 -0.515415 34.7627 1.29775 36.4169L16.1863 50L1.29775 63.5832C-0.515415 65.2374 -0.513334 68.0937 1.30225 69.7452L6.80855 74.754C8.29285 76.1042 10.5283 76.2036 12.1264 74.9905L29.2943 61.9586L68.7082 97.9167C69.3317 98.5405 70.0638 99.0104 70.8511 99.3171ZM74.9544 27.2989L45.0483 50L74.9544 72.7012V27.2989Z"
            fill={`url(#${gradientId})`}
          />
        </g>
      </g>
      <defs>
        <filter
          id={filter0Id}
          x="-8.39411"
          y="15.8291"
          width="116.727"
          height="92.2456"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset />
          <feGaussianBlur stdDeviation="4.16667" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
          <feBlend mode="overlay" in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
        </filter>
        <filter
          id={filter1Id}
          x="60.4167"
          y="-8.07558"
          width="47.9167"
          height="116.151"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset />
          <feGaussianBlur stdDeviation="4.16667" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
          <feBlend mode="overlay" in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
        </filter>
        <linearGradient
          id={gradientId}
          x1="49.9392"
          y1="0.257812"
          x2="49.9392"
          y2="99.7423"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// https://cursor.com/cn/brand
export const CursorIcon = (props: SVGProps<SVGSVGElement>) => {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      height="56"
      viewBox="0 0 24 24"
      width="56"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flex: '0 0 auto', lineHeight: 1 }}
      {...props}>
      <title>Cursor</title>
      <path d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z"></path>
    </svg>
  )
}

// Windows Terminal icon by Microsoft, licensed under CC BY-ND 4.0.
// Source: https://github.com/microsoft/terminal/blob/main/res/terminal/Terminal.svg
// License: https://github.com/microsoft/terminal/blob/main/res/LICENSE
// Embedded as JSX with per-render SVG IDs; the artwork geometry and colors are unchanged.
export const WindowsTerminalIcon = (props: SVGProps<SVGSVGElement>) => {
  const uid = useId()
  const maskId = `windows-terminal-mask0-${uid}`
  const filter0Id = `windows-terminal-filter0-dd-${uid}`
  const filter1Id = `windows-terminal-filter1-dd-${uid}`
  const filter2Id = `windows-terminal-filter2-dd-${uid}`
  const gradient0Id = `windows-terminal-paint0-linear-${uid}`
  const gradient1Id = `windows-terminal-paint1-linear-${uid}`
  const gradient2Id = `windows-terminal-paint2-linear-${uid}`
  const gradient3Id = `windows-terminal-paint3-linear-${uid}`
  const gradient4Id = `windows-terminal-paint4-linear-${uid}`
  const gradient5Id = `windows-terminal-paint5-linear-${uid}`

  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M0 13H16V6H2C0.9 6 0 6.9 0 8V13Z" fill="#CCCCCC" />
      <path d="M32 6H16V13H32V6Z" fill="#999999" />
      <path d="M48 13H32V6H46C47.1 6 48 6.9 48 8V13Z" fill="#666666" />
      <path d="M46 42H2C0.9 42 0 41.1 0 40V12H48V40C48 41.1 47.1 42 46 42Z" fill={`url(#${gradient0Id})`} />
      <g filter={`url(#${filter0Id})`}>
        <path
          d="M15.2 24.3L6.39999 33.1C5.89999 33.6 5.89999 34.3 6.39999 34.7L8.19999 36.5C8.69999 37 9.4 37 9.8 36.5L18.6 27.7C19.1 27.2 19.1 26.5 18.6 26.1L16.8 24.3C16.4 23.9 15.6 23.9 15.2 24.3Z"
          fill={`url(#${gradient1Id})`}
        />
        <mask id={maskId} style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="6" y="24" width="13" height="13">
          <path
            d="M15.2 24.3L6.39999 33.1C5.89999 33.6 5.89999 34.3 6.39999 34.7L8.19999 36.5C8.69999 37 9.4 37 9.8 36.5L18.6 27.7C19.1 27.2 19.1 26.5 18.6 26.1L16.8 24.3C16.4 23.9 15.6 23.9 15.2 24.3Z"
            fill={`url(#${gradient2Id})`}
          />
        </mask>
        <g mask={`url(#${maskId})`}>
          <g filter={`url(#${filter1Id})`}>
            <path
              d="M9.8 17.3L18.6 26.1C19.1 26.6 19.1 27.3 18.6 27.7L16.8 29.5C16.3 30 15.6 30 15.2 29.5L6.39999 20.7C5.89999 20.2 5.89999 19.5 6.39999 19.1L8.19999 17.3C8.59999 16.9 9.4 16.9 9.8 17.3Z"
              fill={`url(#${gradient3Id})`}
            />
          </g>
        </g>
        <path
          d="M9.8 17.3L18.6 26.1C19.1 26.6 19.1 27.3 18.6 27.7L16.8 29.5C16.3 30 15.6 30 15.2 29.5L6.39999 20.7C5.89999 20.2 5.89999 19.5 6.39999 19.1L8.19999 17.3C8.59999 16.9 9.4 16.9 9.8 17.3Z"
          fill={`url(#${gradient4Id})`}
        />
      </g>
      <g filter={`url(#${filter2Id})`}>
        <path
          d="M40 32H24C23.4 32 23 32.4 23 33V36C23 36.6 23.4 37 24 37H40C40.6 37 41 36.6 41 36V33C41 32.4 40.6 32 40 32Z"
          fill={`url(#${gradient5Id})`}
        />
      </g>
      <defs>
        <filter
          id={filter0Id}
          x="3.02499"
          y="15"
          width="18.95"
          height="25.875"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset dy="0.5" />
          <feGaussianBlur stdDeviation="0.5" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1.5" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.2 0" />
          <feBlend mode="normal" in2="effect1_dropShadow" result="effect2_dropShadow" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect2_dropShadow" result="shape" />
        </filter>
        <filter
          id={filter1Id}
          x="3.02499"
          y="15"
          width="18.95"
          height="18.875"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset dy="0.5" />
          <feGaussianBlur stdDeviation="0.5" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1.5" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.2 0" />
          <feBlend mode="normal" in2="effect1_dropShadow" result="effect2_dropShadow" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect2_dropShadow" result="shape" />
        </filter>
        <filter
          id={filter2Id}
          x="20"
          y="30"
          width="24"
          height="11"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset dy="0.5" />
          <feGaussianBlur stdDeviation="0.5" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1.5" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.2 0" />
          <feBlend mode="normal" in2="effect1_dropShadow" result="effect2_dropShadow" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect2_dropShadow" result="shape" />
        </filter>
        <linearGradient
          id={gradient0Id}
          x1="36.4462"
          y1="47.8257"
          x2="11.8217"
          y2="5.1748"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#333333" />
          <stop offset="1" stopColor="#4D4D4D" />
        </linearGradient>
        <linearGradient
          id={gradient1Id}
          x1="14.5276"
          y1="33.9959"
          x2="10.4841"
          y2="26.9924"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#999999" />
          <stop offset="1" stopColor="#B3B3B3" />
        </linearGradient>
        <linearGradient
          id={gradient2Id}
          x1="14.5276"
          y1="33.9959"
          x2="10.4841"
          y2="26.9924"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#999999" />
          <stop offset="1" stopColor="#B3B3B3" />
        </linearGradient>
        <linearGradient
          id={gradient3Id}
          x1="16.2747"
          y1="30.0336"
          x2="8.73699"
          y2="16.9781"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#CCCCCC" />
          <stop offset="1" stopColor="#E6E6E6" />
        </linearGradient>
        <linearGradient
          id={gradient4Id}
          x1="16.2747"
          y1="30.0336"
          x2="8.73699"
          y2="16.9781"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#CCCCCC" />
          <stop offset="1" stopColor="#E6E6E6" />
        </linearGradient>
        <linearGradient
          id={gradient5Id}
          x1="35.1496"
          y1="39.9553"
          x2="28.8504"
          y2="29.0447"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#CCCCCC" />
          <stop offset="1" stopColor="#E6E6E6" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// https://zed.dev/brand
export const ZedIcon = (props: SVGProps<SVGSVGElement>) => {
  return (
    <svg width="90" viewBox="0 0 90 90" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.4375 5.625C6.8842 5.625 5.625 6.8842 5.625 8.4375V70.3125H0V8.4375C0 3.7776 3.7776 0 8.4375 0H83.7925C87.551 0 89.4333 4.5442 86.7756 7.20186L40.3642 53.6133H53.4375V47.8125H59.0625V55.0195C59.0625 57.3495 57.1737 59.2383 54.8438 59.2383H34.7392L25.0712 68.9062H68.9062V33.75H74.5312V68.9062C74.5312 72.0128 72.0128 74.5312 68.9062 74.5312H19.4462L9.60248 84.375H81.5625C83.1158 84.375 84.375 83.1158 84.375 81.5625V19.6875H90V81.5625C90 86.2224 86.2224 90 81.5625 90H6.20749C2.44898 90 0.566723 85.4558 3.22438 82.7981L49.46 36.5625H36.5625V42.1875H30.9375V35.1562C30.9375 32.8263 32.8263 30.9375 35.1562 30.9375H55.085L64.9288 21.0938H21.0938V56.25H15.4688V21.0938C15.4688 17.9871 17.9871 15.4688 21.0938 15.4688H70.5538L80.3975 5.625H8.4375Z"
        fill="currentColor"
      />
    </svg>
  )
}

//joplin icon needs to be updated into iconfont
export const JoplinIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="var(--muted-foreground)"
    xmlns="http://www.w3.org/2000/svg"
    {...props}>
    <path d="M20.97 0h-8.9a.15.15 0 00-.16.15v2.83c0 .1.08.17.18.17h1.22c.49 0 .89.38.93.86V17.4l-.01.36-.05.29-.04.13a2.06 2.06 0 01-.38.7l-.02.03a2.08 2.08 0 01-.37.34c-.5.35-1.17.5-1.92.43a4.66 4.66 0 01-2.67-1.22 3.96 3.96 0 01-1.34-2.42c-.1-.78.14-1.47.65-1.93l.07-.05c.37-.31.84-.5 1.39-.55a.09.09 0 00.01 0l.3-.01.35.01h.02a4.39 4.39 0 011.5.44c.15.08.17 0 .18-.06V9.63a.26.26 0 00-.2-.26 7.5 7.5 0 00-6.76 1.61 6.37 6.37 0 00-2.03 5.5 8.18 8.18 0 002.71 5.08A9.35 9.35 0 0011.81 24c1.88 0 3.62-.64 4.9-1.81a6.32 6.32 0 002.06-4.3l.01-10.86V4.08a.95.95 0 01.95-.93h1.22a.17.17 0 00.17-.17V.15a.15.15 0 00-.15-.15z" />
  </svg>
)

export const SiyuanIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 1024 1024"
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
    p-id="2962"
    width="16"
    height="16"
    {...props}>
    <path
      d="M309.76 148.16a84.8 84.8 0 0 0-10.88 11.84S288 170.24 288 171.2s-6.72 4.8-6.72 6.72-3.52 1.92-2.88 2.88a12.48 12.48 0 0 0-6.4 6.4 121.28 121.28 0 0 0-20.8 19.2 456.64 456.64 0 0 1-37.76 37.12v2.88c0 2.88 0 0 0 0s-3.52 1.92-6.72 5.12c-8.64 9.28-19.84 20.48-28.16 28.16l-7.04 7.04-2.56 2.88a114.88 114.88 0 0 0-20.16 21.76 2.88 2.88 0 0 1-8 8.64l-1.6 1.6a99.52 99.52 0 0 0-19.52 18.88 21.44 21.44 0 0 0-6.4 5.44c-14.08 14.4-22.4 23.04-22.72 23.04l-9.28 8.96-8.96 8.96V887.04c0 1.28 3.2 2.56 6.72-1.92s3.52-3.84 4.16-3.84 0-1.6 0 0S163.84 800 219.84 744.64l38.4-38.08c16-16.32 29.12-29.76 28.8-30.4s6.72-4.16 5.76-5.76 5.44-3.2 5.44-5.12 23.68-23.04 23.04-26.56 0-115.52 0-252.16V138.56a128 128 0 0 0-11.84 10.88z m373.76 2.24a96 96 0 0 0-13.44 15.04s-33.92 32-76.48 74.56l-42.56 42.88L512 320v504.96s5.76-5.12 5.12-5.76a29.44 29.44 0 0 0 8.32-7.68c3.84-4.16 9.92-10.24 13.76-13.76l21.44-21.76 21.76-21.44c18.56-18.24 32-32 32-32l8.96-9.6a69.76 69.76 0 0 1 10.56-9.6s3.84-1.92 3.84-3.52 6.4-4.48 5.76-5.12 3.2-2.56 2.56-3.2 1.6 0 0 0 11.52-10.24 24-22.72l22.72-22.4v-256-251.84c0-0.96 0-2.24-15.36 11.84z"
      fill="#cdcdcd"
      p-id="2963"></path>
    <path
      d="M322.24 136h0c-1.6 0 0-0.64 0 0z m2.88 0v504.64l45.12 44.16c37.44 36.8 93.76 92.8 116.48 114.88l14.4 15.04a64 64 0 0 0 10.24 9.6V320l-4.8-4.48c-2.88-2.24-7.68-7.36-11.52-10.88l-42.24-41.92-20.8-21.12-16-14.4a76.48 76.48 0 0 1-7.36-7.04l-23.36-23.68-42.56-44.16c-15.04-15.04-16-16-17.6-14.72z m376 1.92V640l123.84 123.84c98.24 97.92 124.48 123.52 126.4 123.52h2.56V386.56l-124.8-124.8C760 192 704 136.96 704 136.96a3.52 3.52 0 0 0-1.6 2.56z"
      fill="#707070"
      p-id="2964"></path>
    <path
      d="M699.52 136.64V136z m-376.96 249.6V136.96s-0.32 50.56 0 249.28zM512 573.76v-127.04zM667.84 672l-6.72 7.36 7.04-7.04c6.72-6.08 7.68-7.36 6.72-7.36zM184 272.96v1.92l2.56-1.92c2.56-1.92 0-2.24 0-2.24a5.44 5.44 0 0 0-2.56 2.24zM141.76 314.88a2.24 2.24 0 0 0 1.92 0v-1.6z m483.2 399.04a71.36 71.36 0 0 0-8.96 10.24 69.76 69.76 0 0 0 10.56-9.6 56 56 0 0 0 8.96-10.24 73.28 73.28 0 0 0-10.56 9.6z m-448 75.52l-3.2 3.2 3.52-2.88 3.52-3.52s-2.56 0-5.44 3.2z m-97.92 96v1.92l2.88-1.92s1.92-2.24 0-2.24a6.72 6.72 0 0 0-4.48 2.88z"
      p-id="2965"></path>
  </svg>
)
