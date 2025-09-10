import { lightbulbVariants } from '@renderer/utils/motionVariants'
import { motion } from 'motion/react'
import { SVGProps } from 'react'

export const StreamlineGoodHealthAndWellBeing = (
  props: SVGProps<SVGSVGElement> & {
    size?: number | string
    isActive?: boolean
  }
) => {
  const { size = '1em', isActive, ...svgProps } = props

  return (
    <motion.span variants={lightbulbVariants} animate={isActive ? 'active' : 'idle'} initial="idle">
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 -2 14 16" {...svgProps}>
        {/* Icon from Streamline by Streamline - https://creativecommons.org/licenses/by/4.0/ */}
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}>
          <path d="m10.097 12.468l-2.773-2.52c-1.53-1.522.717-4.423 2.773-2.045c2.104-2.33 4.303.57 2.773 2.045z"></path>
          <path d="M.621 6.088h1.367l1.823 3.19l4.101-7.747l1.823 3.646"></path>
        </g>
      </svg>
    </motion.span>
  )
}

export function MdiLightbulbOffOutline(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      {/* Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M12 2C9.76 2 7.78 3.05 6.5 4.68l1.43 1.43C8.84 4.84 10.32 4 12 4a5 5 0 0 1 5 5c0 1.68-.84 3.16-2.11 4.06l1.42 1.44C17.94 13.21 19 11.24 19 9a7 7 0 0 0-7-7M3.28 4L2 5.27L5.04 8.3C5 8.53 5 8.76 5 9c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h5.73l4 4L20 20.72zm3.95 6.5l5.5 5.5H10v-2.42a5 5 0 0 1-2.77-3.08M9 20v1a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1z"></path>
    </svg>
  )
}

export function MdiLightbulbAutoOutline(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      {/* Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M9 2c3.87 0 7 3.13 7 7c0 2.38-1.19 4.47-3 5.74V17c0 .55-.45 1-1 1H6c-.55 0-1-.45-1-1v-2.26C3.19 13.47 2 11.38 2 9c0-3.87 3.13-7 7-7M6 21v-1h6v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1M9 4C6.24 4 4 6.24 4 9c0 2.05 1.23 3.81 3 4.58V16h4v-2.42c1.77-.77 3-2.53 3-4.58c0-2.76-2.24-5-5-5m10 9h-2l-3.2 9h1.9l.7-2h3.2l.7 2h1.9zm-2.15 5.65L18 15l1.15 3.65z"></path>
    </svg>
  )
}

export function MdiLightbulbOn10(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      {/* Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M1 11h3v2H1zm18.1-7.5L17 5.6L18.4 7l2.1-2.1zM11 1h2v3h-2zM4.9 3.5L3.5 4.9L5.6 7L7 5.6zM10 22c0 .6.4 1 1 1h2c.6 0 1-.4 1-1v-1h-4zm2-16c-3.3 0-6 2.7-6 6c0 2.2 1.2 4.2 3 5.2V19c0 .6.4 1 1 1h4c.6 0 1-.4 1-1v-1.8c1.8-1 3-3 3-5.2c0-3.3-2.7-6-6-6m1 9.9V17h-2v-1.1c-1.7-.4-3-2-3-3.9c0-2.2 1.8-4 4-4s4 1.8 4 4c0 1.9-1.3 3.4-3 3.9m7-4.9h3v2h-3z"></path>
    </svg>
  )
}

export function MdiLightbulbOn30(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      {/* Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M7 5.6L5.6 7L3.5 4.9L4.9 3.5L7 5.6M1 13H4V11H1V13M13 1H11V4H13V1M18 12C18 14.2 16.8 16.2 15 17.2V19C15 19.6 14.6 20 14 20H10C9.4 20 9 19.6 9 19V17.2C7.2 16.2 6 14.2 6 12C6 8.7 8.7 6 12 6S18 8.7 18 12M16 12C16 9.79 14.21 8 12 8S8 9.79 8 12C8 13.2 8.54 14.27 9.38 15H14.62C15.46 14.27 16 13.2 16 12M10 22C10 22.6 10.4 23 11 23H13C13.6 23 14 22.6 14 22V21H10V22M20 11V13H23V11H20M19.1 3.5L17 5.6L18.4 7L20.5 4.9L19.1 3.5Z"
      />
    </svg>
  )
}

export function MdiLightbulbOn50(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      {/* Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M1 11h3v2H1zm9 11c0 .6.4 1 1 1h2c.6 0 1-.4 1-1v-1h-4zm3-21h-2v3h2zM4.9 3.5L3.5 4.9L5.6 7L7 5.6zM20 11v2h3v-2zm-.9-7.5L17 5.6L18.4 7l2.1-2.1zM18 12c0 2.2-1.2 4.2-3 5.2V19c0 .6-.4 1-1 1h-4c-.6 0-1-.4-1-1v-1.8c-1.8-1-3-3-3-5.2c0-3.3 2.7-6 6-6s6 2.7 6 6M8 12c0 .35.05.68.14 1h7.72c.09-.32.14-.65.14-1c0-2.21-1.79-4-4-4s-4 1.79-4 4"></path>
    </svg>
  )
}

export function MdiLightbulbOn80(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      {/* Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M7 5.6L5.6 7L3.5 4.9L4.9 3.5L7 5.6M1 13H4V11H1V13M13 1H11V4H13V1M10 22C10 22.6 10.4 23 11 23H13C13.6 23 14 22.6 14 22V21H10V22M20 11V13H23V11H20M19.1 3.5L17 5.6L18.4 7L20.5 4.9L19.1 3.5M18 12C18 14.2 16.8 16.2 15 17.2V19C15 19.6 14.6 20 14 20H10C9.4 20 9 19.6 9 19V17.2C7.2 16.2 6 14.2 6 12C6 8.7 8.7 6 12 6S18 8.7 18 12M8.56 10H15.44C14.75 8.81 13.5 8 12 8S9.25 8.81 8.56 10Z"
      />
    </svg>
  )
}
export function MdiLightbulbOn90(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      {/* Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M7 5.6L5.6 7L3.5 4.9l1.4-1.4zM10 22c0 .6.4 1 1 1h2c.6 0 1-.4 1-1v-1h-4zm-9-9h3v-2H1zM13 1h-2v3h2zm7 10v2h3v-2zm-.9-7.5L17 5.6L18.4 7l2.1-2.1zM18 12c0 2.2-1.2 4.2-3 5.2V19c0 .6-.4 1-1 1h-4c-.6 0-1-.4-1-1v-1.8c-1.8-1-3-3-3-5.2c0-3.3 2.7-6 6-6s6 2.7 6 6m-6-4c-1 0-1.91.38-2.61 1h5.22C13.91 8.38 13 8 12 8"></path>
    </svg>
  )
}

export function MdiLightbulbOn(props: SVGProps<SVGSVGElement>) {
  // {/* Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE */}
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M12,6A6,6 0 0,1 18,12C18,14.22 16.79,16.16 15,17.2V19A1,1 0 0,1 14,20H10A1,1 0 0,1 9,19V17.2C7.21,16.16 6,14.22 6,12A6,6 0 0,1 12,6M14,21V22A1,1 0 0,1 13,23H11A1,1 0 0,1 10,22V21H14M20,11H23V13H20V11M1,11H4V13H1V11M13,1V4H11V1H13M4.92,3.5L7.05,5.64L5.63,7.05L3.5,4.93L4.92,3.5M16.95,5.63L19.07,3.5L20.5,4.93L18.37,7.05L16.95,5.63Z"
      />
    </svg>
  )
}

