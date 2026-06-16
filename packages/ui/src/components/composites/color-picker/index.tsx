// Vendored from Kibo UI (https://www.kibo-ui.com/components/color-picker), adapted to
// @cherrystudio/ui import paths. Upstream's controlled-value sync assigned RGB channels
// to HSL state; fixed here with a proper HSL conversion.
import { Button } from '@cherrystudio/ui/components/primitives/button'
import { Input } from '@cherrystudio/ui/components/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui/components/primitives/select'
import { cn } from '@cherrystudio/ui/lib/utils'
import * as SliderPrimitive from '@radix-ui/react-slider'
import Color from 'color'
import { PipetteIcon } from 'lucide-react'
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  memo,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

type ColorPickerContextValue = {
  hue: number
  saturation: number
  lightness: number
  alpha: number
  mode: string
  setHue: (hue: number) => void
  setSaturation: (saturation: number) => void
  setLightness: (lightness: number) => void
  setAlpha: (alpha: number) => void
  setMode: (mode: string) => void
}

const ColorPickerContext = createContext<ColorPickerContextValue | undefined>(undefined)

export const useColorPicker = () => {
  const context = use(ColorPickerContext)

  if (!context) {
    throw new Error('useColorPicker must be used within a ColorPickerProvider')
  }

  return context
}

export type ColorPickerProps = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  value?: Parameters<typeof Color>[0]
  defaultValue?: Parameters<typeof Color>[0]
  onChange?: (value: [number, number, number, number]) => void
}

// Parse a color input, falling back instead of throwing on undefined or an
// invalid string — a user-typed color (e.g. a partial hex) must not crash this
// shared component during render.
const safeColor = (
  input: Parameters<typeof Color>[0],
  fallback: ReturnType<typeof Color>
): ReturnType<typeof Color> => {
  if (input === undefined) return fallback
  try {
    return Color(input)
  } catch {
    return fallback
  }
}

export const ColorPicker = ({ value, defaultValue = '#000000', onChange, className, ...props }: ColorPickerProps) => {
  const defaultColor = safeColor(defaultValue, Color('#000000'))
  // Seed from the controlled value when present, otherwise the default. Read each
  // channel directly (no `||` fallback): a legitimate zero channel — a grayscale
  // saturation of 0, a black lightness of 0, a transparent alpha of 0 — must survive.
  const seedColor = safeColor(value, defaultColor)

  const [hue, setHue] = useState(seedColor.hue())
  const [saturation, setSaturation] = useState(seedColor.saturationl())
  const [lightness, setLightness] = useState(seedColor.lightness())
  const [alpha, setAlpha] = useState(seedColor.alpha() * 100)
  const [mode, setMode] = useState('hex')

  // True when the next state commit originated from a user interaction (the
  // wrapped setters below), false when it came from an external `value` sync.
  // Suppresses the round-trip onChange that would otherwise fire whenever the
  // parent re-feeds its own value back in (mount, controlled prop changes).
  const shouldNotify = useRef(false)

  // Update color when controlled value changes
  useEffect(() => {
    if (value === undefined) return
    let next: ReturnType<typeof Color>
    try {
      next = Color(value)
    } catch {
      return
    }
    shouldNotify.current = false
    const [h, s, l] = next.hsl().array()

    setHue(h)
    setSaturation(s)
    setLightness(l)
    setAlpha(next.alpha() * 100)
  }, [value])

  // Notify parent only when the change originated from a setter wrapper. React
  // batches multiple setX calls inside one event handler (e.g. ColorPickerSelection's
  // sat+light pair) into a single re-render, so this fires exactly once per
  // user interaction tick.
  useEffect(() => {
    if (!shouldNotify.current) return
    shouldNotify.current = false
    if (onChange) {
      const color = Color.hsl(hue, saturation, lightness).alpha(alpha / 100)
      const rgba = color.rgb().array()

      onChange([rgba[0], rgba[1], rgba[2], alpha / 100])
    }
  }, [hue, saturation, lightness, alpha, onChange])

  const notifyHue = useCallback((h: number) => {
    shouldNotify.current = true
    setHue(h)
  }, [])
  const notifySaturation = useCallback((s: number) => {
    shouldNotify.current = true
    setSaturation(s)
  }, [])
  const notifyLightness = useCallback((l: number) => {
    shouldNotify.current = true
    setLightness(l)
  }, [])
  const notifyAlpha = useCallback((a: number) => {
    shouldNotify.current = true
    setAlpha(a)
  }, [])

  return (
    <ColorPickerContext
      value={{
        hue,
        saturation,
        lightness,
        alpha,
        mode,
        setHue: notifyHue,
        setSaturation: notifySaturation,
        setLightness: notifyLightness,
        setAlpha: notifyAlpha,
        setMode
      }}>
      <div className={cn('flex size-full flex-col gap-4', className)} {...props} />
    </ColorPickerContext>
  )
}

