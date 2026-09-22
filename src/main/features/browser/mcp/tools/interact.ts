import { interactionSchemas } from '@main/ai/mcp/browserToolDefinitions'

import { selectOption } from '../../actions/forms'
import { pressKey, typeText } from '../../actions/keyboard'
import { click, hover, scroll } from '../../actions/mouse'
import { settleAction } from '../../actions/settle'
import type { BrowserActionOptions } from '../../BrowserCursor'
import type { GuestSession } from '../../session/GuestSession'
import type { BrowserController } from '../browserController'
import { browserResult } from './result'

export async function handleInteraction(
  name: keyof typeof interactionSchemas,
  controller: BrowserController,
  args: unknown,
  signal?: AbortSignal
) {
  const input = interactionSchemas[name].parse(args)
  return browserResult(controller, input, signal, async (session, options) => {
    const act = async (session: GuestSession, options: BrowserActionOptions) => {
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
