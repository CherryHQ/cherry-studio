import { cn } from '@cherrystudio/ui/utils'
import { cva } from 'class-variance-authority'
import { Loader2Icon } from 'lucide-react'
import { type ReactNode, type SVGProps, useCallback, useMemo } from 'react'
import { toast as sonnerToast, Toaster as Sonner, type ToasterProps } from 'sonner'

const InfoIcon = ({ className }: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <foreignObject x="0" y="0">
      <div
        // xmlns="http://www.w3.org/1999/xhtml"
        style={{
          backdropFilter: 'blur(2px)',
          clipPath: 'url(#bgblur_0_1669_13486_clip_path)'
        }}></div>
    </foreignObject>
    <g filter="url(#filter0_dd_1669_13486)" data-figma-bg-blur-radius="4">
      <path
        d="M13.5714 23.0477H15.4762C15.4762 23.3002 15.3758 23.5425 15.1973 23.721C15.0186 23.8997 14.7764 24 14.5238 24C14.2712 24 14.0289 23.8997 13.8504 23.721C13.6718 23.5425 13.5714 23.3002 13.5714 23.0477ZM22.1429 16.9809V12.7429C22.1429 9.25714 19.2286 6.39047 15.4762 5.9619V4.95238C15.4762 4.69978 15.3758 4.45754 15.1973 4.27894C15.0186 4.10034 14.7764 4 14.5238 4C14.2712 4 14.0289 4.10034 13.8504 4.27894C13.6718 4.45754 13.5714 4.69978 13.5714 4.95238V5.9619C9.81905 6.39047 6.90477 9.25714 6.90477 12.7429V16.9809C6.3657 17.1414 5.89119 17.4682 5.54907 17.9147C5.20696 18.3613 5.01479 18.9043 5 19.4666C5.03217 20.1934 5.35079 20.8779 5.88617 21.3705C6.42157 21.8631 7.1302 22.1237 7.85714 22.0952H21.1905C21.9174 22.1237 22.6261 21.8631 23.1614 21.3705C23.6968 20.8779 24.0154 20.1934 24.0477 19.4666C24.0328 18.9043 23.8407 18.3613 23.4985 17.9147C23.1565 17.4682 22.682 17.1414 22.1429 16.9809Z"
        fill="url(#paint0_linear_1669_13486)"
      />
    </g>
    <defs>
      <filter
        id="filter0_dd_1669_13486"
        x="0"
        y="0"
        width="29.0476"
        height="30"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB">
        <feFlood flood-opacity="0" result="BackgroundImageFix" />
        <feColorMatrix
          in="SourceAlpha"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"
        />
        <feOffset dy="1" />
        <feGaussianBlur stdDeviation="1.5" />
        <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0" />
        <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1669_13486" />
        <feColorMatrix
          in="SourceAlpha"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"
        />
        <feMorphology radius="2" operator="dilate" in="SourceAlpha" result="effect2_dropShadow_1669_13486" />
        <feOffset dy="1" />
        <feGaussianBlur stdDeviation="1.5" />
        <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0" />
        <feBlend mode="normal" in2="effect1_dropShadow_1669_13486" result="effect2_dropShadow_1669_13486" />
        <feBlend mode="normal" in="SourceGraphic" in2="effect2_dropShadow_1669_13486" result="shape" />
      </filter>
      <clipPath id="bgblur_0_1669_13486_clip_path" transform="translate(0 0)">
        <path d="M13.5714 23.0477H15.4762C15.4762 23.3002 15.3758 23.5425 15.1973 23.721C15.0186 23.8997 14.7764 24 14.5238 24C14.2712 24 14.0289 23.8997 13.8504 23.721C13.6718 23.5425 13.5714 23.3002 13.5714 23.0477ZM22.1429 16.9809V12.7429C22.1429 9.25714 19.2286 6.39047 15.4762 5.9619V4.95238C15.4762 4.69978 15.3758 4.45754 15.1973 4.27894C15.0186 4.10034 14.7764 4 14.5238 4C14.2712 4 14.0289 4.10034 13.8504 4.27894C13.6718 4.45754 13.5714 4.69978 13.5714 4.95238V5.9619C9.81905 6.39047 6.90477 9.25714 6.90477 12.7429V16.9809C6.3657 17.1414 5.89119 17.4682 5.54907 17.9147C5.20696 18.3613 5.01479 18.9043 5 19.4666C5.03217 20.1934 5.35079 20.8779 5.88617 21.3705C6.42157 21.8631 7.1302 22.1237 7.85714 22.0952H21.1905C21.9174 22.1237 22.6261 21.8631 23.1614 21.3705C23.6968 20.8779 24.0154 20.1934 24.0477 19.4666C24.0328 18.9043 23.8407 18.3613 23.4985 17.9147C23.1565 17.4682 22.682 17.1414 22.1429 16.9809Z" />
      </clipPath>
      <linearGradient
        id="paint0_linear_1669_13486"
        x1="14.5238"
        y1="4"
        x2="14.5239"
        y2="39.5"
        gradientUnits="userSpaceOnUse">
        <stop stop-color="#3B82F6" />
        <stop offset="1" stop-color="white" />
      </linearGradient>
    </defs>
  </svg>
)

