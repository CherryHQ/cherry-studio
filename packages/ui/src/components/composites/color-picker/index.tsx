// Vendored from Kibo UI (https://www.kibo-ui.com/components/color-picker), adapted to
// @cherrystudio/ui import paths.
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
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

type ColorChannels = {
  hue: number
  saturation: number
  brightness: number
  alpha: number
}

type ColorPickerContextValue = ColorChannels & {
  mode: string
  setHue: (hue: number) => void
  setSaturation: (saturation: number) => void
  setBrightness: (brightness: number) => void
  setAlpha: (alpha: number) => void
  setMode: (mode: string) => void
  updateColor: (channels: Partial<ColorChannels>) => void
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

// Percent-granularity alpha matches the 0–100 step of the alpha slider; rounded
// RGB matches the integer contract of the onChange tuple.
const rgbaKey = (color: ReturnType<typeof Color>): string => {
  const [r, g, b] = color.rgb().array()
  return `${Math.round(r)},${Math.round(g)},${Math.round(b)}/${Math.round(color.alpha() * 100)}`
}

const colorToChannels = (color: ReturnType<typeof Color>): ColorChannels => {
  const [hue, saturation, brightness] = color.hsv().array()
  return { hue, saturation, brightness, alpha: color.alpha() * 100 }
}

const channelsToColor = ({ hue, saturation, brightness, alpha }: ColorChannels): ReturnType<typeof Color> =>
  Color.hsv(hue, saturation, brightness).alpha(alpha / 100)

export const ColorPicker = ({ value, defaultValue = '#000000', onChange, className, ...props }: ColorPickerProps) => {
  const makeSeed = () => safeColor(value, safeColor(defaultValue, Color('#000000')))

  const [channels, setChannels] = useState(() => colorToChannels(makeSeed()))
  const channelsRef = useRef(channels)
  const [mode, setMode] = useState('hex')

  const updateColor = useCallback(
    (partial: Partial<ColorChannels>) => {
      const current = channelsRef.current
      const next = { ...current, ...partial }
      if (
        current.hue === next.hue &&
        current.saturation === next.saturation &&
        current.brightness === next.brightness &&
        current.alpha === next.alpha
      ) {
        return
      }

      const currentColor = channelsToColor(current)
      const nextColor = channelsToColor(next)
      channelsRef.current = next
      setChannels(next)

      if (onChange && rgbaKey(currentColor) !== rgbaKey(nextColor)) {
        const [red, green, blue] = nextColor.rgb().array()
        onChange([Math.round(red), Math.round(green), Math.round(blue), next.alpha / 100])
      }
    },
    [onChange]
  )

  // Controlled mode: resync internal HSV state whenever it stops representing
  // `value` — that covers external value changes AND rejected/debounced changes,
  // where onChange fired but the parent kept the old value. Comparing at the
  // rounded rgba level preserves hue/saturation through degenerate colors.
  useEffect(() => {
    if (value === undefined) return
    let next: ReturnType<typeof Color>
    try {
      next = Color(value)
    } catch {
      return
    }
    const internal = channelsToColor(channels)
    if (rgbaKey(internal) === rgbaKey(next)) return
    const nextChannels = colorToChannels(next)
    channelsRef.current = nextChannels
    setChannels(nextChannels)
  }, [value, channels])

  const setHue = useCallback((hue: number) => updateColor({ hue }), [updateColor])
  const setSaturation = useCallback((saturation: number) => updateColor({ saturation }), [updateColor])
  const setBrightness = useCallback((brightness: number) => updateColor({ brightness }), [updateColor])
  const setAlpha = useCallback((alpha: number) => updateColor({ alpha }), [updateColor])

  const contextValue = useMemo(
    () => ({
      ...channels,
      mode,
      setHue,
      setSaturation,
      setBrightness,
      setAlpha,
      setMode,
      updateColor
    }),
    [channels, mode, setHue, setSaturation, setBrightness, setAlpha, updateColor]
  )

  return (
    <ColorPickerContext value={contextValue}>
      <div className={cn('flex size-full flex-col gap-4', className)} {...props} />
    </ColorPickerContext>
  )
}

export type ColorPickerSelectionProps = HTMLAttributes<HTMLDivElement>

export const ColorPickerSelection = memo(
  ({ className, 'aria-label': ariaLabel, ...props }: ColorPickerSelectionProps) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    const { hue, saturation, brightness, updateColor } = useColorPicker()

    const positionX = saturation / 100
    const positionY = 1 - brightness / 100

    const backgroundGradient = useMemo(() => {
      return `linear-gradient(0deg, rgba(0,0,0,1), rgba(0,0,0,0)),
            linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0)),
            hsl(${hue}, 100%, 50%)`
    }, [hue])

    const commitFromPosition = useCallback(
      (x: number, y: number) => {
        const cx = Math.max(0, Math.min(1, x))
        const cy = Math.max(0, Math.min(1, y))
        updateColor({ saturation: cx * 100, brightness: (1 - cy) * 100 })
      },
      [updateColor]
    )

    const commitFromEvent = useCallback(
      (event: PointerEvent) => {
        if (!containerRef.current) {
          return
        }
        const rect = containerRef.current.getBoundingClientRect()
        commitFromPosition((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
      },
      [commitFromPosition]
    )

    // Arrow keys move the 2D plane marker; Shift uses a larger step.
    const handleKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 0.1 : 0.01
        let nextX = positionX
        let nextY = positionY
        switch (event.key) {
          case 'ArrowLeft':
            nextX -= step
            break
          case 'ArrowRight':
            nextX += step
            break
          case 'ArrowUp':
            nextY -= step
            break
          case 'ArrowDown':
            nextY += step
            break
          default:
            return
        }
        event.preventDefault()
        commitFromPosition(nextX, nextY)
      },
      [positionX, positionY, commitFromPosition]
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
        window.addEventListener('pointercancel', handlePointerUp)
      }

      return () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }
    }, [isDragging, handlePointerMove])

    return (
      <div
        className={cn(
          'relative size-full cursor-crosshair touch-none rounded outline-none focus-visible:ring-[1px] focus-visible:ring-ring/35',
          className
        )}
        tabIndex={0}
        role="slider"
        aria-label={ariaLabel ?? 'Color saturation and brightness'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(saturation)}
        aria-valuetext={`Saturation ${Math.round(saturation)}%, brightness ${Math.round(brightness)}%`}
        onKeyDown={handleKeyDown}
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
  }
)

