import type { SVGProps } from 'react'

/**
 * Broadcast-tower glyph used to mark the synthetic "unified gateway" provider —
 * a relay/hub metaphor that reads better for a gateway than a plain server box.
 *
 * Icon from Font Awesome Solid by Dave Gandy, CC BY 4.0
 * (https://creativecommons.org/licenses/by/4.0/). Solid path, driven by
 * `currentColor`; size via `width`/`height` (defaults to `1em`).
 */
export function GatewayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 640 640"
      aria-hidden="true"
      {...props}>
      <path
        fill="currentColor"
        d="M119.9 75.5c-11.3-6.9-26.1-3.2-33 8.1c-24.8 41-39 89.1-39 140.4s14.2 99.4 39 140.4c6.9 11.3 21.6 15 33 8.1s15-21.6 8.1-33c-20.3-33.6-32-73.2-32-115.5s11.7-81.9 32.1-115.6c6.9-11.3 3.2-26.1-8.1-33zm400.1 0c-11.3 6.9-15 21.6-8.1 33c20.4 33.7 32.1 73.3 32.1 115.6s-11.7 81.9-32.1 115.6c-6.9 11.3-3.2 26.1 8.1 33s26.1 3.2 33-8.1c24.8-41 39-89.1 39-140.4s-14.2-99.6-39-140.6c-6.9-11.3-21.6-15-33-8.1M352 279.4c19.1-11.1 32-31.7 32-55.4c0-35.3-28.7-64-64-64s-64 28.7-64 64c0 23.7 12.9 44.4 32 55.4V544c0 17.7 14.3 32 32 32s32-14.3 32-32zM212.2 155c7.2-11.2 3.9-26-7.2-33.2s-26-3.9-33.2 7.2c-17.6 27.4-27.8 60-27.8 95s10.2 67.6 27.8 95c7.2 11.2 22 14.4 33.2 7.2s14.4-22 7.2-33.2c-12.8-19.9-20.2-43.6-20.2-69s7.4-49.1 20.2-69m256-26c-7.2-11.2-22-14.4-33.2-7.2s-14.4 22-7.2 33.2c12.8 19.9 20.2 43.6 20.2 69s-7.4 49.1-20.2 69c-7.2 11.2-3.9 26 7.2 33.2s26 3.9 33.2-7.2c17.6-27.4 27.8-60 27.8-95s-10.2-67.6-27.8-95"
      />
    </svg>
  )
}
