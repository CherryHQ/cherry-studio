export function isContextOverflowMessage(message: string): boolean {
  const msg = message.toLowerCase()
  return (
    /context[_ ]length[_ ]exceeded/.test(msg) ||
    msg.includes('model_context_window_exceeded') ||
    msg.includes('too many tokens') ||
    (msg.includes('maximum context length') &&
      /exceed|too (?:long|large)|requested|maximum context length is [\d,]+ tokens/.test(msg)) ||
    (msg.includes('context window') && /exceed|too (?:long|large)|requested/.test(msg)) ||
    /prompt (?:is )?too long/.test(msg) ||
    msg.includes('input exceeds the context limit') ||
    (msg.includes('input is too long') && /model|context|token/.test(msg)) ||
    /input.{0,80}(?:longer than|exceeds).{0,80}context length/.test(msg) ||
    /input token count.*exceeds the maximum/.test(msg) ||
    /(?:exceed|too (?:long|large)).*(?:maximum context length|context window)/.test(msg)
  )
}
