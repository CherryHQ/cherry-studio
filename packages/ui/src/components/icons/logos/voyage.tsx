import type { SVGProps } from 'react'
const Voyage = (props: SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <g clipPath="url(#voyage__clip0_1010_212037)">
      <path
        d="M19.5 0H4.5C2.01472 0 0 2.01472 0 4.5V19.5C0 21.9853 2.01472 24 4.5 24H19.5C21.9853 24 24 21.9853 24 19.5V4.5C24 2.01472 21.9853 0 19.5 0Z"
        fill="#333333"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.5423 4.71087C5.21065 6.81312 11.4721 19.8057 11.8942 19.8746C12.246 19.9436 17.0652 10.156 19.4923 4.40071C19.5627 4.26285 19.1406 4.125 18.5426 4.125C17.7335 4.125 17.4521 4.29732 17.4521 4.71087C17.4521 5.26228 12.457 17.2899 12.3163 17.1176C12.0349 16.7385 7.2509 5.77923 7.07501 5.0555C6.86395 4.26285 6.65289 4.125 5.5976 4.125C4.57748 4.125 4.40159 4.22839 4.5423 4.71087Z"
        fill="white"
      />
    </g>
    <defs>
      <clipPath id="voyage__clip0_1010_212037">
        <rect width={24} height={24} fill="white" />
      </clipPath>
    </defs>
  </svg>
)
export { Voyage }
export default Voyage
