import { describe, expect, it } from 'vitest'

import { applySeed, findPromptTarget, hasPromptText, type ApiPromptNode, type ObjectInfo } from '../uiToApiPrompt'

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

describe('ComfyUI text held outside the encode node', () => {
  const graphWithTextSource = (source: Record<string, unknown>): Record<string, ApiPromptNode> => ({
    '1': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'text' }, inputs: source },
    '2': {
      class_type: 'CLIPTextEncode',
      _meta: { title: 'encode' },
      inputs: { text: ['1', 0], clip: ['4', 0] }
    },
    '3': {
      class_type: 'KSampler',
      _meta: { title: 'sampler' },
      inputs: { positive: ['2', 0], latent_image: ['5', 0], seed: 1 }
    },
    '4': { class_type: 'CLIPLoader', _meta: { title: 'clip' }, inputs: {} },
    '5': { class_type: 'EmptyLatentImage', _meta: { title: 'latent' }, inputs: {} }
  })

  it('takes the text from a value source the conditioning chain reaches', () => {
    const graph = graphWithTextSource({ value: 'the text saved in the workflow' })
    expect(findPromptTarget(graph)).toEqual({ nodeId: '1', input: 'value', samplerId: '3' })
  })

  it('refuses a StringConcatenate that keeps a literal beside a linked text', () => {
    // Both operands are STRING and neither ranks the other: the style string is
    // linked in and the text is typed into the node, or the other way round.
    // Picking either would overwrite a workflow constant.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'style' }, inputs: { value: 'muted sketch' } },
      '2': {
        class_type: 'StringConcatenate',
        _meta: { title: 'concat' },
        inputs: { string_a: ['1', 0], string_b: 'a cat on a beach', delimiter: ', ' }
      },
      '3': { class_type: 'CLIPTextEncode', _meta: { title: 'encode' }, inputs: { text: ['2', 0] } },
      '4': { class_type: 'KSampler', _meta: { title: 'sampler' }, inputs: { positive: ['3', 0], seed: 1 } },
      '5': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['4', 0] } }
    }
    expect(findPromptTarget(graph)).toBeUndefined()
    expect(hasPromptText(graph)).toBe(true)
  })

  it('prefers the text the workflow promotes over a literal further down the concat', () => {
    // The concat holds a style literal, but the workflow promotes the text of a
    // node its other operand reaches: the promotion says what a run supplies.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'text' }, inputs: { value: 'the run text' } },
      '2': {
        class_type: 'ComfySwitchNode',
        _meta: { title: 'switch' },
        inputs: { on_true: ['1', 0], on_false: ['5', 0], switch: true }
      },
      '3': {
        class_type: 'StringConcatenate',
        _meta: { title: 'concat' },
        inputs: { string_a: ['2', 0], string_b: 'style, ', delimiter: '' }
      },
      '4': { class_type: 'CLIPTextEncode', _meta: { title: 'encode' }, inputs: { text: ['3', 0] } },
      '5': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'other' }, inputs: { value: 'other text' } },
      '6': { class_type: 'KSampler', _meta: { title: 'sampler' }, inputs: { positive: ['4', 0], seed: 1 } },
      '7': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['6', 0] } }
    }
    expect(findPromptTarget(graph, { promotedText: [{ nodeId: '1', input: 'value' }] })).toEqual({
      nodeId: '1',
      input: 'value',
      samplerId: '6'
    })
  })

  it('refuses a StringConcatenate that keeps an empty literal beside a linked text', () => {
    // A blank literal is the slot the workflow left for a run to fill, but a
    // linked operand beside it is just as likely to be the text, and the walk
    // cannot tell. It stops rather than replace either one.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'style' }, inputs: { value: 'muted sketch' } },
      '2': {
        class_type: 'StringConcatenate',
        _meta: { title: 'concat' },
        inputs: { string_a: ['1', 0], string_b: '', delimiter: ', ' }
      },
      '3': { class_type: 'CLIPTextEncode', _meta: { title: 'encode' }, inputs: { text: ['2', 0] } },
      '4': { class_type: 'KSampler', _meta: { title: 'sampler' }, inputs: { positive: ['3', 0], seed: 1 } },
      '5': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['4', 0] } }
    }
    expect(findPromptTarget(graph)).toBeUndefined()
    expect(hasPromptText(graph)).toBe(true)
  })

  it('refuses to pick an operand of a StringConcatenate that has text on both sides', () => {
    // `string_a` and `string_b` rank nothing: one is the workflow's style or
    // prefix, the other is the run's text, and object order cannot tell them
    // apart. Picking one would overwrite a workflow constant.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'prefix' }, inputs: { value: 'a 360 image, ' } },
      '2': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'text' }, inputs: { value: 'the run text' } },
      '3': {
        class_type: 'StringConcatenate',
        _meta: { title: 'concat' },
        inputs: { string_a: ['1', 0], string_b: ['2', 0], delimiter: '' }
      },
      '4': { class_type: 'CLIPTextEncode', _meta: { title: 'encode' }, inputs: { text: ['3', 0] } },
      '5': { class_type: 'KSampler', _meta: { title: 'sampler' }, inputs: { positive: ['4', 0], seed: 1 } },
      '6': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['5', 0] } }
    }
    expect(findPromptTarget(graph)).toBeUndefined()
    expect(hasPromptText(graph)).toBe(true)
  })

  it('skips a promoted text the graph only reads as a negative prompt', () => {
    // The promotion names the widget, but the run reads it through the negative
    // branch: writing the prompt there would replace the negative prompt.
    const graph: Record<string, ApiPromptNode> = {
      '1': {
        class_type: 'StringConcatenate',
        _meta: { title: 'concat' },
        inputs: { string_a: 'cat', string_b: 'style', delimiter: ', ' }
      },
      '2': { class_type: 'CLIPTextEncode', _meta: { title: 'negative' }, inputs: { text: ['1', 0] } },
      '3': {
        class_type: 'KSampler',
        _meta: { title: 'sampler' },
        inputs: { positive: ['5', 0], negative: ['2', 0], seed: 5 }
      },
      '5': { class_type: 'CLIPTextEncode', _meta: { title: 'positive' }, inputs: { text: ['6', 0] } },
      '6': { class_type: 'CLIPLoader', _meta: { title: 'clip' }, inputs: { clip_name: 'x' } }
    }
    expect(findPromptTarget(graph, { promotedText: [{ nodeId: '1', input: 'string_a' }] })).toBeUndefined()
    expect(hasPromptText(graph)).toBe(true)
  })

  it('follows a generator prompt socket fed by a plain text node before its others', () => {
    // The style source sits first in the object and has the lower node id, but
    // the prompt socket is the run's text when a plain text node feeds it.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'style' }, inputs: { value: 'style text' } },
      '2': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'text' }, inputs: { value: 'prompt text' } },
      '3': {
        class_type: 'GeminiImage2Node',
        _meta: { title: 'generator' },
        inputs: { style: ['1', 0], prompt: ['2', 0], seed: 1 }
      },
      '4': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['3', 0] } }
    }
    expect(findPromptTarget(graph)).toEqual({ nodeId: '2', input: 'value', samplerId: '3' })
  })

  it('does not read a value off a node the graph feeds', () => {
    // A concat that also holds a `value` is not a text source: the text it
    // produces is the join, so writing the run's prompt into `value` would
    // replace something that is not the prompt.
    const graph = graphWithTextSource({ string_a: ['6', 0], value: 'not the text' })
    graph['6'] = { class_type: 'CLIPLoader', _meta: { title: 'clip' }, inputs: { clip_name: 'model.safetensors' } }
    expect(findPromptTarget(graph)).toBeUndefined()
  })

  it('reads a numbered guider stream as the positive conditioning', () => {
    // DualCFGGuider — the Omnigen2 shape — numbers its streams cond1 and cond2
    // instead of naming one `positive`, and cond1 is the text.
    const graph: Record<string, ApiPromptNode> = {
      '1': {
        class_type: 'SamplerCustomAdvanced',
        _meta: { title: 'sampler' },
        inputs: { guider: ['2', 0], latent_image: ['5', 0] }
      },
      '2': {
        class_type: 'DualCFGGuider',
        _meta: { title: 'guider' },
        inputs: { model: ['4', 0], cond1: ['3', 0], cond2: ['6', 0], negative: ['6', 0] }
      },
      '3': { class_type: 'CLIPTextEncode', _meta: { title: 'text' }, inputs: { text: 'saved text' } },
      '4': { class_type: 'UNETLoader', _meta: { title: 'model' }, inputs: {} },
      '5': { class_type: 'EmptyLatentImage', _meta: { title: 'latent' }, inputs: {} },
      '6': { class_type: 'CLIPTextEncode', _meta: { title: 'negative' }, inputs: { text: 'deformed, blurry' } }
    }
    expect(findPromptTarget(graph)).toEqual({ nodeId: '3', input: 'text', samplerId: '1' })
  })

  it('reads a prompt the backend nests under a widget group', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': {
        class_type: 'QwenImageTextToImageApi',
        _meta: { title: 'generator' },
        inputs: { 'model.prompt': 'saved text', 'model.negative_prompt': '', seed: 42 }
      },
      '2': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['1', 0] } }
    }
    expect(findPromptTarget(graph)).toEqual({ nodeId: '1', input: 'model.prompt', samplerId: '1' })
  })

  it("follows a generator's linked text", () => {
    // GeminiImage2Node takes the prompt as a socket: the text is one hop away,
    // in the Primitive it references.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'GeminiImage2Node', _meta: { title: 'generator' }, inputs: { prompt: ['2', 0], seed: 1 } },
      '2': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'text' }, inputs: { value: 'saved text' } },
      '3': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['1', 0] } }
    }
    expect(findPromptTarget(graph)).toEqual({ nodeId: '2', input: 'value', samplerId: '1' })
  })

  it('targets a generator that keeps no seed at all', () => {
    // RunwayTextToImageNode holds the prompt and nothing else: there is no
    // sampler, so the walk starts from what the graph outputs.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['2', 0] } },
      '2': { class_type: 'RunwayTextToImageNode', _meta: { title: 'generator' }, inputs: { prompt: 'saved text' } }
    }
    expect(findPromptTarget(graph)).toEqual({ nodeId: '2', input: 'prompt', samplerId: '2' })
  })

  it('falls back to the text widget the workflow promotes on its instance', () => {
    // The graph joins the run's text with a style suffix, so nothing on the
    // conditioning chain says which literal is the prompt. The subgraph
    // promoted `string_a`, which is the workflow's own answer.
    const graph: Record<string, ApiPromptNode> = {
      '1': {
        class_type: 'StringConcatenate',
        _meta: { title: 'concat' },
        inputs: { string_a: 'cat', string_b: 'sugar-coated candy style', delimiter: ', ' }
      },
      '2': { class_type: 'CLIPTextEncode', _meta: { title: 'encode' }, inputs: { text: ['1', 0] } },
      '3': { class_type: 'KSampler', _meta: { title: 'sampler' }, inputs: { positive: ['2', 0], seed: 5 } }
    }
    expect(findPromptTarget(graph, { promotedText: [{ nodeId: '1', input: 'string_a' }] })).toEqual({
      nodeId: '1',
      input: 'string_a',
      samplerId: '3'
    })
  })

  it('samples a generator that nests its seed, and writes the run seed back there', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': {
        class_type: 'ByteDanceSeedreamNodeV3',
        _meta: { title: 'generator' },
        inputs: { prompt: 'the text saved in the workflow', model: 'seedream-4-0-250828', 'model.seed': 42 }
      },
      '2': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['1', 0] } }
    }
    expect(findPromptTarget(graph)).toEqual({ nodeId: '1', input: 'prompt', samplerId: '1' })
    applySeed(graph, 7, '1')
    expect(graph['1'].inputs['model.seed']).toBe(7)
  })
})