const WarningIcon = ({ className }: SVGProps<SVGSVGElement>) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <g filter="url(#filter0_dd_1669_13487)">
      <path
        d="M15.728 22H8.272C8.00681 21.9999 7.75249 21.8946 7.565 21.707L2.293 16.435C2.10545 16.2475 2.00006 15.9932 2 15.728V8.272C2.00006 8.00681 2.10545 7.75249 2.293 7.565L7.565 2.293C7.75249 2.10545 8.00681 2.00006 8.272 2H15.728C15.9932 2.00006 16.2475 2.10545 16.435 2.293L21.707 7.565C21.8946 7.75249 21.9999 8.00681 22 8.272V15.728C21.9999 15.9932 21.8946 16.2475 21.707 16.435L16.435 21.707C16.2475 21.8946 15.9932 21.9999 15.728 22Z"
        fill="url(#paint0_linear_1669_13487)"
      />
      <path
        d="M12 17C12.5523 17 13 16.5523 13 16C13 15.4477 12.5523 15 12 15C11.4477 15 11 15.4477 11 16C11 16.5523 11.4477 17 12 17Z"
        fill="#FAFAFA"
      />
      <path
        d="M12 13C11.7348 13 11.4804 12.8946 11.2929 12.7071C11.1054 12.5196 11 12.2652 11 12V8C11 7.73478 11.1054 7.48043 11.2929 7.29289C11.4804 7.10536 11.7348 7 12 7C12.2652 7 12.5196 7.10536 12.7071 7.29289C12.8946 7.48043 13 7.73478 13 8V12C13 12.2652 12.8946 12.5196 12.7071 12.7071C12.5196 12.8946 12.2652 13 12 13Z"
        fill="#FAFAFA"
      />
    </g>
    <defs>
      <filter
        id="filter0_dd_1669_13487"
        x="-3"
        y="-2"
        width="30"
        height="30"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB">
        <feFlood flood-opacity="0" result="BackgroundImageFix" />
        <feColorMatrix
          in="SourceAlpha"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"
        />
        <feOffset dy="1" />
        <feGaussianBlur stdDeviation="1.5" />
        <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0" />
        <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1669_13487" />
        <feColorMatrix
          in="SourceAlpha"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"
        />
        <feMorphology radius="2" operator="dilate" in="SourceAlpha" result="effect2_dropShadow_1669_13487" />
        <feOffset dy="1" />
        <feGaussianBlur stdDeviation="1.5" />
        <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0" />
        <feBlend mode="normal" in2="effect1_dropShadow_1669_13487" result="effect2_dropShadow_1669_13487" />
        <feBlend mode="normal" in="SourceGraphic" in2="effect2_dropShadow_1669_13487" result="shape" />
      </filter>
      <linearGradient id="paint0_linear_1669_13487" x1="12" y1="12" x2="12" y2="30.5" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F59E0B" />
        <stop offset="1" stop-color="white" />
      </linearGradient>
    </defs>
  </svg>
)