export type ColorPickerSelectionProps = HTMLAttributes<HTMLDivElement>

export const ColorPickerSelection = memo(({ className, ...props }: ColorPickerSelectionProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [positionX, setPositionX] = useState(0)
  const [positionY, setPositionY] = useState(0)
  const { hue, setSaturation, setLightness } = useColorPicker()

  const backgroundGradient = useMemo(() => {
    return `linear-gradient(0deg, rgba(0,0,0,1), rgba(0,0,0,0)),
            linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0)),
            hsl(${hue}, 100%, 50%)`
  }, [hue])

  const commitFromEvent = useCallback(
    (event: PointerEvent) => {
      if (!containerRef.current) {
        return
      }
      const rect = containerRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      setPositionX(x)
      setPositionY(y)
      setSaturation(x * 100)
      const topLightness = x < 0.01 ? 100 : 50 + 50 * (1 - x)
      const lightness = topLightness * (1 - y)

      setLightness(lightness)
    },
    [setSaturation, setLightness]
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!isDragging) {
        return
      }
      commitFromEvent(event)
    },
    [isDragging, commitFromEvent]
  )

  useEffect(() => {
    const handlePointerUp = () => setIsDragging(false)

    if (isDragging) {
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [isDragging, handlePointerMove])

  return (
    <div
      className={cn('relative size-full cursor-crosshair rounded', className)}
      onPointerDown={(e) => {
        e.preventDefault()
        setIsDragging(true)
        commitFromEvent(e.nativeEvent)
      }}
      ref={containerRef}
      style={{
        background: backgroundGradient
      }}
      {...props}>
      <div
        className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white"
        style={{
          left: `${positionX * 100}%`,
          top: `${positionY * 100}%`,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.5)'
        }}
      />
    </div>
  )
})

ColorPickerSelection.displayName = 'ColorPickerSelection'

export type ColorPickerHueProps = ComponentProps<typeof SliderPrimitive.Root>