describe('ComfyUI seed placement', () => {
  it('names a sampling node the target is reachable from, not the first one', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'KSampler', _meta: { title: 'other sampler' }, inputs: { seed: 1 } },
      '2': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'text' }, inputs: { value: 'saved text' } },
      '3': { class_type: 'GeminiImage2Node', _meta: { title: 'generator' }, inputs: { prompt: ['2', 0], seed: 2 } },
      '4': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['3', 0] } }
    }
    expect(findPromptTarget(graph)).toEqual({ nodeId: '2', input: 'value', samplerId: '3' })
  })

  it('does not hand the run seed to a sampler that only reaches the text negatively', () => {
    // Node 2 samples and its `negative` edge reaches the target, but it does
    // not sample this text: the run's seed would change a graph the run never
    // reads. No sampler owns the text, so the target names itself.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'text' }, inputs: { value: 'the run text' } },
      '2': { class_type: 'KSampler', _meta: { title: 'unrelated' }, inputs: { negative: ['1', 0], seed: 1 } },
      '3': { class_type: 'RunwayTextToImageNode', _meta: { title: 'generator' }, inputs: { prompt: ['1', 0] } },
      '4': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['3', 0] } }
    }
    expect(findPromptTarget(graph, { objectInfo: { SaveImage: { input: {}, output_node: true } } })).toEqual({
      nodeId: '1',
      input: 'value',
      samplerId: '1'
    })
  })

  it('names the target itself when no sampling node reaches it', () => {
    // Nothing that samples feeds this text, so the run's seed has nowhere to go
    // and writing it to the first node that happens to hold one is not a guess
    // worth making.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'KSampler', _meta: { title: 'unrelated sampler' }, inputs: { seed: 1 } },
      '2': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'text' }, inputs: { value: 'saved text' } },
      '3': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['1', 0] } }
    }
    expect(findPromptTarget(graph)).toEqual({ nodeId: '2', input: 'value', samplerId: '2' })
  })
})

