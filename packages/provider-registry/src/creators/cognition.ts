import { type CreatorModel, defineCreator } from './types'

const swe = {
  family: 'swe',
  capabilities: ['function-call', 'reasoning'],
  inputModalities: ['text'],
  outputModalities: ['text'],
  openWeights: false
} satisfies Omit<CreatorModel, 'id'>

const swe2Reasoning = {
  controls: [{ kind: 'effort', values: ['medium', 'high', 'max'] }]
} satisfies CreatorModel['reasoning']

const swe21Reasoning = {
  controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' }]
} satisfies CreatorModel['reasoning']

export default defineCreator({
  id: 'cognition',
  name: 'Cognition',
  reasoningFamilies: [
    { pattern: '^swe-2(?:-flash)?$', effort: swe2Reasoning.controls[0].values },
    { pattern: '^swe-2[.-]1(?:-ultrafast)?$', effort: swe21Reasoning.controls[0].values }
  ],
  models: [
    { ...swe, id: 'swe-1-6', name: 'SWE-1.6' },
    { ...swe, id: 'swe-1-7', name: 'SWE-1.7' },
    {
      ...swe,
      id: 'swe-2',
      name: 'SWE-2',
      reasoning: swe2Reasoning,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 3 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.3 },
        output: { currency: 'USD', perMillionTokens: 15 }
      }
    },
    {
      ...swe,
      id: 'swe-2-flash',
      name: 'SWE-2 Flash',
      reasoning: swe2Reasoning,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.1 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.01 },
        cacheWrite: { currency: 'USD', perMillionTokens: 0.125 },
        output: { currency: 'USD', perMillionTokens: 0.5 }
      }
    },
    {
      ...swe,
      id: 'swe-2-1',
      name: 'SWE-2.1',
      reasoning: swe21Reasoning,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 2 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 },
        output: { currency: 'USD', perMillionTokens: 10 }
      }
    },
    {
      ...swe,
      id: 'swe-2-1-ultrafast',
      name: 'SWE-2.1 Ultrafast',
      reasoning: swe21Reasoning,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 5 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.5 },
        output: { currency: 'USD', perMillionTokens: 25 }
      }
    }
  ]
})
