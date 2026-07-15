export type SpeechSynthesisControllerState = {
  readonly messageId?: string
  readonly isSpeaking: boolean
}

type SpeechSynthesisControllerOptions = {
  readonly onStateChange: (state: SpeechSynthesisControllerState) => void
}

export const createSpeechSynthesisController = ({ onStateChange }: SpeechSynthesisControllerOptions) => {
  const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis
  const isSupported = Boolean(synth && typeof SpeechSynthesisUtterance !== 'undefined')
  let currentMessageId: string | undefined
  let currentUtterance: SpeechSynthesisUtterance | undefined

  const notify = () => onStateChange({ messageId: currentMessageId, isSpeaking: Boolean(currentUtterance) })

  const reset = (utterance: SpeechSynthesisUtterance) => {
    if (currentUtterance !== utterance) return
    currentUtterance = undefined
    currentMessageId = undefined
    notify()
  }

  const stop = () => {
    if (!synth) return
    currentUtterance = undefined
    currentMessageId = undefined
    synth.cancel()
    notify()
  }

  const speak = (messageId: string, text: string, language: string) => {
    if (!synth || !isSupported) return false

    const speechText = text.trim()
    if (!speechText) return false

    if (currentMessageId === messageId && currentUtterance) {
      stop()
      return true
    }

    stop()
    const utterance = new SpeechSynthesisUtterance(speechText)
    utterance.lang = language
    utterance.onend = () => reset(utterance)
    utterance.onerror = () => reset(utterance)
    currentMessageId = messageId
    currentUtterance = utterance
    notify()
    synth.speak(utterance)
    return true
  }

  return {
    isSupported,
    speak,
    stop
  }
}
