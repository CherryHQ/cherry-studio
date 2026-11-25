import { loggerService } from '@logger'

const logger = loggerService.withContext('CompletionSound')

/** Main selects a single renderer; audio failure never interrupts notification delivery. */
export function playCompletionSound(): void {
  let context: AudioContext | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  const close = () => {
    clearTimeout(closeTimer)
    if (context && context.state !== 'closed') {
      void context.close().catch((error) => logger.error('Failed to close completion audio', error as Error))
    }
  }
  try {
    context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = context.currentTime
    oscillator.frequency.setValueAtTime(660, start)
    oscillator.frequency.setValueAtTime(880, start + 0.12)
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.08, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.onended = close
    oscillator.start(start)
    oscillator.stop(start + 0.32)
    closeTimer = setTimeout(close, 2000)
    void context.resume().catch((error) => {
      logger.error('Failed to play completion sound', error as Error)
      close()
    })
  } catch (error) {
    logger.error('Failed to create completion audio', error as Error)
    close()
  }
}
