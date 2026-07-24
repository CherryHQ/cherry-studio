import type { ReasoningSupport } from '../schemas/model'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { openaiCompatible } from './types'

const thinkingWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
  auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] },
  effort: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] }
}

const glm52Support: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'high', 'max'], default: 'max' }],
  supportedEfforts: ['none', 'high', 'max'],
  defaultEffort: 'max'
}

const glm52Wire: ReasoningWireProfile = {
  off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
  effort: {
    operations: [
      { target: 'thinking.type', value: { source: 'literal', value: 'enabled' } },
      { target: 'reasoningEffort', value: { source: 'effort' } }
    ]
  }
}

export default openaiCompatible({
  id: 'zhipu',
  name: 'ZhiPu',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
  reasoningFormat: {
    type: 'openai-chat',
    wire: thinkingWire
  },
  anthropic: 'https://open.bigmodel.cn/api/anthropic',
  website: {
    apiKey: 'https://open.bigmodel.cn/apikey/platform',
    docs: 'https://docs.bigmodel.cn/',
    models: 'https://open.bigmodel.cn/modelcenter/square',
    official: 'https://open.bigmodel.cn/'
  },
  overrides: [
    ...['glm-5-2', 'glm-5-2-fast'].map((modelId) => ({
      modelId,
      reasoningContracts: {
        'openai-chat-completions': {
          support: glm52Support,
          wire: glm52Wire
        }
      }
    })),
    {
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { type: 'switch' },
              customSize: { maxSide: 2048, minSide: 512, pairedEnumKey: 'size', type: 'size' },
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              quality: { options: ['standard', 'hd'], type: 'enum' },
              size: {
                default: '1024x1024',
                options: ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      },
      modelId: 'cogview-4'
    },
    {
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { type: 'switch' },
              customSize: { maxSide: 2048, minSide: 1024, pairedEnumKey: 'size', type: 'size' },
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              quality: { options: ['standard', 'hd'], type: 'enum' },
              size: {
                default: '1280x1280',
                options: ['1280x1280', '1568x1056', '1056x1568', '1472x1088', '1088x1472', '1728x960', '960x1728'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      },
      modelId: 'glm-image'
    }
  ]
})
