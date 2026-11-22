// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { getNormalizedExtension } from '../../../code-block'

describe('code block language extensions', () => {
  it.each(['constructor', '__proto__'])('keeps the unknown language %s as a string extension', async (language) => {
    await expect(getNormalizedExtension(language)).resolves.toBe(language)
  })

  it('retains custom SVG syntax and caller-provided extension mappings', async () => {
    await expect(getNormalizedExtension('SVG')).resolves.toBe('xml')
    await expect(
      getNormalizedExtension('widget', {
        WidgetFormat: { type: 'programming', aliases: ['widget'], extensions: ['.wdg'] }
      })
    ).resolves.toBe('wdg')
  })
})
