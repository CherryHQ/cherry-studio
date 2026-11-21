import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import { getChannelAuthQrResult, isChannelAuthQrPart } from '../channelConfigTool'
import { buildToolResponseFromPart } from '../toolResponse'

const QR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAYAAAB5fY51'
const piTool = {
  cherry: {
    transport: 'pi-agent',
    tool: { type: 'mcp', name: 'config', serverId: 'cherry-tools', serverName: 'cherry-tools' }
  },
  pi: { toolName: 'mcp__cherry_tools__config' }
}

/** A Pi Durable Agent adding a WeChat channel by QR, as stored: text and image blocks keep no CallToolResult wrapper. */
const piWeChatQrPart = {
  type: 'dynamic-tool',
  toolName: 'mcp__cherry_tools__config',
  toolCallId: 'call-qr',
  input: { action: 'add_channel', type: 'wechat', name: '微信', auth_mode: 'qr', enabled: true },
  callProviderMetadata: piTool,
  state: 'output-available',
  output: [
    { type: 'text', text: 'WeChat channel created (ID: ch-1). QR code generated — display it to the user.' },
    { type: 'image', data: QR_PNG, mimeType: 'image/png' }
  ],
  preliminary: false,
  providerExecuted: true,
  resultProviderMetadata: piTool
} as unknown as CherryMessagePart

describe('channel QR results', () => {
  // Catches the QR code a Pi Durable Agent generated never reaching the chat.
  it('shows the QR image from a Pi Durable add_channel result', () => {
    expect(isChannelAuthQrPart(piWeChatQrPart)).toBe(true)

    const toolResponse = buildToolResponseFromPart(piWeChatQrPart)
    if (!toolResponse) throw new Error('Expected a tool response')
    const qr = getChannelAuthQrResult(toolResponse)

    expect(qr?.images).toEqual([`data:image/png;base64,${QR_PNG}`])
    expect(qr?.responseWithoutImages.content).toEqual([
      { type: 'text', text: 'WeChat channel created (ID: ch-1). QR code generated — display it to the user.' }
    ])
  })

  // Catches the bare-array reading swallowing JSON arrays that dedicated renderers (search results) expect as is.
  it('keeps a Pi MCP result that is a JSON array as the array', () => {
    const results = [{ id: 1, title: 'Cherry Studio', url: 'https://example.com', content: 'result' }]
    const toolResponse = buildToolResponseFromPart({
      ...piWeChatQrPart,
      toolName: 'mcp__cherry_tools__web_search',
      input: { query: 'Cherry Studio' },
      output: results
    } as unknown as CherryMessagePart)

    expect(toolResponse?.response).toEqual(results)
  })
})
