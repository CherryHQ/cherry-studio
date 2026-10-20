import { anthropicModels } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'anthropic',
  name: 'Anthropic',
  fetchModels: anthropicModels(),
  modelsDevProviders: ['anthropic'],
  idPrefixes: ['claude'],
  models: [
    {
      id: 'claude-sonnet-5-5',
      name: 'Claude Sonnet 5.5',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 2 },
        output: { currency: 'USD', perMillionTokens: 10 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 },
        cacheWrite: { currency: 'USD', perMillionTokens: 2.5 }
      },
      parameterSupport: {
        temperature: { supported: false },
        topP: { supported: false },
        topK: { supported: false },
        frequencyPenalty: false,
        presencePenalty: false,
        maxTokens: true,
        stopSequences: true,
        systemMessage: true
      },
      reasoning: {
        controls: [
          { kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'high' },
          { kind: 'toggle' }
        ]
      }
    },
    {
      id: 'claude-opus-5-5',
      name: 'Claude Opus 5.5',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 4 },
        output: { currency: 'USD', perMillionTokens: 20 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 },
        cacheWrite: { currency: 'USD', perMillionTokens: 5 }
      },
      parameterSupport: {
        temperature: { supported: false },
        topP: { supported: false },
        topK: { supported: false },
        frequencyPenalty: false,
        presencePenalty: false,
        maxTokens: true,
        stopSequences: true,
        systemMessage: true
      },
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' }]
      }
    },
    {
      id: 'claude-3-haiku',
      name: 'Claude Haiku 3',
      capabilities: ['function-call', 'image-recognition', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 200000,
      maxOutputTokens: 4096,
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-fable-5',
      name: 'Claude Fable 5',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-fable-5-1',
      name: 'Claude Fable 5.1',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-fable-latest',
      name: 'Anthropic: Claude Fable Latest',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-haiku-latest',
      name: 'Anthropic: Claude Haiku Latest',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 200000,
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-opus-5-fast',
      name: 'Claude Opus 5 (Fast)',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-opus-latest',
      name: 'Anthropic: Claude Opus Latest',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-sonnet-latest',
      name: 'Anthropic: Claude Sonnet Latest',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-haiku-4-5',
      name: 'Claude Haiku 4.5 (latest)',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 200000,
      maxOutputTokens: 64000,
      messageCompatibility: { interleavedThinkingBeta: true, vertexWebSearchBeta: true },
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { exclusiveWithTemperature: true, supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-opus-4-5',
      name: 'Claude Opus 4.5 (latest)',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 200000,
      maxOutputTokens: 64000,
      messageCompatibility: { interleavedThinkingBeta: true, vertexWebSearchBeta: true },
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { exclusiveWithTemperature: true, supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5 (latest)',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 64000,
      messageCompatibility: { interleavedThinkingBeta: true, vertexWebSearchBeta: true },
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { exclusiveWithTemperature: true, supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-opus-4',
      name: 'Claude Opus 4',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 200000,
      maxOutputTokens: 32000,
      messageCompatibility: { vertexWebSearchBeta: true },
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-opus-4-1',
      name: 'Claude Opus 4.1 (US)',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 200000,
      maxOutputTokens: 32000,
      messageCompatibility: { vertexWebSearchBeta: true },
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-opus-4-6',
      name: 'Claude Opus 4.6',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      messageCompatibility: { vertexWebSearchBeta: true },
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },

    {
      id: 'claude-opus-4-8-fast',
      name: 'Claude Opus 4.8 (Fast)',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      messageCompatibility: { vertexWebSearchBeta: true },
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-sonnet-4',
      name: 'Claude Sonnet 4',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 64000,
      messageCompatibility: { vertexWebSearchBeta: true },
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      messageCompatibility: { vertexWebSearchBeta: true },
      parameterSupport: {
        temperature: { range: { max: 1, min: 0 }, supported: true, whenReasoning: { supported: false } },
        topP: { supported: true, whenReasoning: { range: { max: 1, min: 0.95 } } }
      }
    },
    {
      id: 'claude-opus-4-7',
      name: 'Claude Opus 4.7',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      messageCompatibility: { vertexWebSearchBeta: true },
      parameterSupport: { temperature: { supported: false }, topK: { supported: false }, topP: { supported: false } }
    },
    {
      id: 'claude-opus-4-8',
      name: 'Claude Opus 4.8',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      messageCompatibility: { vertexWebSearchBeta: true },
      parameterSupport: { temperature: { supported: false }, topK: { supported: false }, topP: { supported: false } }
    },
    {
      id: 'claude-opus-5',
      name: 'Claude Opus 5',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      parameterSupport: { temperature: { supported: false }, topK: { supported: false }, topP: { supported: false } }
    }
  ],
  reasoningFamilies: [
    // Sonnet's lowest setting skips up-front thinking but retains progress updates between tools.
    {
      pattern: '^(?:(?:[\\w-]+\\.)?anthropic\\.)?claude-sonnet-5[.-]5(?:$|[\\[ @:-])',
      effort: ['low', 'medium', 'high', 'xhigh', 'max'],
      toggle: true,
      wireDialect: 'adaptive-between-tools'
    },
    // Opus 5.5 always uses adaptive thinking.
    {
      pattern: '^(?:(?:[\\w-]+\\.)?anthropic\\.)?claude-opus-5[.-]5(?:$|[\\[ @:-])',
      effort: ['low', 'medium', 'high', 'xhigh', 'max'],
      toggle: false,
      wireDialect: 'adaptive-always'
    },
    // Fable always reasons. The API rejects attempts to disable thinking.
    {
      pattern: '^(?:anthropic\\.)?claude-fable',
      effort: ['low', 'medium', 'high', 'max'],
      toggle: false,
      wireDialect: 'effort'
    },
    // Adaptive-effort generations: 4.6+ minors, the 5.x/Fable line, and the
    // -latest aliases (which track the newest flagship).
    {
      pattern:
        '^(?:anthropic\\.)?claude-(?:(?:opus|sonnet|haiku)-(?:4[.-][6-9]|[5-9])(?!\\d)|(?:opus|sonnet|haiku)-latest)',
      effort: ['low', 'medium', 'high', 'max'],
      toggle: true,
      wireDialect: 'effort'
    },
    // Pre-adaptive thinking SKUs: on/off + budget (tiers below). `thinking.type
    // = adaptive` is 4.6+, so every earlier SKU stays on enabled+budget_tokens
    // — including opus-4.5, which DOES take an effort knob (output_config.effort)
    // yet still rejects adaptive. Effort-capability and dialect are independent.
    { pattern: '^(?:anthropic\\.)?claude', toggle: true, wireDialect: 'budget', template: true },
    {
      pattern: '(?:anthropic\\.)?claude-opus-4[.-]7(?:[@\\-:][\\w\\-:]+)?$',
      budget: { min: 1024, max: 128000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-opus-4[.-]6(?:[@\\-:][\\w\\-:]+)?$',
      budget: { min: 1024, max: 128000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-(:?sonnet|haiku)-4[.-]6.*(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 64000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-(:?haiku|sonnet|opus)-4[.-]5.*(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 64000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-opus-4[.-]1.*(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 32000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-sonnet-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 64000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-opus-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 32000 },
      template: true
    },
    {
      pattern: '(?:anthropic\\.)?claude-3[.-]7.*sonnet.*(?:-v\\d+:\\d+)?$',
      budget: { min: 1024, max: 64000 },
      template: true
    },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: 'claude-3-7-sonnet|claude-3\\.7-sonnet' },
    { pattern: 'claude-(?:sonnet|opus|haiku)-4' }
  ]
})
