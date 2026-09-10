import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { CLI_CONFIG_FILE_SPECS } from '@shared/utils/cliConfig'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { getAdapter } from '../adapters'

const provider = {
  id: 'multi',
  name: 'Multi',
  defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  endpointConfigs: {
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://chat.example' },
    [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://anthropic.example' }
  }
} as Provider
const model: Model = {
  id: 'multi::model',
  providerId: 'multi',
  name: 'Model',
  capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
  endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
  preferredEndpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}

describe('CLI draft endpoint preference', () => {
  it.each([CodeCli.OPEN_CODE, CodeCli.PI, CodeCli.HERMES])(
    '%s writes the pinned protocol and its host',
    async (cliTool) => {
      const adapter = getAdapter(cliTool)!
      const files = await adapter.buildDraft(
        {
          cliTool,
          modelId: model.id,
          files: adapter.targets.map((target) => ({
            target,
            label: target,
            path: `/unused/${target}`,
            language: CLI_CONFIG_FILE_SPECS[target].language,
            content: ''
          }))
        },
        { provider, modelRecord: model, model: 'model', apiKey: 'sk-test', configBlob: {} }
      )

      expect(adapter.extractConnection(files)?.baseUrl).toBe(
        cliTool === CodeCli.OPEN_CODE ? 'https://anthropic.example/v1' : 'https://anthropic.example'
      )
      if (cliTool === CodeCli.OPEN_CODE) {
        const config = JSON.parse(files.find((file) => file.target === 'opencode-config')!.content)
        expect(Object.values(config.provider)).toEqual([expect.objectContaining({ npm: '@ai-sdk/anthropic' })])
      } else if (cliTool === CodeCli.PI) {
        const config = JSON.parse(files.find((file) => file.target === 'pi-models')!.content)
        expect(Object.values(config.providers)).toEqual([expect.objectContaining({ api: 'anthropic-messages' })])
      } else {
        const config = parse(files.find((file) => file.target === 'hermes-config')!.content)
        expect(config.model.api_mode).toBe('anthropic_messages')
      }
    }
  )
})
