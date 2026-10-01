import './paragraph-layout.css'
import {
  createContext,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode
} from 'react'

import {
  composeParagraph,
  createParagraphMeasure,
  type ParagraphLayout,
  type ParagraphPiece,
  type ParagraphRun
} from '../../lib/paragraph-layout'

type Layout = Map<string, ParagraphPiece[]>
const ParagraphContext = createContext<Layout | null>(null)

function Piece({ piece, text }: { piece: ParagraphPiece; text: string }) {
  return (
    <span
      data-paragraph-piece={piece.kind}
      aria-hidden={piece.kind === 'hyphen' || piece.kind === 'break' ? true : undefined}
      style={
        piece.kind === 'text' || piece.kind === 'space'
          ? { width: Math.max(0, piece.width), marginInlineEnd: Math.min(0, piece.width) }
          : undefined
      }>
      {text.slice(piece.from, piece.to)}
    </span>
  )
}

export function ParagraphText({ children }: { children: string }) {
  const id = useId()
  const layout = use(ParagraphContext)
  const pieces = layout?.get(id)
  return (
    <span data-paragraph-run={id} data-paragraph-source={children}>
      {pieces ? pieces.map((piece, index) => <Piece key={index} piece={piece} text={children} />) : children}
    </span>
  )
}

export function ParagraphAtomic({ children }: { children: ReactNode }) {
  const id = useId()
  const layout = use(ParagraphContext)
  if (!layout) return children
  const pieces = layout.get(id)
  return (
    <>
      {pieces
        ?.filter((piece) => piece.kind !== 'atomic' && piece.from === 0)
        .map((piece, index) => (
          <Piece key={index} piece={piece} text="" />
        ))}
      <span data-paragraph-run={id} data-paragraph-atomic="">
        {children}
      </span>
      {pieces
        ?.filter((piece) => piece.kind !== 'atomic' && piece.from !== 0)
        .map((piece, index) => (
          <Piece key={index} piece={piece} text="" />
        ))}
    </>
  )
}

export function JustifiedParagraph({
  children,
  onLayoutError,
  ...props
}: ComponentProps<'p'> & { onLayoutError: (error: unknown) => void }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [layout, setLayout] = useState<Layout>(() => new Map())
  const measurer = useMemo(createParagraphMeasure, [])
  useLayoutEffect(() => {
    const root = ref.current!
    let frame = 0
    let width = -1
    let font = ''
    let dirty = true
    let visible = false
    let disposed = false
    const fontKey = () => {
      const style = getComputedStyle(root)
      return `${style.fontFamily}:${style.fontSize}:${style.fontWeight}:${style.fontStyle}:${style.letterSpacing}:${style.wordSpacing}`
    }
    const update = () => {
      frame = 0
      if (disposed || !dirty) return
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(root))
        return
      if (!visible) {
        setLayout((previous) => (previous.size ? new Map() : previous))
        return
      }
      dirty = false
      const elements = [...root.querySelectorAll<HTMLElement>('[data-paragraph-run]')]
      width = root.getBoundingClientRect().width
      const style = getComputedStyle(root)
      font = fontKey()
      let result: ParagraphLayout | null = null
      try {
        const runs: ParagraphRun[] = []
        let supported =
          !root.querySelector('br') &&
          !root.closest('table, li') &&
          ['start', 'left', 'justify'].includes(style.textAlign)
        for (const element of elements) {
          const metrics = measurer.metrics(element)
          const text = element.dataset.paragraphSource ?? '\ufffc'
          if (!metrics || (/\r|\n/.test(text) && style.whiteSpace !== 'normal' && style.whiteSpace !== 'nowrap')) {
            supported = false
            break
          }
          runs.push({
            text,
            metrics,
            ...(element.hasAttribute('data-paragraph-atomic')
              ? { atomicWidth: element.getBoundingClientRect().width }
              : {})
          })
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent && !node.parentElement?.closest('[data-paragraph-run]')) supported = false
        }
        if (supported)
          result = composeParagraph(runs, width, measurer.measure, root.closest('[lang]')?.getAttribute('lang') ?? '')
      } catch (error) {
        onLayoutError(error)
      }
      setLayout(
        result
          ? new Map(elements.map((element, index) => [element.dataset.paragraphRun!, result.runs[index]]))
          : new Map()
      )
    }
    const schedule = () => {
      dirty = true
      if (!frame) frame = requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(() => {
      if (Math.abs(root.getBoundingClientRect().width - width) > 1 || fontKey() !== font) schedule()
    })
    const visibility = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        if (visible && dirty) schedule()
      },
      { rootMargin: '200px' }
    )
    const fonts = () => {
      measurer.clear()
      schedule()
    }
    const selection = () => {
      if (dirty && !frame) frame = requestAnimationFrame(update)
    }
    resize.observe(root)
    visibility.observe(root)
    document.fonts.addEventListener('loadingdone', fonts)
    document.addEventListener('selectionchange', selection)
    schedule()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      visibility.disconnect()
      document.fonts.removeEventListener('loadingdone', fonts)
      document.removeEventListener('selectionchange', selection)
    }
  }, [children, props.className, props.style, measurer, onLayoutError])
  useEffect(() => {
    const root = ref.current!
    if (layout.size && root.scrollWidth > root.clientWidth + 1) setLayout(new Map())
  }, [layout])
  return (
    <ParagraphContext value={layout}>
      <p {...props} ref={ref} data-paragraph-layout={layout.size ? 'composed' : 'native'}>
        {children}
      </p>
    </ParagraphContext>
  )
}