const SuccessIcon = ({ className }: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <mask id="mask0_1669_13491" style={{ maskType: 'luminance' }} maskUnits="userSpaceOnUse" x="0" y="0">
      <path d="M24 0H0V24H24V0Z" fill="white" />
    </mask>
    <g mask="url(#mask0_1669_13491)">
      <foreignObject x="-3" y="-2">
        <div
          // xmlns="http://www.w3.org/1999/xhtml"
          style={{
            backdropFilter: 'blur(2px)',
            clipPath: 'url(#bgblur_0_1669_13491_clip_path)',
            height: '100%',
            width: '100%'
          }}></div>
      </foreignObject>
      <g filter="url(#filter0_dd_1669_13491)" data-figma-bg-blur-radius="4">
        <path
          d="M13.2121 2.57414C12.5853 1.80862 11.4146 1.80862 10.788 2.57414L9.90009 3.65856C9.83924 3.73288 9.73773 3.76009 9.64787 3.72614L8.33677 3.23092C7.41123 2.88134 6.39741 3.46667 6.23738 4.44301L6.0107 5.82606C5.99517 5.92086 5.92086 5.99516 5.82606 6.0107L4.44301 6.23738C3.46668 6.39741 2.88134 7.41122 3.23092 8.33676L3.72614 9.64787C3.76009 9.73773 3.73288 9.83924 3.65856 9.90009L2.57414 10.7879C1.80862 11.4147 1.80862 12.5854 2.57414 13.2121L3.65856 14.0999C3.73288 14.1608 3.76009 14.2623 3.72614 14.3522L3.23092 15.6633C2.88135 16.5888 3.46667 17.6026 4.44301 17.7627L5.82606 17.9893C5.92086 18.0049 5.99517 18.0792 6.0107 18.174L6.23738 19.557C6.39741 20.5333 7.41122 21.1186 8.33677 20.7691L9.64787 20.2739C9.73773 20.24 9.83924 20.2671 9.90009 20.3415L10.788 21.4259C11.4146 22.1914 12.5853 22.1914 13.2121 21.4259L14.0999 20.3415C14.1608 20.2671 14.2623 20.24 14.3521 20.2739L15.6633 20.7691C16.5888 21.1186 17.6027 20.5333 17.7626 19.557L17.9894 18.174C18.0049 18.0792 18.0791 18.0049 18.1739 17.9893L19.557 17.7627C20.5334 17.6026 21.1187 16.5888 20.7691 15.6633L20.2739 14.3522C20.2399 14.2623 20.2671 14.1608 20.3414 14.0999L21.4259 13.2121C22.1914 12.5854 22.1914 11.4147 21.4259 10.7879L20.3414 9.90009C20.2671 9.83924 20.2399 9.73773 20.2739 9.64787L20.7691 8.33676C21.1187 7.41122 20.5334 6.39741 19.557 6.23738L18.1739 6.0107C18.0791 5.99516 18.0049 5.92086 17.9894 5.82606L17.7626 4.44301C17.6027 3.46668 16.5888 2.88134 15.6633 3.23092L14.3521 3.72614C14.2623 3.76009 14.1608 3.73288 14.0999 3.65856L13.2121 2.57414Z"
          fill="url(#paint0_linear_1669_13491)"
        />
      </g>
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M17.3974 8.39243C17.6596 8.65461 17.6596 9.0797 17.3974 9.34187L11.1314 15.6078C11.0055 15.7338 10.8347 15.8045 10.6567 15.8045C10.4787 15.8045 10.3079 15.7338 10.182 15.6078L6.60142 12.0273C6.33924 11.7651 6.33924 11.3401 6.60142 11.0779C6.8636 10.8157 7.28868 10.8157 7.55086 11.0779L10.6567 14.1837L16.448 8.39243C16.7102 8.13026 17.1352 8.13026 17.3974 8.39243Z"
        fill="#FAFAFA"
      />
    </g>
    <defs>
      <filter
        id="filter0_dd_1669_13491"
        x="-3"
        y="-2"
        width="30"
        height="30"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB">
        <feFlood flood-opacity="0" result="BackgroundImageFix" />
        <feColorMatrix
          in="SourceAlpha"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"
        />
        <feOffset dy="1" />
        <feGaussianBlur stdDeviation="1.5" />
        <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0" />
        <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1669_13491" />
        <feColorMatrix
          in="SourceAlpha"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"
        />
        <feMorphology radius="2" operator="dilate" in="SourceAlpha" result="effect2_dropShadow_1669_13491" />
        <feOffset dy="1" />
        <feGaussianBlur stdDeviation="1.5" />
        <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0" />
        <feBlend mode="normal" in2="effect1_dropShadow_1669_13491" result="effect2_dropShadow_1669_13491" />
        <feBlend mode="normal" in="SourceGraphic" in2="effect2_dropShadow_1669_13491" result="shape" />
      </filter>
      <clipPath id="bgblur_0_1669_13491_clip_path" transform="translate(3 2)">
        <path d="M13.2121 2.57414C12.5853 1.80862 11.4146 1.80862 10.788 2.57414L9.90009 3.65856C9.83924 3.73288 9.73773 3.76009 9.64787 3.72614L8.33677 3.23092C7.41123 2.88134 6.39741 3.46667 6.23738 4.44301L6.0107 5.82606C5.99517 5.92086 5.92086 5.99516 5.82606 6.0107L4.44301 6.23738C3.46668 6.39741 2.88134 7.41122 3.23092 8.33676L3.72614 9.64787C3.76009 9.73773 3.73288 9.83924 3.65856 9.90009L2.57414 10.7879C1.80862 11.4147 1.80862 12.5854 2.57414 13.2121L3.65856 14.0999C3.73288 14.1608 3.76009 14.2623 3.72614 14.3522L3.23092 15.6633C2.88135 16.5888 3.46667 17.6026 4.44301 17.7627L5.82606 17.9893C5.92086 18.0049 5.99517 18.0792 6.0107 18.174L6.23738 19.557C6.39741 20.5333 7.41122 21.1186 8.33677 20.7691L9.64787 20.2739C9.73773 20.24 9.83924 20.2671 9.90009 20.3415L10.788 21.4259C11.4146 22.1914 12.5853 22.1914 13.2121 21.4259L14.0999 20.3415C14.1608 20.2671 14.2623 20.24 14.3521 20.2739L15.6633 20.7691C16.5888 21.1186 17.6027 20.5333 17.7626 19.557L17.9894 18.174C18.0049 18.0792 18.0791 18.0049 18.1739 17.9893L19.557 17.7627C20.5334 17.6026 21.1187 16.5888 20.7691 15.6633L20.2739 14.3522C20.2399 14.2623 20.2671 14.1608 20.3414 14.0999L21.4259 13.2121C22.1914 12.5854 22.1914 11.4147 21.4259 10.7879L20.3414 9.90009C20.2671 9.83924 20.2399 9.73773 20.2739 9.64787L20.7691 8.33676C21.1187 7.41122 20.5334 6.39741 19.557 6.23738L18.1739 6.0107C18.0791 5.99516 18.0049 5.92086 17.9894 5.82606L17.7626 4.44301C17.6027 3.46668 16.5888 2.88134 15.6633 3.23092L14.3521 3.72614C14.2623 3.76009 14.1608 3.73288 14.0999 3.65856L13.2121 2.57414Z" />
      </clipPath>
      <linearGradient id="paint0_linear_1669_13491" x1="12" y1="7.5" x2="12" y2="41.5" gradientUnits="userSpaceOnUse">
        <stop stop-color="#3CD45A" />
        <stop offset="1" stop-color="white" />
      </linearGradient>
    </defs>
  </svg>
)

