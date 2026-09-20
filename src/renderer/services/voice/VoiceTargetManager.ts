export interface VoiceReplaceRange {
  readonly from: number
  readonly to: number
}

export interface VoiceTargetRegistration {
  readonly targetId: string
  readonly owner: Window
  readonly sourceEntityId: string
  readonly captureReplaceRange: () => VoiceReplaceRange | null
  readonly replaceRange: (range: VoiceReplaceRange, text: string) => boolean
}

export interface CapturedVoiceTarget {
  readonly targetId: string
  readonly owner: Window
  readonly sourceEntityId: string
  readonly replaceRange: VoiceReplaceRange
  readonly bindingToken: symbol
}

export type VoiceTargetInsertResult = 'inserted' | 'unavailable'

interface RegisteredVoiceTarget extends VoiceTargetRegistration {
  readonly bindingToken: symbol
}

function captureRange(target: RegisteredVoiceTarget): VoiceReplaceRange | null {
  const range = target.captureReplaceRange()
  if (
    !range ||
    !Number.isInteger(range.from) ||
    !Number.isInteger(range.to) ||
    range.from < 0 ||
    range.to < range.from
  ) {
    return null
  }
  return Object.freeze({ from: range.from, to: range.to })
}

export class VoiceTargetManager {
  private readonly targets = new Map<string, RegisteredVoiceTarget>()
  private current?: RegisteredVoiceTarget

  bind(registration: VoiceTargetRegistration): () => void {
    const previous = this.targets.get(registration.targetId)
    if (this.current === previous) this.current = undefined

    const target: RegisteredVoiceTarget = { ...registration, bindingToken: Symbol(registration.targetId) }
    this.targets.set(target.targetId, target)

    return () => {
      if (this.targets.get(target.targetId) !== target) return
      this.remove(target)
    }
  }

  unbind(targetId: string): void {
    const target = this.targets.get(targetId)
    if (target) this.remove(target)
  }

  markCurrent(targetId: string): boolean {
    const target = this.targets.get(targetId)
    if (!target || target.owner.closed) {
      if (this.current?.targetId === targetId) this.current = undefined
      return false
    }
    this.current = target
    return true
  }

  captureCurrent(): CapturedVoiceTarget | null {
    const target = this.current
    if (!target || this.targets.get(target.targetId) !== target || target.owner.closed) return null
    const replaceRange = captureRange(target)
    if (!replaceRange) return null
    return Object.freeze({
      targetId: target.targetId,
      owner: target.owner,
      sourceEntityId: target.sourceEntityId,
      replaceRange,
      bindingToken: target.bindingToken
    })
  }

  insert(binding: CapturedVoiceTarget, text: string): VoiceTargetInsertResult {
    const target = this.targets.get(binding.targetId)
    if (
      !target ||
      target.bindingToken !== binding.bindingToken ||
      target.owner !== binding.owner ||
      target.sourceEntityId !== binding.sourceEntityId ||
      target.owner.closed
    ) {
      return 'unavailable'
    }
    return target.replaceRange(binding.replaceRange, text) ? 'inserted' : 'unavailable'
  }

  insertIntoCurrent(text: string): VoiceTargetInsertResult {
    const binding = this.captureCurrent()
    return binding ? this.insert(binding, text) : 'unavailable'
  }

  private remove(target: RegisteredVoiceTarget): void {
    this.targets.delete(target.targetId)
    if (this.current === target) this.current = undefined
  }
}

export const voiceTargetManager = new VoiceTargetManager()
