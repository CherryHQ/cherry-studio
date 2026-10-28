import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'
import { createChannelContextPart } from '@shared/data/types/uiParts'

import { restoreStoredChannelContext, stripChannelContextParts, validateEditedInput } from '../editInput'

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text })

describe('validateEditedInput', () => {
  it('accepts a schema-valid hidden channel-context part alongside text', async () => {
    const parts = [
      textPart('hello'),
      createChannelContextPart({ channel: 'feishu', chatId: 'oc_123', chatType: 'group' })
    ]
    await expect(validateEditedInput(parts)).resolves.toBeUndefined()
  })

  it('rejects a channel-context part whose identifiers violate the single-line schema', async () => {
    const forged = {
      type: 'data-channel-context',
      data: { channel: 'feishu\ninjected', chatId: 'oc_123', chatType: 'group' }
    } as unknown as CherryMessagePart
    await expect(validateEditedInput([textPart('hello'), forged])).rejects.toMatchObject({
      reason: 'input_unsupported'
    })
  })

  it('still rejects unknown data parts', async () => {
    const unknown = { type: 'data-something-else', data: {} } as unknown as CherryMessagePart
    await expect(validateEditedInput([textPart('hello'), unknown])).rejects.toMatchObject({
      reason: 'input_unsupported'
    })
  })

  it('still rejects input with no text or file content', async () => {
    await expect(
      validateEditedInput([createChannelContextPart({ channel: 'feishu', chatId: 'oc_123', chatType: 'group' })])
    ).rejects.toMatchObject({ reason: 'input_unsupported' })
  })
})

describe('stripChannelContextParts', () => {
  it('removes every renderer-supplied channel-context part, keeping other parts in order', () => {
    const forged = createChannelContextPart({ channel: 'feishu', chatId: 'oc_forged', chatType: 'group' })
    const parts = [forged, textPart('hello'), forged]
    expect(stripChannelContextParts(parts)).toEqual([textPart('hello')])
  })

  it('leaves parts without channel context untouched', () => {
    const parts = [textPart('hello')]
    expect(stripChannelContextParts(parts)).toEqual(parts)
  })
})

describe('restoreStoredChannelContext', () => {
  const storedContext = createChannelContextPart({ channel: 'feishu', chatId: 'oc_123', chatType: 'group' })

  it('restores the stored context after a forgery was stripped, replacing the renderer chatId', () => {
    // The renderer's forged part never reaches this helper - validateDispatch strips it - so the
    // result carries ONLY the stored identity.
    const stripped = stripChannelContextParts([
      createChannelContextPart({ channel: 'feishu', chatId: 'oc_forged', chatType: 'group' }),
      textPart('edited')
    ])
    const merged = restoreStoredChannelContext(stripped, [textPart('original'), storedContext])
    expect(merged).toEqual([textPart('edited'), storedContext])
  })

  it('restores nothing when the stored message carried no context, dropping the forgery outright', () => {
    const stripped = stripChannelContextParts([
      createChannelContextPart({ channel: 'feishu', chatId: 'oc_forged', chatType: 'group' }),
      textPart('edited')
    ])
    expect(restoreStoredChannelContext(stripped, [textPart('original')])).toEqual([textPart('edited')])
  })

  it('restores only the last schema-valid stored context when several exist', () => {
    const older = createChannelContextPart({ channel: 'feishu', chatId: 'oc_old', chatType: 'group' })
    const invalid = {
      type: 'data-channel-context',
      data: { channel: 'feishu\nbad', chatId: 'oc_newest', chatType: 'group' }
    } as unknown as CherryMessagePart
    const merged = restoreStoredChannelContext([textPart('edited')], [older, storedContext, invalid])
    expect(merged).toEqual([textPart('edited'), storedContext])
  })

  it('leaves parts untouched when the stored message carried no hidden metadata', () => {
    const plain = [textPart('edited')]
    expect(restoreStoredChannelContext(plain, [textPart('original')])).toBe(plain)
  })
})