const ErrorIcon = ({ className }: SVGProps<SVGSVGElement>) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <g clip-path="url(#clip0_1669_13492)">
      <foreignObject x="-3" y="-2" width="30" height="28.8169">
        <div
          // xmlns="http://www.w3.org/1999/xhtml"
          style={{
            backdropFilter: 'blur(2px)',
            clipPath: 'url(#bgblur_1_1669_13492_clip_path)',
            height: '100%',
            width: '100%'
          }}></div>
      </foreignObject>
      <g filter="url(#filter0_dd_1669_13492)" data-figma-bg-blur-radius="4">
        <path
          d="M21.709 17.3146L14.0873 3.2413C13.6682 2.47438 12.8697 2 12 2C11.1303 2 10.3318 2.47438 9.91272 3.2413L2.29101 17.3146C1.88778 18.0578 1.90359 18.9354 2.33844 19.6628C2.77329 20.3823 3.5323 20.8171 4.37828 20.8171H19.6217C20.4677 20.8171 21.2267 20.3823 21.6616 19.6628C22.0964 18.9354 22.1122 18.0578 21.709 17.3146ZM12 17.6546C11.5652 17.6546 11.2094 17.2988 11.2094 16.8639C11.2094 16.4291 11.5652 16.0733 12 16.0733C12.4348 16.0733 12.7906 16.4291 12.7906 16.8639C12.7906 17.2988 12.4348 17.6546 12 17.6546ZM12.7906 14.492C12.7906 14.9269 12.4348 15.2827 12 15.2827C11.5652 15.2827 11.2094 14.9269 11.2094 14.492V8.16695C11.2094 7.7321 11.5652 7.37632 12 7.37632C12.4348 7.37632 12.7906 7.7321 12.7906 8.16695V14.492Z"
          fill="url(#paint0_linear_1669_13492)"
        />
      </g>
    </g>
    <defs>
      <filter
        id="filter0_dd_1669_13492"
        x="-3"
        y="-2"
        width="30"
        height="28.8169"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB">
        <feFlood flood-opacity="0" result="BackgroundImageFix" />
        <feColorMatrix
          in="SourceAlpha"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"
        />
        <feOffset dy="1" />
        <feGaussianBlur stdDeviation="1.5" />
        <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0" />
        <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1669_13492" />
        <feColorMatrix
          in="SourceAlpha"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"
        />
        <feMorphology radius="2" operator="dilate" in="SourceAlpha" result="effect2_dropShadow_1669_13492" />
        <feOffset dy="1" />
        <feGaussianBlur stdDeviation="1.5" />
        <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0" />
        <feBlend mode="normal" in2="effect1_dropShadow_1669_13492" result="effect2_dropShadow_1669_13492" />
        <feBlend mode="normal" in="SourceGraphic" in2="effect2_dropShadow_1669_13492" result="shape" />
      </filter>
      <clipPath id="bgblur_1_1669_13492_clip_path" transform="translate(3 2)">
        <path d="M21.709 17.3146L14.0873 3.2413C13.6682 2.47438 12.8697 2 12 2C11.1303 2 10.3318 2.47438 9.91272 3.2413L2.29101 17.3146C1.88778 18.0578 1.90359 18.9354 2.33844 19.6628C2.77329 20.3823 3.5323 20.8171 4.37828 20.8171H19.6217C20.4677 20.8171 21.2267 20.3823 21.6616 19.6628C22.0964 18.9354 22.1122 18.0578 21.709 17.3146ZM12 17.6546C11.5652 17.6546 11.2094 17.2988 11.2094 16.8639C11.2094 16.4291 11.5652 16.0733 12 16.0733C12.4348 16.0733 12.7906 16.4291 12.7906 16.8639C12.7906 17.2988 12.4348 17.6546 12 17.6546ZM12.7906 14.492C12.7906 14.9269 12.4348 15.2827 12 15.2827C11.5652 15.2827 11.2094 14.9269 11.2094 14.492V8.16695C11.2094 7.7321 11.5652 7.37632 12 7.37632C12.4348 7.37632 12.7906 7.7321 12.7906 8.16695V14.492Z" />
      </clipPath>
      <linearGradient id="paint0_linear_1669_13492" x1="12" y1="31.5" x2="12" y2="11" gradientUnits="userSpaceOnUse">
        <stop stop-color="white" />
        <stop offset="0.97" stop-color="#DC2626" />
      </linearGradient>
      <clipPath id="clip0_1669_13492">
        <rect width="24" height="24" fill="white" />
      </clipPath>
    </defs>
  </svg>
)

