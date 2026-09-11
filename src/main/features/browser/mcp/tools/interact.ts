import * as z from 'zod'

import { selectOption } from '../../actions/forms'
import { pressKey, typeText } from '../../actions/keyboard'
import { click, hover, scroll } from '../../actions/mouse'
import { settleAction } from '../../actions/settle'
import { browserRefSchema, type CommandOptions } from '../../browserUse'
import type { GuestSession } from '../../session/GuestSession'
import type { CdpBrowserController } from '../controller'
import { browserResult } from './result'
import { targetShape } from './snapshot'

const refShape = { ...targetShape, ref: browserRefSchema }
export const interactionSchemas = {
  click: z.strictObject({
    ...refShape,
    button: z.enum(['left', 'right', 'middle']).default('left'),
    clickCount: z.union([z.literal(1), z.literal(2)]).default(1)
  }),
  hover: z.strictObject(refShape),
  scroll: z.strictObject({
    ...targetShape,
    ref: browserRefSchema.optional(),
    pages: z.number().min(-100).max(100).default(1)
  }),
  type: z.strictObject({
    ...refShape,
    text: z.string().max(40_000),
    clear: z.boolean().default(false),
    submit: z.boolean().default(false)
  }),
  press_key: z.strictObject({ ...targetShape, key: z.string().min(1).max(80) }),
  select_option: z.strictObject({ ...refShape, values: z.array(z.string()).max(100) })
}
const descriptions: Record<keyof typeof interactionSchemas, string> = {
  click:
    'Click a snapshot ref using mouse input. A covered left single click uses a reported synthetic fallback; other covered clicks fail.',
  hover: 'Move the pointer onto a snapshot ref and observe the resulting changes.',
  scroll: 'Scroll by viewport pages, optionally over a ref. Negative pages scroll up.',
  type: 'Type into an editable ref with input events and read-back verification. clear replaces the existing value; submit presses Enter.',
  press_key: 'Press a key or chord, such as Enter, Control+a, Meta+a, Shift+Tab or ArrowDown.',
  select_option:
    'Select native select options by value, then label. Unknown or disabled options fail without changing selection.'
}
export const interactionToolDefinitions = Object.entries(interactionSchemas).map(([name, schema]) => ({
  name,
  description: descriptions[name as keyof typeof interactionSchemas],
  inputSchema: schema
}))

export async function handleInteraction(
  name: keyof typeof interactionSchemas,
  controller: CdpBrowserController,
  args: unknown,
  signal?: AbortSignal
) {
  const input = interactionSchemas[name].parse(args)
  return browserResult(controller, input, signal, async (session, options) => {
    const act = async (session: GuestSession, options: CommandOptions) => {
      switch (name) {
        case 'click': {
          const p = interactionSchemas.click.parse(input)
          return click(session, p.ref, p.button, p.clickCount, options)
        }
        case 'hover':
          return hover(session, interactionSchemas.hover.parse(input).ref, options)
        case 'scroll': {
          const p = interactionSchemas.scroll.parse(input)
          return scroll(session, p.ref, p.pages, options)
        }
        case 'type': {
          const p = interactionSchemas.type.parse(input)
          return typeText(session, p.ref, p.text, p.clear, p.submit, options)
        }
        case 'press_key':
          return pressKey(session, interactionSchemas.press_key.parse(input).key, options)
        case 'select_option': {
          const p = interactionSchemas.select_option.parse(input)
          return selectOption(session, p.ref, p.values, options)
        }
      }
    }
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true }, options)
    const { value, navigated } = await settleAction(session, () => act(session, options), options)
    return { ...value, navigated, snapshot: (await session.snapshot({}, options)).text }
  })
}
