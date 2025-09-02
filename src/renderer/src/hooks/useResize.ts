import { clamp } from 'lodash'

/**
 * @param initial - 初始宽度、高度
 * @param deltaSign - 差值方向。例如：向右移动宽度增加，deltaSign = 1；向左移动宽度增加，deltaSign = -1
 * @param min - 最小值
 * @param max - 最大值
 */
interface ResizeProps {
  initial: number
  deltaSign: 1 | -1
  min?: number
  max?: number
}

/**
 * @param onResizing - 回调函数，参数为 `{ width: number, height: number }`
 * @param direction - 'horizontal' | 'vertical'。当前只支持在一个方向上改变
 * @param x, y - 在 x 或 y 方向上的参数
 */
interface Props {
  onResizing: ({ width, height }: { width: number; height: number }) => void
  direction: 'horizontal' | 'vertical'
  x?: ResizeProps
  y?: ResizeProps
  onResizeStart?: () => void
  onResizeEnd?: () => void
}

export function useResize() {
  const handleResize = (ref: HTMLElement, props: Props) => {
    ref.addEventListener('mousedown', (e: MouseEvent) => {
      const initialX = e.x
      const initialY = e.y
      const handleMouseMove = (e: MouseEvent) => {
        let width = (e.x - initialX) * (props.x?.deltaSign ?? 1) + (props.x?.initial ?? 0)
        let height = (e.y - initialY) * (props.y?.deltaSign ?? 1) + (props.y?.initial ?? 0)
        const cursor = getCursor({ x: props.x, y: props.y, direction: props.direction }, width, height)
        document.body.style.cursor = cursor
        if (props.x !== undefined) {
          width = clamp(width, props.x.min ?? 0, props.x.max ?? Number.MAX_SAFE_INTEGER)
        }
        if (props.y !== undefined) {
          height = clamp(height, props.y.min ?? 0, props.y.max ?? Number.MAX_SAFE_INTEGER)
        }
        props.onResizing({ width, height })
      }
      const handleMouseUp = () => {
        props.onResizeEnd?.()
        document.body.style.cursor = ''
        document.removeEventListener('mouseup', handleMouseUp)
        document.removeEventListener('mousemove', handleMouseMove)
      }

      props.onResizeStart?.()
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    })
  }

  return {
    handleResize
  }
}

function getCursor(
  props: { x?: ResizeProps; y?: ResizeProps; direction: 'horizontal' | 'vertical' },
  x: number,
  y: number
): string {
  if (props.direction === 'horizontal') {
    let w = true
    let e = true
    if (props.x !== undefined && x <= (props.x.min ?? -Infinity)) w = false
    if (props.x !== undefined && x >= (props.x.max ?? Infinity)) e = false
    if (w && e) return 'col-resize'
    else if (w) return 'w-resize'
    else if (e) return 'e-resize'
    else return 'not-allowed'
  }
  if (props.direction === 'vertical') {
    let n = true
    let s = true
    if (props.y !== undefined && y <= (props.y.min ?? -Infinity)) n = false
    if (props.y !== undefined && y >= (props.y.max ?? Infinity)) s = false
    if (n && s) return 'row-resize'
    else if (n) return 'n-resize'
    else if (s) return 's-resize'
    else return 'not-allowed'
  }

  return 'default'
}