const CloseIcon = ({ className }: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" className={className}>
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M15.4419 5.44194C15.686 5.19786 15.686 4.80214 15.4419 4.55806C15.1979 4.31398 14.8021 4.31398 14.5581 4.55806L10 9.11612L5.44194 4.55806C5.19786 4.31398 4.80214 4.31398 4.55806 4.55806C4.31398 4.80214 4.31398 5.19786 4.55806 5.44194L9.11612 10L4.55806 14.5581C4.31398 14.8021 4.31398 15.1979 4.55806 15.4419C4.80214 15.686 5.19786 15.686 5.44194 15.4419L10 10.8839L14.5581 15.4419C14.8021 15.686 15.1979 15.686 15.4419 15.4419C15.686 15.1979 15.686 14.8021 15.4419 14.5581L10.8839 10L15.4419 5.44194Z"
      fill="black"
      fill-opacity="0.4"
    />
  </svg>
)
interface ToastProps {
  id: string | number
  type: 'info' | 'warning' | 'error' | 'success' | 'loading'
  title: string
  description?: string
  coloredMessage?: string
  coloredBackground?: boolean
  dismissable?: boolean
  onDismiss?: () => void
  button?: {
    icon?: ReactNode
    label: string
    onClick: () => void
  }
  link?: {
    label: string
    href?: string
    onClick?: () => void
  }
  promise?: Promise<unknown>
}

function toast(props: Omit<ToastProps, 'id'>) {
  return sonnerToast.custom((id) => <Toast id={id} {...props} />, {
    classNames: { toast: props.coloredBackground ? 'backdrop-blur-md rounded-xs' : undefined }
  })
}