export function BingLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}>
      <path d="M4.842.005a.966.966 0 01.604.142l2.62 1.813c.369.256.492.352.637.496.471.47.752 1.09.797 1.765l.008.847.003 1.441.004 13.002.144-.094 7.015-4.353.015.003.029.01c-.398-.17-.893-.339-1.655-.566l-.484-.146c-.584-.18-.71-.238-.921-.38a2.009 2.009 0 01-.37-.312 2.172 2.172 0 01-.41-.592L11.32 9.063c-.166-.444-.166-.49-.156-.63a.92.92 0 01.806-.864l.094-.01c.044-.005.22.023.29.044l.052.021c.06.026.16.075.313.154l3.63 1.908a6.626 6.626 0 013.292 4.531c.194.99.159 2.037-.102 3.012-.216.805-.639 1.694-1.054 2.213l-.08.099-.047.05c-.01.01-.013.01-.01.002l.043-.074-.072.114c-.011.031-.233.28-.38.425l-.17.161c-.22.202-.431.36-.832.62L13.544 23c-.941.6-1.86.912-2.913.992-.23.018-.854.008-1.074-.017a6.31 6.31 0 01-1.658-.412c-1.854-.738-3.223-2.288-3.705-4.195a8.077 8.077 0 01-.121-.57l-.046-.325a1.123 1.123 0 01-.014-.168l-.006-.029L4 11.617 4.01.866a.981.981 0 01.007-.111.943.943 0 01.825-.75z"></path>
    </svg>
  )
}

