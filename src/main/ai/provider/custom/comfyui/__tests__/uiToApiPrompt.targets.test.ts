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

/**
 * The shape the Qwen Image 2.1 templates ship: the encoder's text comes from an
 * If/Else Switch that either forwards a Generate Text node's output or the text
 * edited into the workflow. Both branches carry a prompt-like string, and only
 * one of them is evaluated.
 */
const switchGraph = (on: unknown): Record<string, ApiPromptNode> => ({
  '1': {
    class_type: 'ComfySwitchNode',
    _meta: { title: 'If/Else Switch' },
    inputs: { switch: on, on_false: 'the text saved in the workflow', on_true: ['2', 0] }
  },
  '2': {
    class_type: 'TextGenerate',
    _meta: { title: 'Generate Text' },
    inputs: { clip: ['7', 0], prompt: 'the text saved in the workflow' }
  },
  '3': { class_type: 'PreviewAny', _meta: { title: 'PreviewAny' }, inputs: { source: ['1', 0] } },
  '4': {
    class_type: 'TextEncodeQwenImage21',
    _meta: { title: 'Text Encode' },
    inputs: { clip: ['7', 0], prompt: ['3', 0], negative_prompt: '' }
  },
  '5': {
    class_type: 'KSampler',
    _meta: { title: 'KSampler' },
    inputs: { positive: ['4', 0], latent_image: ['6', 0], seed: 7, sampler_name: 'euler' }
  },
  '6': { class_type: 'EmptyLatentImage', _meta: { title: 'EmptyLatentImage' }, inputs: {} },
  '7': { class_type: 'CLIPLoader', _meta: { title: 'CLIPLoader' }, inputs: { clip_name: 'qwen.safetensors' } }
})

describe('ComfyUI If/Else Switch targets', () => {
  it('writes the prompt into the text an off switch puts on the wire', () => {
    // The switch is off, so `on_false` — the literal the workflow saved — is
    // what the encoder receives, and the Generate Text branch never runs.
    const graph = switchGraph(false)
    expect(findPromptTarget(graph)).toEqual({ nodeId: '1', input: 'on_false', samplerId: '5' })
  })

  it('keeps following the branch an on switch selects', () => {
    const graph = switchGraph(true)
    const target = findPromptTarget(graph)
    expect(target).toEqual({ nodeId: '2', input: 'prompt', samplerId: '5' })
    // The discarded branch keeps the text the workflow saved.
    expect(graph['1'].inputs.on_false).toBe('the text saved in the workflow')
  })

  it('walks both branches when the switch reads its selector from the graph', () => {
    // A selector fed by a link is only known at run time, so the walk cannot
    // pick a branch and keeps the breadth-first search it had before.
    const graph = switchGraph(['8', 0])
    graph['8'] = { class_type: 'PrimitiveBoolean', _meta: { title: 'boolean' }, inputs: { value: false } }
    expect(findPromptTarget(graph)).toEqual({ nodeId: '2', input: 'prompt', samplerId: '5' })
  })
})