interface QuickApiProps extends Omit<ToastProps, 'type' | 'id'> {}

interface QuickLoadingProps extends QuickApiProps {
  promise: ToastProps['promise']
}

toast.info = (props: QuickApiProps) => {
  toast({
    type: 'info',
    ...props
  })
}

toast.success = (props: QuickApiProps) => {
  toast({
    type: 'success',
    ...props
  })
}

toast.warning = (props: QuickApiProps) => {
  toast({
    type: 'warning',
    ...props
  })
}

toast.error = (props: QuickApiProps) => {
  toast({
    type: 'error',
    ...props
  })
}

toast.loading = (props: QuickLoadingProps) => {
  toast({
    type: 'loading',
    ...props
  })
}

toast.dismiss = (id: ToastProps['id']) => {
  sonnerToast.dismiss(id)
}

const toastColorVariants = cva(undefined, {
  variants: {
    type: {
      info: 'text-blue-500',
      warning: 'text-warning-base',
      error: 'text-error-base',
      success: 'text-success-base',
      loading: 'text-foreground-muted'
    }
  }
})

const toastBgColorVariants = cva(undefined, {
  variants: {
    type: {
      info: 'bg-blue-500/10 border-blue-500/20',
      warning: 'bg-orange-500/10 border-orange-500/20',
      error: 'bg-red-500/10 border-red-500/20',
      success: 'bg-primary/10 border-primary/20',
      loading: 'backdrop-blur-none'
    }
  }
})

function Toast({
  id,
  type,
  title,
  description,
  coloredMessage,
  coloredBackground,
  dismissable,
  onDismiss,
  button,
  link
}: ToastProps) {
  const icon = useMemo(() => {
    switch (type) {
      case 'info':
        return <InfoIcon className="size-6" />
      case 'error':
        return <ErrorIcon className="size-6" />
      case 'loading':
        return <Loader2Icon className="size-6 animate-spin" />
      case 'success':
        return <SuccessIcon className="size-6" />
      case 'warning':
        return <WarningIcon className="size-6" />
    }
  }, [type])

  const handleDismiss = useCallback(() => {
    sonnerToast.dismiss(id)
    onDismiss?.()
  }, [id, onDismiss])

  return (
    <div
      id={String(id)}
      className={cn(
        'flex p-4 rounded-xs bg-background border-border border-[0.5px] items-center shadow-lg',
        coloredBackground && toastBgColorVariants({ type })
      )}
      aria-label="Toast">
      {dismissable && (
        <button type="button" aria-label="Dismiss the toast" onClick={handleDismiss}>
          <CloseIcon className="size-5 absolute top-[5px] right-1.5" />
        </button>
      )}
      <div className={cn('flex items-start flex-1', button !== undefined ? 'gap-3' : 'gap-4')}>
        {icon}
        <div className="cs-toast-content flex flex-col gap-1">
          <div className="cs-toast-title font-medium leading-4.5" role="heading">
            {title}
          </div>
          <div className="cs-toast-description">
            <p className="text-foreground-secondary text-xs leading-3.5 tracking-normal">
              {coloredMessage && <span className={toastColorVariants({ type })}>{coloredMessage} </span>}
              {description}
            </p>
          </div>
          {link && (
            // FIXME: missing typography/typography components/p/letter-spacing
            <div className="cs-toast-link text-foreground-muted text-xs leading-3.5 tracking-normal">
              <a
                href={link.href}
                onClick={link.onClick}
                className={cn(
                  'underline decoration-foreground-muted cursor-pointer',
                  'hover:text-foreground-secondary',
                  // FIXME: missing active style in design
                  'active:text-black'
                )}>
                {link.label}
              </a>
            </div>
          )}
        </div>
      </div>
      {button !== undefined && (
        <button
          type="button"
          // FIXME: missing hover/active style
          className={cn(
            'py-1 px-2 rounded-3xs flex items-center h-7 bg-background-subtle border-[0.5px] border-border',
            'text-foreground text-sm leading-4 tracking-normal',
            button.icon !== undefined && 'gap-2'
          )}
          onClick={button.onClick}>
          <div>{button.icon}</div>
          <div>{button.label}</div>
        </button>
      )}
    </div>
  )
}

const Toaster = ({ ...props }: ToasterProps) => {
  return <Sonner className="toaster group" {...props} />
}

export { toast, Toaster }