export function SearXNGLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 265 265" style={{ display: 'block' }} {...props}>
      <g transform="translate(-40.921 -17.417)">
        <circle
          cx="142.2"
          cy="122.9"
          r="85"
          fill="none"
          stroke="currentColor"
          strokeWidth="28.3465"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeMiterlimit="11.3386"
        />
        <path
          d="M118.4 77.6c19.8-10.2 44-6.4 59.7 9.4s19.3 40 8.9 59.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="14.1732"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeMiterlimit="11.3386"
        />
        <path d="m184.2 202 37-38.6 81.8 78.3-37 38.6z" fill="currentColor" />
      </g>
    </svg>
  )
}

export function TavilyLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="42" height="42" viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="m16.44.964 4.921 7.79c.79 1.252-.108 2.883-1.588 2.883H17.76V23.3h-2.91V.088c.61 0 1.22.292 1.59.876z"
        fill="currentColor"
      />
      <path
        d="M8.342 8.755 13.263.964a1.864 1.864 0 0 1 1.59-.876V23.3a4.87 4.87 0 0 0-.252-.006c-.99 0-1.907.311-2.658.842V11.637H9.93c-1.48 0-2.38-1.631-1.589-2.882z"
        fill="currentColor"
      />
      <path
        d="M30.278 31H18.031a4.596 4.596 0 0 0 1.219-2.91h22.577c0 .61-.292 1.22-.875 1.59L33.16 34.6c-1.251.791-2.883-.108-2.883-1.588V31z"
        fill="currentColor"
      />
      <path
        d="m33.16 21.581 7.79 4.921c.585.369.876.979.876 1.589H19.25a4.619 4.619 0 0 0-.858-2.91h11.887V23.17c0-1.48 1.631-2.38 2.882-1.589z"
        fill="currentColor"
      />
      <path
        d="m8.24 34.25-7.107 7.108a1.864 1.864 0 0 0 1.742.504l8.989-2.03c1.443-.325 1.961-2.114.915-3.16l-1.423-1.423 5.356-5.356a2.805 2.805 0 0 0 0-3.966l-.074-.075L8.24 34.25z"
        fill="currentColor"
      />
      <path
        d="m7.243 31.135 5.355-5.356a2.805 2.805 0 0 1 3.967 0l.074.074-8.397 8.397-7.108 7.108a1.864 1.864 0 0 1-.504-1.742l2.029-8.989c.325-1.444 2.115-1.961 3.161-.915l1.423 1.423z"
        fill="currentColor"
      />
    </svg>
  )
}

export function ExaLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}>
      <title>Exa</title>
      <path
        clip-rule="evenodd"
        d="M3 0h19v1.791L13.892 12 22 22.209V24H3V0zm9.62 10.348l6.589-8.557H6.03l6.59 8.557zM5.138 3.935v7.17h5.52l-5.52-7.17zm5.52 8.96h-5.52v7.17l5.52-7.17zM6.03 22.21l6.59-8.557 6.589 8.557H6.03z"></path>
    </svg>
  )
}

