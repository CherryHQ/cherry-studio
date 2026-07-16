import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const GoogleLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="9 9 102 102" {...props}>
      <mask
        id={`${iconId}-googlelight__a`}
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
      <g mask={`url(#${iconId}-googlelight__a)`}>
        <mask
          id={`${iconId}-googlelight__b`}
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
            d="M90.709 53.4702H60.1783V65.9654H77.7216C77.4394 67.7338 76.8063 69.4735 75.879 71.0596C74.8164 72.8771 73.503 74.2607 72.1567 75.3143C68.1237 78.4705 63.4223 79.1159 60.157 79.1159C51.9083 79.1159 44.8608 73.6709 42.1323 66.2722C42.0222 66.0036 41.9492 65.7262 41.8601 65.4522C41.243 63.5325 40.9283 61.5236 40.9278 59.5017C40.9278 57.3444 41.2845 55.2795 41.9349 53.3292C44.5005 45.6369 51.7071 39.8918 60.1629 39.8918C61.8636 39.8918 63.5014 40.0985 65.0546 40.511C67.8926 41.2628 70.504 42.7293 72.6535 44.7783L81.9367 35.4926C76.2898 30.2043 68.9284 27 60.1474 27C53.1276 27 46.6466 29.2337 41.3354 33.0093C37.0285 36.0708 33.496 40.1703 31.1119 44.931C28.8946 49.3454 27.6804 54.2373 27.6804 59.4971C27.6804 64.757 28.8967 69.6996 31.1139 74.0732V74.1026C33.456 78.7457 36.8811 82.7434 41.0437 85.7911C44.6805 88.4535 51.2013 91.9992 60.1474 91.9992C65.2921 91.9992 69.8519 91.0522 73.8731 89.2768C76.774 87.9959 79.3441 86.3254 81.6712 84.1785C84.7459 81.3417 87.1539 77.8326 88.7976 73.7955C90.4414 69.7585 91.3204 65.1931 91.3204 60.2436C91.3204 57.9386 91.0937 55.5975 90.709 53.4702Z"
          />
        </mask>
        <g mask={`url(#${iconId}-googlelight__b)`}>
          <g filter={`url(#${iconId}-googlelight__c)`}>
            <path
              fill={`url(#${iconId}-googlelight__d)`}
              d="M27.2124 59.7177C27.2461 64.8947 28.6904 70.236 30.8765 74.5479V74.5776C32.4563 77.7091 34.6151 80.1825 37.0738 82.6335L51.9253 77.0988C49.1154 75.6409 48.6866 74.7477 46.6726 73.1176C44.6143 70.9978 43.0802 68.5643 42.1248 65.7107H42.0862L42.1248 65.681C41.4963 63.7969 41.4344 61.7965 41.411 59.7177H27.2124Z"
            />
          </g>
          <g filter={`url(#${iconId}-googlelight__e)`}>
            <path
              fill={`url(#${iconId}-googlelight__f)`}
              d="M60.1781 26.7637C58.7104 32.0309 59.2715 37.1506 60.1781 40.1295C61.8734 40.1309 63.5064 40.3372 65.0546 40.7484C67.8926 41.5002 70.5039 42.9668 72.6532 45.0158L82.1743 35.4929C76.5339 30.2108 69.7462 26.7719 60.1781 26.7637Z"
            />
          </g>
          <g filter={`url(#${iconId}-googlelight__g)`}>
            <path
              fill={`url(#${iconId}-googlelight__h)`}
              d="M60.1465 26.722C52.9466 26.722 46.2991 29.013 40.8518 32.8855C38.8355 34.3182 36.9802 35.9768 35.3202 37.8309C34.8873 41.9799 38.5613 47.079 45.8374 47.0367C49.3675 42.8428 54.5889 40.1289 60.4 40.1289L60.4158 40.1294L60.1785 26.7229C60.1676 26.7229 60.1571 26.722 60.1465 26.722Z"
            />
          </g>
          <g filter={`url(#${iconId}-googlelight__i)`}>
            <path
              fill={`url(#${iconId}-googlelight__j)`}
              d="M83.9111 61.219L77.4847 65.7283C77.2027 67.4965 76.5689 69.2362 75.6416 70.8225C74.579 72.6398 73.2659 74.0235 71.9194 75.0772C67.895 78.2268 63.2058 78.8755 59.9415 78.878C56.5672 84.7475 55.9757 87.6875 60.1786 92.4248C65.3794 92.421 69.9899 91.4619 74.0568 89.6664C76.9966 88.3683 79.6012 86.6752 81.9594 84.4995C85.0753 81.6246 87.516 78.0685 89.1818 73.9772C90.8474 69.886 91.7385 65.2597 91.7385 60.2437L83.9111 61.219Z"
            />
          </g>
          <g filter={`url(#${iconId}-googlelight__k)`}>
            <path
              fill="#3086FF"
              d="M59.7043 52.9957V66.4402H90.6243C90.8957 64.5991 91.7951 62.2164 91.7951 60.2438C91.7951 57.9388 91.5691 55.1233 91.1844 52.9957H59.7043Z"
            />
          </g>
          <g filter={`url(#${iconId}-googlelight__l)`}>
            <path
              fill={`url(#${iconId}-googlelight__m)`}
              d="M35.4688 37.3566C33.5605 39.4889 31.9305 41.8756 30.6381 44.4566C28.4208 48.871 27.2065 54.2376 27.2065 59.4973C27.2065 59.5714 27.2125 59.6438 27.2132 59.718C28.1953 61.641 40.7777 61.2727 41.412 59.718C41.4111 59.6455 41.4031 59.5747 41.4031 59.502C41.4031 57.3447 41.76 55.7547 42.4102 53.8043C43.2127 51.3984 44.469 49.1832 46.0757 47.2744C46.4398 46.7995 47.4113 45.7787 47.6945 45.1662C47.8025 44.9331 47.4986 44.8022 47.4815 44.7201C47.4627 44.6282 47.055 44.7021 46.9638 44.6336C46.674 44.4164 46.0999 44.3029 45.7512 44.2022C45.0062 43.9869 43.7716 43.5117 43.0857 43.019C40.9178 41.4622 37.5349 39.6023 35.4688 37.3566Z"
            />
          </g>
          <g filter={`url(#${iconId}-googlelight__n)`}>
            <path
              fill={`url(#${iconId}-googlelight__o)`}
              d="M43.1319 44.729C48.1589 47.8392 49.6045 43.1591 52.9469 41.6946L47.1329 29.3804C45.0118 30.291 42.9894 31.4276 41.0986 32.7718C38.2987 34.7621 35.8261 37.1911 33.7837 39.955L43.1319 44.729Z"
            />
          </g>
          <g filter={`url(#${iconId}-googlelight__p)`}>
            <path
              fill={`url(#${iconId}-googlelight__q)`}
              d="M45.1774 76.1473C38.4293 78.6355 37.3728 78.7248 36.7517 82.996C37.9423 84.1834 39.2185 85.2764 40.5693 86.2659C44.2058 88.9283 51.2011 92.4746 60.1474 92.4746C60.1578 92.4746 60.1679 92.4731 60.1785 92.4731V78.6408L60.1572 78.6413C56.8071 78.6413 54.1299 77.7427 51.3852 76.1798C50.7084 75.7944 49.4805 76.8291 48.8565 76.3667C47.9958 75.7285 45.9238 76.9161 45.1774 76.1473Z"
            />
          </g>
          <g filter={`url(#${iconId}-googlelight__r)`} opacity={0.5}>
            <path
              fill={`url(#${iconId}-googlelight__s)`}
              d="M56.2271 78.2053V92.2343C57.4788 92.384 58.7815 92.4747 60.148 92.4747C61.518 92.4747 62.8431 92.4029 64.1311 92.2706V78.2997C62.8182 78.5272 61.4892 78.6415 60.1578 78.6414C58.8092 78.6414 57.4979 78.481 56.2271 78.2053Z"
            />
          </g>
        </g>
      </g>
      <defs>
        <filter
          id={`${iconId}-googlelight__c`}
          width={25.008}
          height={23.211}
          x={27.065}
          y={59.57}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5531" stdDeviation={0.074} />
        </filter>
        <filter
          id={`${iconId}-googlelight__e`}
          width={23.194}
          height={18.547}
          x={59.128}
          y={26.616}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5531" stdDeviation={0.074} />
        </filter>
        <filter
          id={`${iconId}-googlelight__g`}
          width={25.425}
          height={20.61}
          x={35.138}
          y={26.574}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5531" stdDeviation={0.074} />
        </filter>
        <filter
          id={`${iconId}-googlelight__i`}
          width={34.817}
          height={32.476}
          x={57.069}
          y={60.096}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5531" stdDeviation={0.074} />
        </filter>
        <filter
          id={`${iconId}-googlelight__k`}
          width={32.386}
          height={13.74}
          x={59.557}
          y={52.848}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5531" stdDeviation={0.074} />
        </filter>
        <filter
          id={`${iconId}-googlelight__l`}
          width={20.806}
          height={23.964}
          x={27.059}
          y={37.209}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5531" stdDeviation={0.074} />
        </filter>
        <filter
          id={`${iconId}-googlelight__n`}
          width={21.239}
          height={18.47}
          x={32.746}
          y={28.343}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5531" stdDeviation={0.519} />
        </filter>
        <filter
          id={`${iconId}-googlelight__p`}
          width={23.722}
          height={16.678}
          x={36.604}
          y={75.944}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5531" stdDeviation={0.074} />
        </filter>
        <filter
          id={`${iconId}-googlelight__r`}
          width={8.199}
          height={14.565}
          x={56.079}
          y={78.058}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse">
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur result="effect1_foregroundBlur_1_5531" stdDeviation={0.074} />
        </filter>
        <radialGradient
          id={`${iconId}-googlelight__d`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="matrix(-1.32239 -32.3695 47.54714 -1.94244 51.628 82.145)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.142} stopColor="#1ABD4D" />
          <stop offset={0.248} stopColor="#6EC30D" />
          <stop offset={0.312} stopColor="#8AC502" />
          <stop offset={0.366} stopColor="#A2C600" />
          <stop offset={0.446} stopColor="#C8C903" />
          <stop offset={0.54} stopColor="#EBCB03" />
          <stop offset={0.616} stopColor="#F7CD07" />
          <stop offset={0.699} stopColor="#FDCD04" />
          <stop offset={0.771} stopColor="#FDCE05" />
          <stop offset={0.861} stopColor="#FFCE0A" />
        </radialGradient>
        <radialGradient
          id={`${iconId}-googlelight__f`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="matrix(22.4584 0 0 29.0038 81.283 44.327)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.408} stopColor="#FB4E5A" />
          <stop offset={1} stopColor="#FF4540" />
        </radialGradient>
        <radialGradient
          id={`${iconId}-googlelight__h`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="matrix(-31.4661 17.4278 23.6495 42.6993 69.019 22.523)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.231} stopColor="#FF4541" />
          <stop offset={0.312} stopColor="#FF4540" />
          <stop offset={0.458} stopColor="#FF4640" />
          <stop offset={0.54} stopColor="#FF473F" />
          <stop offset={0.699} stopColor="#FF5138" />
          <stop offset={0.771} stopColor="#FF5B33" />
          <stop offset={0.861} stopColor="#FF6C29" />
          <stop offset={1} stopColor="#FF8C18" />
        </radialGradient>
        <radialGradient
          id={`${iconId}-googlelight__j`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="matrix(-57.0649 -74.4915 -27.4968 21.0641 60.646 88.218)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.132} stopColor="#0CBA65" />
          <stop offset={0.21} stopColor="#0BB86D" />
          <stop offset={0.297} stopColor="#09B479" />
          <stop offset={0.396} stopColor="#08AD93" />
          <stop offset={0.477} stopColor="#0AA6A9" />
          <stop offset={0.568} stopColor="#0D9CC6" />
          <stop offset={0.667} stopColor="#1893DD" />
          <stop offset={0.769} stopColor="#258BF1" />
          <stop offset={0.859} stopColor="#3086FF" />
        </radialGradient>
        <radialGradient
          id={`${iconId}-googlelight__m`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="matrix(-4.03836 34.80782 -48.12797 -5.58375 57.39 32.861)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.366} stopColor="#FF4E3A" />
          <stop offset={0.458} stopColor="#FF8A1B" />
          <stop offset={0.54} stopColor="#FFA312" />
          <stop offset={0.616} stopColor="#FFB60C" />
          <stop offset={0.771} stopColor="#FFCD0A" />
          <stop offset={0.861} stopColor="#FECF0A" />
          <stop offset={0.915} stopColor="#FECF08" />
          <stop offset={1} stopColor="#FDCD01" />
        </radialGradient>
        <radialGradient
          id={`${iconId}-googlelight__o`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="matrix(-11.67265 12.90977 -36.41283 -32.92345 51.712 32.5)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.316} stopColor="#FF4C3C" />
          <stop offset={0.604} stopColor="#FF692C" />
          <stop offset={0.727} stopColor="#FF7825" />
          <stop offset={0.885} stopColor="#FF8D1B" />
          <stop offset={1} stopColor="#FF9F13" />
        </radialGradient>
        <radialGradient
          id={`${iconId}-googlelight__q`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="matrix(-31.4661 -17.4278 23.6495 -42.6992 69.019 96.475)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.231} stopColor="#0FBC5F" />
          <stop offset={0.312} stopColor="#0FBC5F" />
          <stop offset={0.366} stopColor="#0FBC5E" />
          <stop offset={0.458} stopColor="#0FBC5D" />
          <stop offset={0.54} stopColor="#12BC58" />
          <stop offset={0.699} stopColor="#28BF3C" />
          <stop offset={0.771} stopColor="#38C02B" />
          <stop offset={0.861} stopColor="#52C218" />
          <stop offset={0.915} stopColor="#67C30F" />
          <stop offset={1} stopColor="#86C504" />
        </radialGradient>
        <linearGradient
          id={`${iconId}-googlelight__s`}
          x1={56.227}
          x2={64.131}
          y1={85.34}
          y2={85.34}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#0FBC5C" />
          <stop offset={1} stopColor="#0CBA65" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { GoogleLight }
export default GoogleLight
