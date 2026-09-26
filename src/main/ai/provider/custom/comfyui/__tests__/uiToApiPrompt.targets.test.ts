import { describe, expect, it } from 'vitest'

import { applySeed, findPromptTarget, type ApiPromptNode } from '../uiToApiPrompt'

const fluxGraph = (): Record<string, ApiPromptNode> => ({
  '1': { class_type: 'RandomNoise', _meta: { title: 'RandomNoise' }, inputs: { noise_seed: 111 } },
  'sub:2': { class_type: 'CLIPTextEncode', _meta: { title: 'CLIPTextEncode' }, inputs: { text: 'saved prompt' } },
  'sub:3': {
    class_type: 'FluxGuidance',
    _meta: { title: 'FluxGuidance' },
    inputs: { conditioning: ['sub:2', 0], guidance: 4 }
  },
  'sub:4': {
    class_type: 'ReferenceLatent',
    _meta: { title: 'ReferenceLatent' },
    inputs: { conditioning: ['sub:3', 0], latent: ['9', 0] }
  },
  'sub:5': {
    class_type: 'BasicGuider',
    _meta: { title: 'BasicGuider' },
    inputs: { conditioning: ['sub:4', 0], model: ['10', 0] }
  },
  'sub:6': { class_type: 'RandomNoise', _meta: { title: 'RandomNoise' }, inputs: { noise_seed: 222 } },
  'sub:7': {
    class_type: 'SamplerCustomAdvanced',
    _meta: { title: 'SamplerCustomAdvanced' },
    inputs: {
      guider: ['sub:5', 0],
      noise: ['sub:6', 0],
      latent_image: ['9', 0]
    }
  }
})

describe('ComfyUI guider and noise paths', () => {
  it('replaces the FLUX conditioning prompt and only its sampler noise seed', () => {
    const graph = fluxGraph()
    const target = findPromptTarget(graph)
    expect(target).toEqual({ nodeId: 'sub:2', input: 'text', samplerId: 'sub:7' })
    if (!target) throw new Error('Missing prompt target')
    graph[target.nodeId].inputs[target.input] = 'new prompt'
    applySeed(graph, 42, target.samplerId)
    expect(graph['sub:2'].inputs.text).toBe('new prompt')
    expect(graph['sub:6'].inputs.noise_seed).toBe(42)
    expect(graph['1'].inputs.noise_seed).toBe(111)
    expect(graph['sub:7'].inputs.noise).toEqual(['sub:6', 0])
  })

  it('keeps CFGGuider negative conditioning untouched', () => {
    const graph = fluxGraph()
    graph['0'] = { class_type: 'CLIPTextEncode', _meta: { title: 'CLIPTextEncode' }, inputs: { text: 'negative' } }
    graph['sub:5'] = {
      class_type: 'CFGGuider',
      _meta: { title: 'CFGGuider' },
      inputs: { positive: ['sub:4', 0], negative: ['0', 0] }
    }
    expect(findPromptTarget(graph)).toEqual({ nodeId: 'sub:2', input: 'text', samplerId: 'sub:7' })
    expect(graph['0'].inputs.text).toBe('negative')
  })

  it('does not overwrite unrelated noise when the selected sampler has no noise seed', () => {
    const graph = fluxGraph()
    graph['sub:6'] = { class_type: 'DisableNoise', _meta: { title: 'DisableNoise' }, inputs: {} }
    applySeed(graph, 42, 'sub:7')
    expect(graph['1'].inputs.noise_seed).toBe(111)
  })
})
