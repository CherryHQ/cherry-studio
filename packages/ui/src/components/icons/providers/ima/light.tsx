import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const ImaLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
      <mask
        id={`${iconId}-imalight__a`}
        width={65}
        height={65}
        x={27}
        y={27}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path
          fill="#fff"
          d="M77.7813 27H41.2188C33.3659 27 27 33.3659 27 41.2188V77.7813C27 85.6341 33.3659 92 41.2188 92H77.7813C85.6341 92 92 85.6341 92 77.7813V41.2188C92 33.3659 85.6341 27 77.7813 27Z"
        />
      </mask>
      <g mask={`url(#${iconId}-imalight__a)`}>
        <path
          fill="#fff"
          d="M77.7813 27H41.2188C33.3659 27 27 33.3659 27 41.2188V77.7813C27 85.6341 33.3659 92 41.2188 92H77.7813C85.6341 92 92 85.6341 92 77.7813V41.2188C92 33.3659 85.6341 27 77.7813 27Z"
        />
        <g filter={`url(#${iconId}-imalight__b)`}>
          <path
            fill="#4DEE9E"
            d="M43.4405 110.916C58.1294 110.916 70.0372 99.0087 70.0372 84.3193C70.0372 69.6304 58.1294 57.7226 43.4405 57.7226C28.7515 57.7226 16.8438 69.6304 16.8438 84.3193C16.8438 99.0087 28.7515 110.916 43.4405 110.916Z"
          />
        </g>
        <g filter={`url(#${iconId}-imalight__c)`}>
          <path
            fill="#F6F7FA"
            d="M27.5713 84.3828C45.3453 84.3828 59.7539 69.9742 59.7539 52.2002C59.7539 34.4263 45.3453 20.0176 27.5713 20.0176C9.79732 20.0176 -4.61133 34.4263 -4.61133 52.2002C-4.61133 69.9742 9.79732 84.3828 27.5713 84.3828Z"
          />
        </g>
        <g filter={`url(#${iconId}-imalight__d)`}>
          <path
            fill="#D6E807"
            d="M70.0371 135.418C86.4439 135.418 99.7441 122.118 99.7441 105.711C99.7441 89.3042 86.4439 76.0039 70.0371 76.0039C53.6304 76.0039 40.3301 89.3042 40.3301 105.711C40.3301 122.118 53.6304 135.418 70.0371 135.418Z"
          />
        </g>
        <path
          fill="#000"
          d="M88.3388 44.9199C91.093 42.5843 90.5473 37.3608 87.1338 33.2417 83.7205 29.1226 78.7179 27.6882 75.9778 30.0251 73.2372 32.362 73.769 37.5842 77.1823 41.7033 80.5956 45.8225 85.5828 47.2619 88.3388 44.9199ZM30.6606 44.9199C27.9074 42.5843 28.4521 37.3608 31.867 33.2417 35.2818 29.1226 40.2803 27.6882 43.022 30.0251 45.7638 32.362 45.2304 37.5842 41.8155 41.7033 38.4007 45.8225 33.415 47.2619 30.6606 44.9199ZM39.6737 68.3477C36.9213 66.0105 37.466 60.7864 40.8797 56.668 44.2935 52.5497 49.2904 51.11 52.0313 53.4459 54.7722 55.7819 54.239 61.006 50.8265 65.1257 47.414 69.2452 42.4273 70.6837 39.6737 68.3477ZM68.1691 65.1256C64.7566 61.0047 64.212 55.7807 66.9643 53.4459 69.7169 51.1113 74.7084 52.5471 78.1161 56.668 81.5233 60.7889 82.0741 66.0117 79.3219 68.3477 76.5695 70.6836 71.5702 69.2326 68.1691 65.1256ZM59.4963 69.6128C61.883 69.6128 63.8128 68.4168 63.8128 66.9466 63.8128 65.4765 61.883 64.2806 59.4963 64.2806 57.1096 64.2806 55.1799 65.4765 55.1799 66.9466 55.1799 68.4168 57.1096 69.6128 59.4963 69.6128Z"
        />
      </g>
      <path
        stroke="#fff"
        strokeOpacity={0.08}
        strokeWidth={2.688}
        d="M77.7812 28.0157H41.2187C33.9268 28.0157 28.0156 33.9269 28.0156 41.2187V77.7812C28.0156 85.0731 33.9268 90.9842 41.2187 90.9842H77.7812C85.0731 90.9842 90.9841 85.0731 90.9841 77.7812V41.2187C90.9841 33.9269 85.0731 28.0157 77.7812 28.0157Z"
      />
      <defs>
        <filter
          id={`${iconId}-imalight__b`}
          width={120.381}
          height={120.381}
          x={-16.75}
          y={24.129}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5621" stdDeviation={16.797} />
        </filter>
        <filter
          id={`${iconId}-imalight__c`}
          width={97.959}
          height={97.959}
          x={-21.408}
          y={3.221}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5621" stdDeviation={8.398} />
        </filter>
        <filter
          id={`${iconId}-imalight__d`}
          width={126.602}
          height={126.601}
          x={6.736}
          y={42.41}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5621" stdDeviation={16.797} />
        </filter>
      </defs>
    </svg>
  )
}
export { ImaLight }
export default ImaLight