export const ColorPickerHue = ({ className, 'aria-label': ariaLabel, ...props }: ColorPickerHueProps) => {
  const { hue, setHue } = useColorPicker()

  return (
    <SliderPrimitive.Root
      className={cn('relative flex h-4 w-full touch-none', className)}
      max={360}
      onValueChange={([hue]) => setHue(hue)}
      step={1}
      value={[hue]}
      aria-label={ariaLabel ?? 'Hue'}
      {...props}>
      <SliderPrimitive.Track className="relative my-0.5 h-3 w-full grow rounded-full bg-[linear-gradient(90deg,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)]">
        <SliderPrimitive.Range className="absolute h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  )
}

export type ColorPickerAlphaProps = ComponentProps<typeof SliderPrimitive.Root>

export const ColorPickerAlpha = ({ className, 'aria-label': ariaLabel, ...props }: ColorPickerAlphaProps) => {
  const { alpha, setAlpha } = useColorPicker()

  return (
    <SliderPrimitive.Root
      className={cn('relative flex h-4 w-full touch-none', className)}
      max={100}
      onValueChange={([alpha]) => setAlpha(alpha)}
      step={1}
      value={[alpha]}
      aria-label={ariaLabel ?? 'Alpha'}
      {...props}>
      <SliderPrimitive.Track className="relative my-0.5 h-3 w-full grow rounded-full bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyRCgLaBCAAgXwixzAS0pgAAAABJRU5ErkJggg==')] bg-center bg-repeat-x dark:bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALklEQVR4nGP8+vWrCAMewM3N/QafPBM+SWLAqAGDwQBGQgoIpZOB98KoAVQwAADxzQcSVIRCfQAAAABJRU5ErkJggg==')]">
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent to-black/50 dark:to-white/50" />
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-transparent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  )
}

export type ColorPickerEyeDropperProps = ComponentProps<typeof Button>

export const ColorPickerEyeDropper = ({ className, ...props }: ColorPickerEyeDropperProps) => {
  const { setHue, setSaturation, setLightness, setAlpha } = useColorPicker()

  // EyeDropper is a Chromium-only experimental API. Renders nothing on browsers
  // that don't expose it (the button would otherwise be a silent no-op).
  const isSupported = typeof window !== 'undefined' && 'EyeDropper' in window
  if (!isSupported) return null

  const handleEyeDropper = async () => {
    try {
      // @ts-expect-error - EyeDropper API is experimental
      const eyeDropper = new EyeDropper()
      const result = await eyeDropper.open()
      const color = Color(result.sRGBHex)
      const [h, s, l] = color.hsl().array()

      setHue(h)
      setSaturation(s)
      setLightness(l)
      setAlpha(100)
    } catch {
      // EyeDropper throws when the user cancels — nothing to do
    }
  }

  return (
    <Button
      className={cn('shrink-0 text-muted-foreground', className)}
      onClick={handleEyeDropper}
      size="icon"
      type="button"
      variant="outline"
      aria-label="Pick color from screen"
      {...props}>
      <PipetteIcon size={16} />
    </Button>
  )
}

export type ColorPickerOutputProps = ComponentProps<typeof SelectTrigger>

const formats = ['hex', 'rgb', 'css', 'hsl']

export const ColorPickerOutput = ({ className, ...props }: ColorPickerOutputProps) => {
  const { mode, setMode } = useColorPicker()

  return (
    <Select onValueChange={setMode} value={mode}>
      <SelectTrigger className={cn('h-8 w-20 shrink-0 text-xs', className)} {...props}>
        <SelectValue placeholder="Mode" />
      </SelectTrigger>
      <SelectContent>
        {formats.map((format) => (
          <SelectItem className="text-xs" key={format} value={format}>
            {format.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type PercentageInputProps = ComponentProps<typeof Input>

const PercentageInput = ({ className, ...props }: PercentageInputProps) => {
  return (
    <div className="relative">
      <Input
        readOnly
        type="text"
        {...props}
        className={cn('h-8 w-[3.25rem] rounded-l-none bg-secondary px-2 text-xs shadow-none', className)}
      />
      <span className="-translate-y-1/2 absolute top-1/2 right-2 text-muted-foreground text-xs">%</span>
    </div>
  )
}

export type ColorPickerFormatProps = HTMLAttributes<HTMLDivElement>

export const ColorPickerFormat = ({ className, ...props }: ColorPickerFormatProps) => {
  const { hue, saturation, lightness, alpha, mode } = useColorPicker()
  const color = Color.hsl(hue, saturation, lightness).alpha(alpha / 100)

  if (mode === 'hex') {
    const hex = color.hex()

    return (
      <div className={cn('-space-x-px relative flex w-full items-center rounded-md shadow-sm', className)} {...props}>
        <Input className="h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none" readOnly type="text" value={hex} />
        <PercentageInput value={alpha} />
      </div>
    )
  }

  if (mode === 'rgb') {
    const rgb = color
      .rgb()
      .array()
      .map((value) => Math.round(value))

    return (
      <div className={cn('-space-x-px flex items-center rounded-md shadow-sm', className)} {...props}>
        {rgb.map((value, index) => (
          <Input
            className={cn('h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none', index && 'rounded-l-none')}
            key={index}
            readOnly
            type="text"
            value={value}
          />
        ))}
        <PercentageInput value={alpha} />
      </div>
    )
  }

  if (mode === 'css') {
    const rgb = color
      .rgb()
      .array()
      .map((value) => Math.round(value))

    return (
      <div className={cn('w-full rounded-md shadow-sm', className)} {...props}>
        <Input
          className="h-8 w-full bg-secondary px-2 text-xs shadow-none"
          readOnly
          type="text"
          value={`rgba(${rgb.join(', ')}, ${alpha}%)`}
        />
      </div>
    )
  }

  if (mode === 'hsl') {
    const hsl = color
      .hsl()
      .array()
      .map((value) => Math.round(value))

    return (
      <div className={cn('-space-x-px flex items-center rounded-md shadow-sm', className)} {...props}>
        {hsl.map((value, index) => (
          <Input
            className={cn('h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none', index && 'rounded-l-none')}
            key={index}
            readOnly
            type="text"
            value={value}
          />
        ))}
        <PercentageInput value={alpha} />
      </div>
    )
  }

  return null
}