describe('ComfyUI output anchors', () => {
  const outputInfo: ObjectInfo = {
    SaveImage: {
      input: { required: { images: ['IMAGE', {}], filename_prefix: ['STRING', { default: 'ComfyUI' }] } },
      output_node: true
    },
    RunwayTextToImageNode: { input: { required: { prompt: ['STRING', {}] } } }
  }

  it('does not follow a string reference leaving the output node', () => {
    // `filename_prefix` fed by a string primitive is metadata the workflow set,
    // not the text a run supplies: following it overwrites the primitive.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'filename' }, inputs: { value: 'ComfyUI' } },
      '2': { class_type: 'RunwayTextToImageNode', _meta: { title: 'generator' }, inputs: { prompt: 'saved text' } },
      '3': {
        class_type: 'SaveImage',
        _meta: { title: 'save' },
        inputs: { filename_prefix: ['1', 0], images: ['2', 0] }
      }
    }
    expect(findPromptTarget(graph, { objectInfo: outputInfo })).toEqual({
      nodeId: '2',
      input: 'prompt',
      samplerId: '2'
    })
  })

  it('walks back from the classes the server executes, not from a stray node', () => {
    // The stray text node reads nothing and nothing reads it; a run never
    // executes it, so it is not an anchor even though no node references it.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'CLIPTextEncode', _meta: { title: 'stray' }, inputs: { text: 'stray text' } },
      '2': { class_type: 'RunwayTextToImageNode', _meta: { title: 'generator' }, inputs: { prompt: 'saved text' } },
      '3': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['2', 0] } }
    }
    expect(findPromptTarget(graph, { objectInfo: outputInfo })).toEqual({
      nodeId: '2',
      input: 'prompt',
      samplerId: '2'
    })
  })

  it('ignores a prompt on a branch no output reaches', () => {
    // Node 2 samples and node 1 carries text, but nothing leads to them: the
    // run never executes that branch, so its text is not the run's prompt.
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'CLIPTextEncode', _meta: { title: 'disconnected' }, inputs: { text: 'disconnected text' } },
      '2': {
        class_type: 'KSampler',
        _meta: { title: 'disconnected sampler' },
        inputs: { positive: ['1', 0], seed: 1 }
      },
      '3': { class_type: 'CLIPTextEncode', _meta: { title: 'positive' }, inputs: { text: ['6', 0] } },
      '4': { class_type: 'KSampler', _meta: { title: 'sampler' }, inputs: { positive: ['3', 0], seed: 2 } },
      '5': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['4', 0] } },
      '6': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'text' }, inputs: { value: 'the run text' } }
    }
    expect(findPromptTarget(graph, { objectInfo: outputInfo })).toEqual({
      nodeId: '6',
      input: 'value',
      samplerId: '4'
    })
  })

  it('does not read a value off the output node a run ends at', () => {
    // An ordinary string input on an output class — a filename prefix, a path —
    // is not a prompt, even though the node is otherwise its own value.
    const graph: Record<string, ApiPromptNode> = {
      '1': {
        class_type: 'SaveImage',
        _meta: { title: 'save' },
        inputs: { value: 'ComfyUI', filename_prefix: 'ComfyUI' }
      }
    }
    expect(findPromptTarget(graph, { objectInfo: outputInfo })).toBeUndefined()
  })

  it('does not walk back from a sampler no output reaches', () => {
    // Node 1 samples and holds its own prompt, but nothing leads to it: a run
    // never executes it, so its text is not what the run supplies.
    const graph: Record<string, ApiPromptNode> = {
      '1': {
        class_type: 'GeminiImage2Node',
        _meta: { title: 'disconnected' },
        inputs: { prompt: 'disconnected text', seed: 1 }
      },
      '2': { class_type: 'RunwayTextToImageNode', _meta: { title: 'generator' }, inputs: { prompt: ['4', 0] } },
      '3': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['2', 0] } },
      '4': { class_type: 'PrimitiveStringMultiline', _meta: { title: 'text' }, inputs: { value: 'the run text' } }
    }
    expect(findPromptTarget(graph, { objectInfo: outputInfo })).toEqual({ nodeId: '4', input: 'value', samplerId: '4' })
  })

  it('falls back to the nodes nothing reads when the classes are unknown', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'RunwayTextToImageNode', _meta: { title: 'generator' }, inputs: { prompt: 'saved text' } },
      '2': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['1', 0] } }
    }
    expect(findPromptTarget(graph)).toEqual({ nodeId: '1', input: 'prompt', samplerId: '1' })
  })
})

