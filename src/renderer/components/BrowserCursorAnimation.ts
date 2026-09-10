class Spring {
  value: number
  target: number
  velocity = 0

  constructor(
    value: number,
    public response = 0.13,
    private readonly dampingFraction = 0.85,
    private readonly precision = 0.001
  ) {
    this.value = this.target = value
  }

  snap(value: number): void {
    this.value = this.target = value
    this.velocity = 0
  }

  get settled(): boolean {
    return Math.abs(this.value - this.target) < this.precision && Math.abs(this.velocity) < this.precision * 20
  }

  step(seconds: number): void {
    // Integrate the damped oscillator analytically so dropped frames cannot destabilize it.
    const omega = (2 * Math.PI) / this.response
    const decay = this.dampingFraction * omega
    const frequency = omega * Math.sqrt(1 - this.dampingFraction ** 2)
    const offset = this.value - this.target
    const amplitude = (this.velocity + decay * offset) / frequency
    const sin = Math.sin(frequency * seconds)
    const cos = Math.cos(frequency * seconds)
    const envelope = Math.exp(-decay * seconds)
    this.value = this.target + envelope * (offset * cos + amplitude * sin)
    this.velocity =
      envelope * ((amplitude * frequency - decay * offset) * cos - (offset * frequency + decay * amplitude) * sin)
    if (this.settled) this.snap(this.target)
  }
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max))

export class BrowserCursorAnimation {
  private readonly springs = {
    x: new Spring(0, 0.1, 0.85, 0.1),
    y: new Spring(0, 0.1, 0.85, 0.1),
    heading: new Spring(0),
    stretch: new Spring(0),
    scoot: new Spring(0, 0.15),
    rotation: new Spring(0, 0.17),
    visibility: new Spring(0),
    progress: new Spring(1, 0.1, 0.85, 0.0001)
  }
  private frame?: number
  private lastFrame = 0
  private idleTimer?: ReturnType<typeof setTimeout>
  private idleStart?: number
  private positioned = false
  private moving = false
  private reducedMotion = false
  private width = 0
  private height = 0
  private start = { x: 0, y: 0 }
  private target = { x: 0, y: 0 }
  private distance = 0
  private direction = 0
  private curved = false

  constructor(
    private readonly position: HTMLElement,
    private readonly sprite: HTMLElement,
    private readonly onArrived: () => void
  ) {}

  move(
    x: number,
    y: number,
    width: number,
    height: number,
    animate: boolean,
    reducedMotion: boolean,
    pressed: boolean
  ): void {
    this.cancelIdle()
    this.lastFrame = performance.now()
    this.width = width
    this.height = height
    this.reducedMotion = reducedMotion
    this.start = { x: this.springs.x.value, y: this.springs.y.value }
    this.target = { x: clamp(x, width), y: clamp(y, height) }
    const dx = this.target.x - this.start.x
    const dy = this.target.y - this.start.y
    this.distance = Math.hypot(dx, dy)
    this.direction = Math.atan2(dy, dx) + Math.PI / 2
    this.curved = this.distance > 120
    this.springs.visibility.target = 1
    this.springs.rotation.snap(0)
    this.springs.heading.target = 0
    this.springs.stretch.target = 0
    this.springs.scoot.target = 0
    this.springs.progress.snap(0)
    this.springs.progress.target = 1
    this.springs.progress.response = Math.max(0.075, 0.12 - this.distance / 40000)
    this.springs.x.target = this.target.x
    this.springs.y.target = this.target.y
    this.moving = true
    if (!this.positioned || !animate || reducedMotion || this.distance < 0.5) {
      this.snapPosition()
      if (reducedMotion) {
        for (const spring of Object.values(this.springs)) spring.snap(spring.target)
      }
      this.render()
      this.arrive()
    }
    this.positioned = true
    if (pressed && !reducedMotion) this.springs.scoot.snap(-0.04)
    this.springs.scoot.target = 0
    this.wake()
  }

