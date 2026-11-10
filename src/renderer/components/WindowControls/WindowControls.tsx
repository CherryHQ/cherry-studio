import { isLinux, isWin } from '@renderer/utils/platform'

// Reserve the native controls' actual width, including display scaling and page zoom.
export const WINDOW_CONTROLS_OVERLAY_WIDTH = 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))'

const WindowControls: React.FC = () =>
  isWin || isLinux ? <div aria-hidden className="shrink-0" style={{ width: WINDOW_CONTROLS_OVERLAY_WIDTH }} /> : null

export default WindowControls
