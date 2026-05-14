import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const SearxngDark: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <g clipPath="url(#searxngdark__a)">
      <mask
        id="searxngdark__b"
        width={86}
        height={86}
        x={17}
        y={17}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M103 17H17V103H103V17Z" />
      </mask>
      <g mask="url(#searxngdark__b)">
        <path
          fill="#3050FF"
          d="M49.7848 17C67.8916 17 82.5696 31.8494 82.5696 50.1672C82.5696 55.9877 81.0872 61.4577 78.4839 66.2128L102.905 89.8764L90.6948 102.774L66.0999 78.9422C61.2954 81.7361 55.7244 83.3343 49.7848 83.3343C31.6783 83.3343 17 68.485 17 50.1672C17 31.8494 31.6783 17 49.7848 17ZM49.7848 26.4763C36.8516 26.4763 26.367 37.0831 26.367 50.1672C26.367 63.2515 36.8516 73.8582 49.7848 73.8582C62.7183 73.8582 73.2028 63.2515 73.2028 50.1672C73.2028 37.0831 62.7183 26.4763 49.7848 26.4763ZM40.8346 32.9125C44.4665 31.0117 48.6034 30.3334 52.6427 30.9764C56.6822 31.6194 60.4132 33.5501 63.2924 36.4873C66.1719 39.4246 68.0492 43.2152 68.6512 47.3069C69.2532 51.3985 68.5488 55.5778 66.6396 59.236L64.5688 58.1302L62.4976 57.024C63.9413 54.2581 64.4742 51.0981 64.0191 48.0044C63.5636 44.9106 62.1439 42.0448 59.967 39.8239C57.7902 37.6031 54.969 36.1432 51.9147 35.657C48.8606 35.1708 45.7327 35.6836 42.9869 37.1207L41.9108 35.0167L40.8346 32.9125Z"
        />
      </g>
    </g>
    <defs>
      <clipPath id="searxngdark__a">
        <path fill="#fff" d="M0 0H86V86H0z" transform="translate(17 17)" />
      </clipPath>
    </defs>
  </svg>
)
export { SearxngDark }
export default SearxngDark