  hide(immediate = false): void {
    this.cancelIdle()
    this.moving = false
    this.snapPosition()
    this.springs.visibility.target = 0
    this.springs.heading.target =
      this.springs.stretch.target =
      this.springs.scoot.target =
      this.springs.rotation.target =
        0
    if (immediate || this.reducedMotion) {
      if (this.frame !== undefined) cancelAnimationFrame(this.frame)
      this.frame = undefined
      for (const spring of Object.values(this.springs)) spring.snap(spring.target)
      this.render()
    } else this.wake()
  }

  dispose(): void {
    this.hide(true)
  }

  private snapPosition(): void {
    this.springs.x.snap(this.target.x)
    this.springs.y.snap(this.target.y)
    this.springs.progress.snap(1)
  }

  private cancelIdle(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    this.idleStart = undefined
  }

  private arrive(): void {
    this.moving = false
    this.snapPosition()
    this.render()
    this.onArrived()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      if (this.reducedMotion) {
        this.hide(true)
        return
      }
      this.idleStart = performance.now()
      this.wake()
    }, 450)
  }

  private wake(): void {
    if (this.frame !== undefined) return
    this.lastFrame = performance.now()
    this.frame = requestAnimationFrame(this.tick)
  }

  private readonly tick = (now: number) => {
    this.frame = undefined
    const seconds = Math.max(0, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    const s = this.springs
    s.progress.step(seconds)
    if (this.moving && this.curved) {
      const p = clamp(s.progress.value, 1)
      const bend = Math.min(80, this.distance * 0.12)
      const normalX = -(this.target.y - this.start.y) / this.distance
      const normalY = (this.target.x - this.start.x) / this.distance
      // Cubic Bezier controls sit at one-third/two-thirds of the chord with a shared normal offset.
      const arc = 3 * p * (1 - p) * bend
      s.x.snap(clamp(this.start.x + (this.target.x - this.start.x) * p + normalX * arc, this.width))
      s.y.snap(clamp(this.start.y + (this.target.y - this.start.y) * p + normalY * arc, this.height))
    } else {
      s.x.step(seconds)
      s.y.step(seconds)
    }
    const envelope = this.moving ? Math.sin(Math.PI * clamp(s.progress.value, 1)) : 0
    s.heading.target = Math.sin(this.direction + Math.PI / 4) * 22 * envelope
    s.stretch.target = this.curved ? envelope * Math.min(0.32, this.distance / 2000) : 0
    s.scoot.target = this.curved ? 0 : envelope * Math.min(0.22, this.distance / 500)
    s.rotation.target = this.curved ? 0 : Math.sin(this.direction) * envelope * 12
    if (this.idleStart !== undefined) {
      const progress = clamp((now - this.idleStart) / 750, 1)
      s.rotation.target = Math.sin(progress * Math.PI * 4) * Math.sin(progress * Math.PI) * 5
      if (progress === 1) {
        this.idleStart = undefined
        s.visibility.target = 0
      }
    }
    for (const spring of [s.heading, s.stretch, s.scoot, s.rotation, s.visibility]) spring.step(seconds)
    this.render()
    if (this.moving && (this.curved ? s.progress.settled : s.x.settled && s.y.settled)) this.arrive()
    if (this.moving || this.idleStart !== undefined || Object.values(s).some((spring) => !spring.settled)) {
      this.frame = requestAnimationFrame(this.tick)
    }
  }

  private render(): void {
    const s = this.springs
    const visible = clamp(s.visibility.value, 1)
    const axis = (this.direction * 180) / Math.PI
    const stretch = 1 + s.stretch.value + s.scoot.value
    this.position.style.transform = `translate3d(${clamp(s.x.value, this.width)}px, ${clamp(s.y.value, this.height)}px, 0)`
    this.position.style.opacity = String(visible)
    this.sprite.style.transform = `rotate(${axis}deg) scale(1, ${stretch}) rotate(${-axis - 44 + s.heading.value + s.rotation.value}deg) scale(${0.7 + visible * 0.3})`
    this.sprite.style.filter = `blur(${(1 - visible) * 2}px) drop-shadow(0 1px 1px color-mix(in srgb, var(--foreground) 20%, transparent)) drop-shadow(0 0 2px color-mix(in srgb, var(--primary) 30%, transparent))`
  }
}