ColorPickerSelection.displayName = 'ColorPickerSelection'

type ContextOwnedSliderProps = 'defaultValue' | 'max' | 'onValueChange' | 'step' | 'value'

export type ColorPickerHueProps = Omit<ComponentProps<typeof SliderPrimitive.Root>, ContextOwnedSliderProps>

export const ColorPickerHue = ({ className, 'aria-label': ariaLabel, ...props }: ColorPickerHueProps) => {
  const { hue, setHue } = useColorPicker()

  return (
    // Pass-through props are spread first: value/onValueChange (and the slider
    // geometry) are owned by the picker context and must not be overridable.
    <SliderPrimitive.Root
      {...props}
      className={cn('relative flex h-4 w-full touch-none', className)}
      max={360}
      onValueChange={([hue]) => setHue(hue)}
      step={1}
      value={[hue]}
      aria-label={ariaLabel ?? 'Hue'}>
      <SliderPrimitive.Track className="relative my-0.5 h-3 w-full grow rounded-full bg-[linear-gradient(90deg,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)]">
        <SliderPrimitive.Range className="absolute h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  )
}

export type ColorPickerAlphaProps = Omit<ComponentProps<typeof SliderPrimitive.Root>, ContextOwnedSliderProps>

const alphaBackgroundLight =
  "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyRCgLaBCAAgXwixzAS0pgAAAABJRU5ErkJggg==')"
const alphaBackgroundDark =
  "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALklEQVR4nGP8+vWrCAMewM3N/QafPBM+SWLAqAGDwQBGQgoIpZOB98KoAVQwAADxzQcSVIRCfQAAAABJRU5ErkJggg==')"

export const ColorPickerAlpha = ({ className, 'aria-label': ariaLabel, ...props }: ColorPickerAlphaProps) => {
  const { alpha, setAlpha } = useColorPicker()

  return (
    // Pass-through props are spread first: value/onValueChange (and the slider
    // geometry) are owned by the picker context and must not be overridable.
    <SliderPrimitive.Root
      {...props}
      className={cn('relative flex h-4 w-full touch-none', className)}
      max={100}
      onValueChange={([alpha]) => setAlpha(alpha)}
      step={1}
      value={[alpha]}
      aria-label={ariaLabel ?? 'Alpha'}>
      <SliderPrimitive.Track className="relative my-0.5 h-3 w-full grow overflow-hidden rounded-full">
        <div
          className="pointer-events-none absolute inset-0 bg-center bg-repeat-x dark:hidden"
          style={{ backgroundImage: alphaBackgroundLight }}
        />
        <div
          className="pointer-events-none absolute inset-0 hidden bg-center bg-repeat-x dark:block"
          style={{ backgroundImage: alphaBackgroundDark }}
        />
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent to-black/50 dark:to-white/50" />
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-transparent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  )
}

export type ColorPickerEyeDropperProps = ComponentProps<typeof Button>

export const ColorPickerEyeDropper = ({ className, ...props }: ColorPickerEyeDropperProps) => {
  const { updateColor } = useColorPicker()

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
      const [hue, saturation, brightness] = color.hsv().array()

      updateColor({ hue, saturation, brightness, alpha: 100 })
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
        aria-label="Alpha percentage"
        {...props}
        className={cn('h-8 w-[3.25rem] rounded-l-none bg-secondary px-2 text-xs shadow-none', className)}
      />
      <span className="-translate-y-1/2 absolute top-1/2 right-2 text-muted-foreground text-xs">%</span>
    </div>
  )
}