export function BochaLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 135 116" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.5754 13.8123C24.6109 7.94459 39.1223 12.9435 44.9955 24.9805L57.5355 50.6805C60.4695 56.6936 57.9756 63.9478 51.9652 66.8832C51.9627 66.8844 51.9602 66.8856 51.9577 66.8868C45.94 69.8206 38.6843 67.3212 35.7477 61.3027L12.5754 13.8123Z"
        fill="currentColor"
      />
      <path
        opacity="0.64774"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0 38.3013C9.46916 28.836 24.813 28.836 34.2822 38.3013L55.2526 59.2631C59.9819 63.9904 59.9852 71.6582 55.2601 76.3896C55.2576 76.3921 55.2551 76.3946 55.2526 76.397C50.5181 81.1297 42.8461 81.1297 38.1116 76.397L0 38.3013Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M86.8777 18.0444C113.939 18.0444 135.876 39.9725 135.876 67.0222C135.876 80.2286 129.086 93.6477 120.585 102.457L117.065 98.2367C111.026 90.9998 108.882 81.2777 111.314 72.1702C111.755 70.5198 111.976 69.0033 111.976 67.6209C111.976 53.6689 100.661 42.3586 86.7029 42.3586C72.7452 42.3586 61.4303 53.6689 61.4303 67.6209C61.4303 81.5728 72.7452 92.8831 86.7029 92.8831C89.3159 92.8831 91.8363 92.4867 94.2071 91.7508C101.312 89.5455 109.054 91.3768 114.419 96.5322L120.585 102.457C111.83 110.626 99.7992 116 86.8777 116C59.8168 116 37.8796 94.0719 37.8796 67.0222C37.8796 39.9725 59.8168 18.0444 86.8777 18.0444Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M37.8796 0C51.2677 0 62.1208 10.8581 62.1208 24.2522V41.7389C62.1208 55.133 51.2677 65.9911 37.8796 65.9911V0Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function ZhipuLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24px" height="24px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M 11.699219 1.800781 C 12.300781 1.984375 12.832031 2.203125 13.375 2.515625 C 13.523438 2.597656 13.671875 2.679688 13.820312 2.765625 C 14.058594 2.902344 14.058594 2.902344 14.296875 3.039062 C 14.632812 3.226562 14.96875 3.417969 15.304688 3.605469 C 15.476562 3.707031 15.652344 3.804688 15.824219 3.902344 C 16.671875 4.382812 17.523438 4.859375 18.375 5.335938 C 18.804688 5.574219 19.234375 5.816406 19.660156 6.054688 C 20.257812 6.386719 20.855469 6.71875 21.449219 7.050781 C 21.460938 8.449219 21.46875 9.851562 21.472656 11.25 C 21.476562 11.902344 21.480469 12.550781 21.484375 13.203125 C 21.488281 13.828125 21.492188 14.457031 21.492188 15.082031 C 21.492188 15.324219 21.496094 15.5625 21.496094 15.800781 C 21.5 16.136719 21.5 16.472656 21.5 16.808594 C 21.503906 17.09375 21.503906 17.09375 21.503906 17.386719 C 21.449219 17.851562 21.449219 17.851562 21.242188 18.125 C 20.917969 18.359375 20.585938 18.558594 20.238281 18.757812 C 20.085938 18.84375 19.929688 18.933594 19.769531 19.027344 C 19.605469 19.121094 19.4375 19.214844 19.265625 19.3125 C 19.003906 19.460938 18.742188 19.613281 18.480469 19.761719 C 18.203125 19.917969 17.929688 20.074219 17.65625 20.234375 C 16.929688 20.648438 16.203125 21.066406 15.476562 21.484375 C 15.140625 21.675781 14.804688 21.867188 14.46875 22.0625 C 14.238281 22.195312 14.238281 22.195312 14.003906 22.328125 C 13.863281 22.410156 13.71875 22.492188 13.574219 22.574219 C 13.265625 22.761719 12.984375 22.957031 12.695312 23.171875 C 12.179688 23.46875 11.972656 23.390625 11.398438 23.25 C 10.996094 23.058594 10.996094 23.058594 10.585938 22.816406 C 10.429688 22.726562 10.277344 22.636719 10.117188 22.542969 C 9.871094 22.398438 9.871094 22.398438 9.617188 22.246094 C 9.445312 22.144531 9.273438 22.042969 9.101562 21.945312 C 8.746094 21.734375 8.386719 21.523438 8.03125 21.316406 C 7.359375 20.917969 6.683594 20.523438 6.007812 20.128906 C 5.703125 19.953125 5.402344 19.773438 5.101562 19.597656 C 4.34375 19.15625 3.578125 18.722656 2.800781 18.308594 C 2.550781 18.148438 2.550781 18.148438 2.398438 17.851562 C 2.378906 17.519531 2.367188 17.183594 2.363281 16.851562 C 2.359375 16.75 2.355469 16.648438 2.355469 16.542969 C 2.335938 15.597656 2.324219 14.652344 2.316406 13.707031 C 2.3125 13.070312 2.304688 12.4375 2.289062 11.800781 C 2.277344 11.1875 2.269531 10.574219 2.265625 9.960938 C 2.265625 9.726562 2.257812 9.492188 2.253906 9.257812 C 2.203125 7.4375 2.203125 7.4375 2.675781 6.871094 C 3.023438 6.632812 3.363281 6.464844 3.75 6.300781 C 3.914062 6.203125 4.078125 6.109375 4.246094 6.007812 C 4.402344 5.925781 4.554688 5.839844 4.710938 5.753906 C 4.839844 5.683594 4.839844 5.683594 4.972656 5.613281 C 5.152344 5.515625 5.332031 5.417969 5.515625 5.316406 C 5.992188 5.058594 6.472656 4.792969 6.949219 4.53125 C 7.046875 4.480469 7.144531 4.425781 7.242188 4.371094 C 8.195312 3.847656 9.140625 3.320312 10.085938 2.785156 C 10.234375 2.703125 10.378906 2.621094 10.53125 2.535156 C 10.664062 2.460938 10.796875 2.382812 10.933594 2.308594 C 11.109375 2.207031 11.109375 2.207031 11.285156 2.109375 C 11.542969 1.96875 11.542969 1.96875 11.699219 1.800781 Z M 11.851562 4.5 C 11.820312 4.652344 11.789062 4.800781 11.753906 4.957031 C 11.207031 7.453125 10.085938 9.570312 7.941406 11.066406 C 6.816406 11.78125 5.628906 12.113281 4.351562 12.449219 C 4.351562 12.5 4.351562 12.550781 4.351562 12.601562 C 4.582031 12.648438 4.582031 12.648438 4.824219 12.699219 C 6.101562 12.984375 7.183594 13.300781 8.25 14.101562 C 8.363281 14.183594 8.476562 14.265625 8.59375 14.351562 C 10.558594 15.933594 11.488281 18.261719 11.851562 20.699219 C 11.898438 20.699219 11.949219 20.699219 12 20.699219 C 12.03125 20.554688 12.058594 20.410156 12.089844 20.257812 C 12.6875 17.503906 13.816406 15.222656 16.242188 13.65625 C 17.253906 13.054688 18.351562 12.8125 19.5 12.601562 C 19.035156 12.289062 18.695312 12.191406 18.160156 12.046875 C 15.792969 11.332031 14.222656 9.945312 13.050781 7.800781 C 12.527344 6.726562 12.175781 5.679688 12 4.5 C 11.949219 4.5 11.902344 4.5 11.851562 4.5 Z M 11.851562 4.5 "
        fill="currentColor"
      />
    </svg>
  )
}
export function PoeLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      height="1em"
      width="1em"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}>
      <title>Poe</title>
      <path d="M20.708 6.876a1.412 1.412 0 00-1.029-.415h-.006a2.019 2.019 0 01-2.02-2.023A1.415 1.415 0 0016.254 3H4.871A1.412 1.412 0 003.47 4.434a2.026 2.026 0 01-2.025 2.025v.002A1.414 1.414 0 000 7.883v3.642a1.414 1.414 0 001.444 1.42 2.025 2.025 0 012.025 2.02v3.693a.5.5 0 00.89.313l2.051-2.567h9.843a1.412 1.412 0 001.4-1.434v-.002c0-1.12.904-2.025 2.026-2.025a1.412 1.412 0 001.446-1.42V7.88c0-.363-.14-.727-.417-1.005zm-2.42 4.687a2.025 2.025 0 01-2.025 2.005H4.861a2.025 2.025 0 01-2.025-2.005v-3.72A2.026 2.026 0 014.86 5.838h11.4a2.026 2.026 0 012.026 2.005v3.72h.002z"></path>
      <path d="M7.413 7.57A1.422 1.422 0 005.99 8.99v1.422a1.422 1.422 0 102.844 0V8.99c0-.784-.636-1.422-1.422-1.422zm6.297 0a1.422 1.422 0 00-1.422 1.421v1.422a1.422 1.422 0 102.844 0V8.99c0-.784-.636-1.422-1.422-1.422z"></path>
      <path
        d="M7.292 22.643l1.993-2.492h9.844a1.413 1.413 0 001.4-1.434 2.025 2.025 0 012.017-2.027h.01A1.409 1.409 0 0024 15.27v-3.594c0-.344-.113-.68-.324-.951l-.397-.519v4.127a1.415 1.415 0 01-1.444 1.42h-.007a2.026 2.026 0 00-2.018 2.025 1.415 1.415 0 01-1.402 1.436H8.565l-2.169 2.712a.574.574 0 00.896.715v.002z"
        fill="url(#lobe-icons-poe-fill-0)"></path>
      <path
        d="M5.004 19.992l2.12-2.65h9.844a1.414 1.414 0 001.402-1.437c0-1.116.9-2.021 2.014-2.025h.012a1.413 1.413 0 001.443-1.422v-4.13l.52.68c.21.273.324.607.324.95v3.594a1.416 1.416 0 01-1.443 1.42h-.01a2.026 2.026 0 00-2.016 2.026 1.414 1.414 0 01-1.402 1.435H7.97l-1.916 2.4a.671.671 0 01-1.049-.839v-.002z"
        fill="url(#lobe-icons-poe-fill-1)"></path>
      <defs>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id="lobe-icons-poe-fill-0"
          x1="34.01"
          x2="1.086"
          y1="7.303"
          y2="27.715">
          <stop stopColor="#46A6F7"></stop>
          <stop offset="1" stop-color="#8364FF"></stop>
        </linearGradient>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id="lobe-icons-poe-fill-1"
          x1="4.915"
          x2="24.34"
          y1="23.511"
          y2="9.464">
          <stop stopColor="#FF44D3"></stop>
          <stop offset="1" stop-color="#CF4BFF"></stop>
        </linearGradient>
      </defs>
    </svg>
  )
}
