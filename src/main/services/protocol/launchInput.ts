import { fileURLToPath } from 'node:url'

export type LaunchInput = { kind: 'protocol'; url: string } | { kind: 'folder'; operand: string }

export function parseLaunchInput(argv: readonly string[], defaultApp: boolean): LaunchInput | undefined {
  const args = argv.slice(defaultApp ? 2 : 1)
  const url = args.find((arg) => arg.startsWith('cherrystudio://'))
  if (url) return { kind: 'protocol', url }

  let afterDelimiter = false
  let skipSwitchValue = false
  for (const arg of args) {
    if (!afterDelimiter && arg === '--') {
      afterDelimiter = true
      skipSwitchValue = false
      continue
    }
    if (!afterDelimiter && arg.startsWith('-')) {
      // Unknown switches may consume a separate value; require -- to disambiguate.
      skipSwitchValue = !arg.includes('=')
      continue
    }
    if (skipSwitchValue) {
      skipSwitchValue = false
      continue
    }

    let operand = arg
    if (arg.startsWith('file://')) {
      try {
        operand = fileURLToPath(arg)
      } catch {
        // Keep the first operand invalid instead of falling back to another folder.
      }
    }
    return { kind: 'folder', operand }
  }
  return undefined
}