const RGB_CHANNEL_LABELS = ['Red value', 'Green value', 'Blue value']
const HSL_CHANNEL_LABELS = ['Hue value', 'Saturation value', 'Lightness value']

export type ColorPickerFormatProps = HTMLAttributes<HTMLDivElement>

export const ColorPickerFormat = ({ className, ...props }: ColorPickerFormatProps) => {
  const { hue, saturation, brightness, alpha, mode } = useColorPicker()
  const color = Color.hsv(hue, saturation, brightness).alpha(alpha / 100)

  if (mode === 'hex') {
    const hex = color.hex()

    return (
      <div className={cn('-space-x-px relative flex w-full items-center rounded-md shadow-sm', className)} {...props}>
        <Input
          aria-label="Hex color value"
          className="h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none"
          readOnly
          type="text"
          value={hex}
        />
        <PercentageInput value={alpha} />
      </div>
    )
  }

  if (mode === 'rgb') {
    // color's .array() appends alpha as a 4th element when alpha < 1; the
    // readouts only show the 3 channels (alpha has its own field).
    const rgb = color
      .rgb()
      .array()
      .slice(0, 3)
      .map((value) => Math.round(value))

    return (
      <div className={cn('-space-x-px flex items-center rounded-md shadow-sm', className)} {...props}>
        {rgb.map((value, index) => (
          <Input
            aria-label={RGB_CHANNEL_LABELS[index]}
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
      .slice(0, 3)
      .map((value) => Math.round(value))

    return (
      <div className={cn('w-full rounded-md shadow-sm', className)} {...props}>
        <Input
          aria-label="CSS color value"
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
      .slice(0, 3)
      .map((value) => Math.round(value))

    return (
      <div className={cn('-space-x-px flex items-center rounded-md shadow-sm', className)} {...props}>
        {hsl.map((value, index) => (
          <Input
            aria-label={HSL_CHANNEL_LABELS[index]}
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