describe('ComfyUI workflows that hold no text', () => {
  const upscaler = (): Record<string, ApiPromptNode> => ({
    '1': { class_type: 'ImageScaleBy', _meta: { title: 'scale' }, inputs: { upscale_method: 'lanczos' } },
    '2': { class_type: 'SaveImage', _meta: { title: 'save' }, inputs: { images: ['1', 0], filename_prefix: 'x' } }
  })

  it('says so, and reports no target', () => {
    const graph = upscaler()
    expect(hasPromptText(graph)).toBe(false)
    expect(findPromptTarget(graph)).toBeUndefined()
  })

  it('reports text when the graph holds a prompt it could not place', () => {
    // Only the negative side carries text here, and the walk never writes into
    // it: the run's prompt would replace the negative prompt. The caller has to
    // refuse rather than generate with something the user did not ask for.
    const graph = upscaler()
    graph['3'] = {
      class_type: 'KSampler',
      _meta: { title: 'sampler' },
      inputs: { positive: ['5', 0], negative: ['4', 0], seed: 1 }
    }
    graph['4'] = { class_type: 'CLIPTextEncode', _meta: { title: 'negative' }, inputs: { text: 'blurry' } }
    graph['5'] = { class_type: 'CLIPTextEncode', _meta: { title: 'positive' }, inputs: { text: ['6', 0] } }
    graph['6'] = { class_type: 'CLIPLoader', _meta: { title: 'clip' }, inputs: { clip_name: 'x' } }
    expect(hasPromptText(graph)).toBe(true)
    expect(findPromptTarget(graph)).toBeUndefined()
  })

  it('reports text when the graph only names a negative prompt', () => {
    // The negative prompt is not a place to write the run's prompt, but the
    // graph was built around a prompt: submitting it would drop the user's.
    const graph = upscaler()
    graph['3'] = {
      class_type: 'IdeogramPImage',
      _meta: { title: 'generator' },
      inputs: { 'model.negative_prompt': 'blurry', seed: 1 }
    }
    expect(hasPromptText(graph)).toBe(true)
    expect(findPromptTarget(graph)).toBeUndefined()
  })

  it('reports text for a prompt input fed from a node whose text it cannot name', () => {
    // The builder holds the text under names no prompt list knows, so the walk
    // finds nothing — but the generator's `prompt` socket is fed, and running
    // the workflow would quietly drop the prompt the user typed.
    const graph = upscaler()
    graph['3'] = {
      class_type: 'IdeogramPImage',
      _meta: { title: 'generator' },
      inputs: { prompt: ['4', 0], seed: 1 }
    }
    graph['4'] = {
      class_type: 'BuildJsonPromptIdeogram',
      _meta: { title: 'builder' },
      inputs: { high_level_description: 'a description' }
    }
    expect(hasPromptText(graph)).toBe(true)
    expect(findPromptTarget(graph)).toBeUndefined()
  })
})
