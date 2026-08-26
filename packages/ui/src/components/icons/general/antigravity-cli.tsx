import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../types'

const AntigravityCli: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <title>Antigravity</title>
      <mask id={`${iconId}-mask`} x="0" y="1" width="24" height="23" maskUnits="userSpaceOnUse">
        <path
          fill="#fff"
          d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"
        />
      </mask>
      <g mask={`url(#${iconId}-mask)`}>
        <g filter={`url(#${iconId}-filter-1)`}>
          <path
            fill="#FFE432"
            d="M-1.018-3.992c-.408 3.591 2.686 6.89 6.91 7.37 4.225.48 7.98-2.043 8.387-5.633.408-3.59-2.686-6.89-6.91-7.37-4.225-.479-7.98 2.043-8.387 5.633z"
          />
        </g>
        <g filter={`url(#${iconId}-filter-2)`}>
          <path
            fill="#FC413D"
            d="M15.269 7.747c1.058 4.557 5.691 7.374 10.348 6.293 4.657-1.082 7.575-5.653 6.516-10.21-1.058-4.556-5.691-7.374-10.348-6.292-4.657 1.082-7.575 5.653-6.516 10.21z"
          />
        </g>
        <g filter={`url(#${iconId}-filter-3)`}>
          <path
            fill="#00B95C"
            d="M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z"
          />
        </g>
        <g filter={`url(#${iconId}-filter-4)`}>
          <path
            fill="#00B95C"
            d="M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z"
          />
        </g>
        <g filter={`url(#${iconId}-filter-5)`}>
          <path
            fill="#00B95C"
            d="M-7.608 14.703c3.352 3.424 9.126 3.208 12.896-.483 3.77-3.69 4.108-9.459.756-12.883C2.69-2.087-3.083-1.871-6.853 1.82c-3.77 3.69-4.108 9.458-.755 12.883z"
          />
        </g>
        <g filter={`url(#${iconId}-filter-6)`}>
          <path
            fill="#3186FF"
            d="M9.932 27.617c1.04 4.482 5.384 7.303 9.7 6.3 4.316-1.002 6.971-5.448 5.93-9.93-1.04-4.483-5.384-7.304-9.7-6.301-4.316 1.002-6.971 5.448-5.93 9.93z"
          />
        </g>
        <g filter={`url(#${iconId}-filter-7)`}>
          <path
            fill="#FBBC04"
            d="M2.572-8.185C.392-3.329 2.778 2.472 7.9 4.771c5.122 2.3 11.042.227 13.222-4.63 2.18-4.855-.205-10.656-5.327-12.955-5.122-2.3-11.042-.227-13.222 4.63z"
          />
        </g>
        <g filter={`url(#${iconId}-filter-8)`}>
          <path
            fill="#3186FF"
            d="M-3.267 38.686c-5.277-2.072 3.742-19.117 5.984-24.83 2.243-5.712 8.34-8.664 13.616-6.592 5.278 2.071 11.533 13.482 9.29 19.195-2.242 5.713-23.613 14.298-28.89 12.227z"
          />
        </g>
        <g filter={`url(#${iconId}-filter-9)`}>
          <path
            fill="#749BFF"
            d="M28.71 17.471c-1.413 1.649-5.1.808-8.236-1.878-3.135-2.687-4.531-6.201-3.118-7.85 1.412-1.649 5.1-.808 8.235 1.878s4.532 6.2 3.119 7.85z"
          />
        </g>
        <g filter={`url(#${iconId}-filter-10)`}>
          <path
            fill="#FC413D"
            d="M18.163 9.077c5.81 3.93 12.502 4.19 14.946.577 2.443-3.612-.287-9.727-6.098-13.658-5.81-3.931-12.502-4.19-14.946-.577-2.443 3.612.287 9.727 6.098 13.658z"
          />
        </g>
        <g filter={`url(#${iconId}-filter-11)`}>
          <path
            fill="#FFEE48"
            d="M-.915 2.684c-1.44 3.473-.97 6.967 1.05 7.804 2.02.837 4.824-1.3 6.264-4.772 1.44-3.473.97-6.967-1.05-7.804-2.02-.837-4.824 1.3-6.264 4.772z"
          />
        </g>
      </g>
      <defs>
        <filter
          id={`${iconId}-filter-1`}
          x="-3.288"
          y="-11.917"
          width="19.838"
          height="17.587"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="1.117" />
        </filter>
        <filter
          id={`${iconId}-filter-2`}
          x="4.251"
          y="-13.493"
          width="38.9"
          height="38.565"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="5.4" />
        </filter>
        <filter
          id={`${iconId}-filter-3`}
          x="-21.889"
          y="-10.592"
          width="40.955"
          height="36.517"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.591" />
        </filter>
        <filter
          id={`${iconId}-filter-4`}
          x="-21.889"
          y="-10.592"
          width="40.955"
          height="36.517"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.591" />
        </filter>
        <filter
          id={`${iconId}-filter-5`}
          x="-19.099"
          y="-10.278"
          width="36.632"
          height="36.595"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.591" />
        </filter>
        <filter
          id={`${iconId}-filter-6`}
          x=".981"
          y="8.758"
          width="33.533"
          height="34.087"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.363" />
        </filter>
        <filter
          id={`${iconId}-filter-7`}
          x="-6.143"
          y="-21.659"
          width="35.978"
          height="35.276"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.954" />
        </filter>
        <filter
          id={`${iconId}-filter-8`}
          x="-11.96"
          y="-.46"
          width="45.114"
          height="46.523"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.531" />
        </filter>
        <filter
          id={`${iconId}-filter-9`}
          x="10.485"
          y=".58"
          width="25.094"
          height="24.054"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.159" />
        </filter>
        <filter
          id={`${iconId}-filter-10`}
          x="5.833"
          y="-12.467"
          width="33.508"
          height="30.007"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="2.669" />
        </filter>
        <filter
          id={`${iconId}-filter-11`}
          x="-8.355"
          y="-8.876"
          width="22.194"
          height="26.151"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.303" />
        </filter>
      </defs>
    </svg>
  )
}

export { AntigravityCli }
export default AntigravityCli
