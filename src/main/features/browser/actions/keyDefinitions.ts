// CDP modifier bits: https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent
export const KeyModifier = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const
export const TEXT_SUPPRESSING_MODIFIERS = KeyModifier.Alt | KeyModifier.Control | KeyModifier.Meta

interface KeyDefinition {
  key: string
  code: string
  windowsVirtualKeyCode: number
  shiftKey?: string
}

// US keyboard mapping; virtual-key codes: https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
const layout: Array<[code: string, virtualKey: number, key?: string, shiftKey?: string]> = [
  ['Enter', 0x0d],
  ['Tab', 0x09],
  ['Escape', 0x1b],
  ['Backspace', 0x08],
  ['Delete', 0x2e],
  ['ArrowLeft', 0x25],
  ['ArrowUp', 0x26],
  ['ArrowRight', 0x27],
  ['ArrowDown', 0x28],
  ['Home', 0x24],
  ['End', 0x23],
  ['PageUp', 0x21],
  ['PageDown', 0x22],
  ['Space', 0x20, ' '],
  ['F1', 0x70],
  ['F2', 0x71],
  ['F3', 0x72],
  ['F4', 0x73],
  ['F5', 0x74],
  ['F6', 0x75],
  ['F7', 0x76],
  ['F8', 0x77],
  ['F9', 0x78],
  ['F10', 0x79],
  ['F11', 0x7a],
  ['F12', 0x7b],
  ['Digit0', 0x30, '0', ')'],
  ['Digit1', 0x31, '1', '!'],
  ['Digit2', 0x32, '2', '@'],
  ['Digit3', 0x33, '3', '#'],
  ['Digit4', 0x34, '4', '$'],
  ['Digit5', 0x35, '5', '%'],
  ['Digit6', 0x36, '6', '^'],
  ['Digit7', 0x37, '7', '&'],
  ['Digit8', 0x38, '8', '*'],
  ['Digit9', 0x39, '9', '('],
  ['Semicolon', 0xba, ';', ':'],
  ['Equal', 0xbb, '=', '+'],
  ['Comma', 0xbc, ',', '<'],
  ['Minus', 0xbd, '-', '_'],
  ['Period', 0xbe, '.', '>'],
  ['Slash', 0xbf, '/', '?'],
  ['Backquote', 0xc0, '`', '~'],
  ['BracketLeft', 0xdb, '[', '{'],
  ['Backslash', 0xdc, '\\', '|'],
  ['BracketRight', 0xdd, ']', '}'],
  ['Quote', 0xde, "'", '"']
]

for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
  const upper = letter.toUpperCase()
  layout.push([`Key${upper}`, upper.charCodeAt(0), letter, upper])
}

const definitions = new Map<string, KeyDefinition>()
for (const [code, windowsVirtualKeyCode, key = code, shiftKey] of layout) {
  const definition = { key, code, windowsVirtualKeyCode, shiftKey }
  definitions.set(code, definition)
  definitions.set(key, definition)
  if (shiftKey) definitions.set(shiftKey, { ...definition, key: shiftKey })
}

export function resolveKeyDefinition(key: string, shift: boolean): KeyDefinition | undefined {
  const definition = definitions.get(key)
  if (definition) return { ...definition, key: shift ? (definition.shiftKey ?? definition.key) : definition.key }
  if ([...key].length === 1) return { key, code: '', windowsVirtualKeyCode: 0 }
  return undefined
}
