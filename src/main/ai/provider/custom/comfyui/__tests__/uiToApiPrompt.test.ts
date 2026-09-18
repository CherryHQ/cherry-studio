import { describe, expect, it } from 'vitest'

import { convertUiWorkflowToPrompt, findPromptTarget, type ObjectInfo, type UiNode } from '../uiToApiPrompt'

/** Minimal `GET /object_info` response covering the classes used below. */
const objectInfo: ObjectInfo = {
  CheckpointLoaderSimple: {
    input: { required: { ckpt_name: [['model.safetensors'], {}] } }
  },
  CLIPTextEncode: {
    input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP'] } }
  },
  KSampler: {
    input: {
      required: {
        model: ['MODEL'],
        seed: ['INT', { default: 0 }],
        steps: ['INT', { default: 20 }],
        cfg: ['FLOAT', { default: 8 }],
        sampler_name: [['euler', 'res_multistep'], {}],
        scheduler: [['normal', 'simple'], {}],
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        latent_image: ['LATENT'],
        denoise: ['FLOAT', { default: 1 }]
      }
    }
  },
  EmptyLatentImage: {
    input: { required: { width: ['INT', {}], height: ['INT', {}], batch_size: ['INT', {}] } }
  },
  VAEDecode: { input: { required: { samples: ['LATENT'], vae: ['VAE'] } } },
  SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', {}] } } },
  ImageScale: {
    input: {
      required: { image: ['IMAGE'], upscale_method: [['nearest', 'lanczos'], {}] },
      optional: { crop: [['disabled', 'center'], { advanced: true }] }
    }
  },
  MarkdownNote: { input: { required: { text: ['STRING', {}] } } }
}

// Saved workflows carry a trailing type string; the converter only reads the
// first five slots, matching the UI-format link tuple.
const link = (id: number, origin: number, originSlot: number, target: number, targetSlot: number) => [
  id,
  origin,
  originSlot,
  target,
  targetSlot
]

describe('convertUiWorkflowToPrompt', () => {
  it('drops frontend-only nodes the backend cannot execute', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: 'MarkdownNote', widgets_values: ['hello'] },
          { id: 2, type: 'EmptyLatentImage', widgets_values: [512, 512, 1] }
        ],
        links: []
      },
      { EmptyLatentImage: objectInfo.EmptyLatentImage }
    )

    expect(Object.keys(prompt)).toEqual(['2'])
  })

  it('keeps widget values aligned when a link overrides one of them', () => {
    // `seed` arrives over a link, but its slot in `widgets_values` is still spent:
    // reading the remaining widgets positionally from the UI order would shift
    // every later value by one.
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: 'EmptyLatentImage', widgets_values: [512, 512, 1] },
          {
            id: 2,
            type: 'KSampler',
            inputs: [
              { name: 'model', link: 1 },
              { name: 'seed', link: 2 },
              { name: 'steps', link: null },
              { name: 'cfg', link: null },
              { name: 'sampler_name', link: null },
              { name: 'scheduler', link: null },
              { name: 'positive', link: 3 },
              { name: 'negative', link: 4 },
              { name: 'latent_image', link: 5 },
              { name: 'denoise', link: null }
            ],
            widgets_values: [0, 8, 1, 'res_multistep', 'simple', 1]
          },
          { id: 3, type: 'CheckpointLoaderSimple', widgets_values: ['model.safetensors'] }
        ],
        links: [link(1, 3, 0, 2, 0), link(2, 3, 0, 2, 1), link(3, 3, 0, 2, 6), link(4, 3, 0, 2, 7), link(5, 1, 0, 2, 8)]
      },
      objectInfo
    )

    expect(prompt['2'].inputs).toMatchObject({
      seed: ['3', 0],
      steps: 8,
      cfg: 1,
      sampler_name: 'res_multistep',
      scheduler: 'simple',
      denoise: 1
    })
  })

  it('discards the control_after_generate pseudo-widget value', () => {
    const { prompt, warnings } = convertUiWorkflowToPrompt(
      {
        nodes: [
          {
            id: 1,
            type: 'EmptyLatentImage',
            inputs: [
              { name: 'width', link: null },
              { name: 'height', link: null },
              { name: 'batch_size', link: null }
            ],
            widgets_values: [512, 512, 1]
          },
          {
            id: 2,
            type: 'KSampler',
            inputs: [
              { name: 'seed', link: null },
              { name: 'steps', link: null },
              { name: 'cfg', link: null },
              { name: 'sampler_name', link: null },
              { name: 'scheduler', link: null },
              { name: 'denoise', link: null },
              { name: 'latent_image', link: 1 }
            ],
            // One extra value after `seed` for control_after_generate.
            widgets_values: [0, 'randomize', 8, 1, 'res_multistep', 'simple', 1]
          }
        ],
        links: [link(1, 1, 0, 2, 6)]
      },
      objectInfo
    )

    expect(prompt['2'].inputs).toMatchObject({ seed: 0, steps: 8, cfg: 1, scheduler: 'simple' })
    expect(warnings).toEqual([])
  })

  it('expands a subgraph and binds its promoted inputs from the instance', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [
          {
            id: 5,
            type: 'sub-1',
            inputs: [
              { name: 'text', link: null, widget: { name: 'text' } },
              { name: 'latent', link: 9 }
            ],
            widgets_values: ['a harbour at dusk'],
            outputs: [{ name: 'IMAGE', links: [12] }]
          },
          { id: 8, type: 'EmptyLatentImage', widgets_values: [512, 512, 1] }
        ],
        links: [link(9, 8, 0, 5, 1)],
        definitions: {
          subgraphs: [
            {
              id: 'sub-1',
              inputNode: { id: -10 },
              outputNode: { id: -20 },
              inputs: [
                { name: 'text', linkIds: [34] },
                { name: 'latent', linkIds: [35] }
              ],
              outputs: [{ name: 'IMAGE', linkIds: [16] }],
              nodes: [
                {
                  id: 27,
                  type: 'CLIPTextEncode',
                  inputs: [{ name: 'text', link: 34, widget: { name: 'text' } }],
                  widgets_values: ['stale saved text']
                },
                {
                  id: 28,
                  type: 'VAEDecode',
                  inputs: [
                    { name: 'samples', link: 35 },
                    { name: 'vae', link: null }
                  ]
                }
              ],
              links: [link(34, -10, 0, 27, 0), link(35, -10, 1, 28, 0), link(16, 28, 0, -20, 0)]
            }
          ]
        }
      },
      objectInfo
    )

    // The instance's own value wins over the text stored inside the definition.
    const textNode = Object.values(prompt).find((n) => n.class_type === 'CLIPTextEncode')
    expect(textNode?.inputs.text).toBe('a harbour at dusk')
    // The promoted latent input resolves to the outer producer (inner nodes are
    // renumbered, so match the emitted id rather than the saved one).
    const producer = Object.entries(prompt).find(([, n]) => n.class_type === 'EmptyLatentImage')![0]
    const decode = Object.values(prompt).find((n) => n.class_type === 'VAEDecode')
    expect(decode?.inputs.samples).toEqual([producer, 0])
  })

  it('points a consumer of a subgraph output at the inner producer', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 5, type: 'sub-1', inputs: [], outputs: [{ name: 'IMAGE', links: [12] }] },
          { id: 6, type: 'SaveImage', inputs: [{ name: 'images', link: 12 }], widgets_values: ['out'] }
        ],
        links: [link(12, 5, 0, 6, 0)],
        definitions: {
          subgraphs: [
            {
              id: 'sub-1',
              inputNode: { id: -10 },
              outputNode: { id: -20 },
              inputs: [],
              outputs: [{ name: 'IMAGE', linkIds: [16] }],
              nodes: [{ id: 30, type: 'EmptyLatentImage', widgets_values: [64, 64, 1] }],
              links: [link(16, 30, 0, -20, 0)]
            }
          ]
        }
      },
      objectInfo
    )

    const inner = Object.entries(prompt).find(([, n]) => n.class_type === 'EmptyLatentImage')![0]
    expect(prompt[inner].inputs).toMatchObject({ width: 64, height: 64 })
    const save = Object.values(prompt).find((n) => n.class_type === 'SaveImage')!
    expect(save.inputs.images).toEqual([inner, 0])
  })

  it('rewires consumers past a bypassed node to that node input', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: 'EmptyLatentImage', widgets_values: [512, 512, 1] },
          {
            id: 2,
            type: 'ImageScale',
            mode: 4,
            inputs: [
              { name: 'image', link: 7 },
              { name: 'upscale_method', link: null }
            ],
            widgets_values: ['lanczos'],
            outputs: [{ name: 'IMAGE', links: [8] }]
          },
          { id: 3, type: 'SaveImage', inputs: [{ name: 'images', link: 8 }], widgets_values: ['out'] }
        ],
        links: [link(7, 1, 0, 2, 0), link(8, 2, 0, 3, 0)]
      },
      objectInfo
    )

    expect(Object.values(prompt).some((n) => n.class_type === 'ImageScale')).toBe(false)
    const producer = Object.entries(prompt).find(([, n]) => n.class_type === 'EmptyLatentImage')![0]
    const save = Object.values(prompt).find((n) => n.class_type === 'SaveImage')!
    expect(save.inputs.images).toEqual([producer, 0])
  })

  it('rewires past a bypassed node through the type-compatible input when slots differ', () => {
    const { prompt, warnings } = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: 'EmptyLatentImage', widgets_values: [512, 512, 1] },
          {
            id: 2,
            type: 'ImageScale',
            mode: 4,
            // Slot 0 is IMAGE while the output is LATENT — the frontend passes
            // the output through the type-compatible slot 1, not positionally.
            inputs: [
              { name: 'image', type: 'IMAGE', link: null },
              { name: 'latent_image', type: 'LATENT', link: 7 }
            ],
            widgets_values: ['lanczos'],
            outputs: [{ name: 'LATENT', type: 'LATENT', links: [8] }]
          },
          {
            id: 3,
            type: 'VAEDecode',
            inputs: [
              { name: 'samples', type: 'LATENT', link: 8 },
              { name: 'vae', type: 'VAE', link: null }
            ]
          }
        ],
        links: [link(7, 1, 0, 2, 1), link(8, 2, 0, 3, 0)]
      },
      objectInfo
    )

    const producer = Object.entries(prompt).find(([, n]) => n.class_type === 'EmptyLatentImage')![0]
    const decode = Object.values(prompt).find((n) => n.class_type === 'VAEDecode')!
    expect(decode.inputs.samples).toEqual([producer, 0])
    expect(warnings).toEqual([])
  })

  it('omits a muted node entirely', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: 'EmptyLatentImage', mode: 2, widgets_values: [512, 512, 1] },
          { id: 2, type: 'CLIPTextEncode', widgets_values: ['kept'] }
        ],
        links: []
      },
      objectInfo
    )

    expect(Object.values(prompt).map((n) => n.class_type)).toEqual(['CLIPTextEncode'])
  })

  it('rewires consumers past a frontend-only pass-through node', () => {
    const { prompt, warnings } = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: 'EmptyLatentImage', widgets_values: [512, 512, 1] },
          {
            id: 2,
            type: 'Reroute',
            inputs: [{ name: '', link: 7 }],
            outputs: [{ name: 'LATENT', links: [8] }]
          },
          {
            id: 3,
            type: 'VAEDecode',
            inputs: [
              { name: 'samples', link: 8 },
              { name: 'vae', link: null }
            ]
          }
        ],
        links: [link(7, 1, 0, 2, 0), link(8, 2, 0, 3, 0)]
      },
      objectInfo
    )

    const producer = Object.entries(prompt).find(([, n]) => n.class_type === 'EmptyLatentImage')![0]
    const decode = Object.values(prompt).find((n) => n.class_type === 'VAEDecode')!
    expect(decode.inputs.samples).toEqual([producer, 0])
    expect(warnings).toEqual([])
  })

  it('drops a consumer input that points at a muted node', () => {
    const { prompt, warnings } = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: 'EmptyLatentImage', mode: 2, widgets_values: [512, 512, 1] },
          {
            id: 2,
            type: 'VAEDecode',
            inputs: [
              { name: 'samples', link: 1 },
              { name: 'vae', link: null }
            ]
          }
        ],
        links: [link(1, 1, 0, 2, 0)]
      },
      objectInfo
    )

    const decode = Object.values(prompt).find((n) => n.class_type === 'VAEDecode')!
    expect(decode.inputs.samples).toBeUndefined()
    expect(warnings.join('\n')).toContain('dropped input samples')
  })

  it('settles an alias chain deeper than eight bypassed nodes', () => {
    const nodes: UiNode[] = [{ id: 1, type: 'EmptyLatentImage', widgets_values: [512, 512, 1] }]
    for (let id = 2; id <= 11; id += 1) {
      nodes.push({
        id,
        type: 'ImageScale',
        mode: 4,
        inputs: [{ name: 'image', link: id - 1 }],
        outputs: [{ name: 'IMAGE', links: [id] }]
      })
    }
    nodes.push({ id: 12, type: 'SaveImage', inputs: [{ name: 'images', link: 11 }], widgets_values: ['out'] })
    const links = Array.from({ length: 11 }, (_, i) => link(i + 1, i + 1, 0, i + 2, 0))

    const { prompt, warnings } = convertUiWorkflowToPrompt({ nodes, links }, objectInfo)

    const save = Object.values(prompt).find((n) => n.class_type === 'SaveImage')!
    expect(save.inputs.images).toEqual(['1', 0])
    expect(warnings).toEqual([])
  })

  it('wraps an array widget value so it is not read as a node connection', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      { nodes: [{ id: 1, type: 'ArrayWidget', widgets_values: [['a', 'b']] }], links: [] },
      { ArrayWidget: { input: { required: { frames: ['STRING', {}] } } } }
    )

    expect(prompt['1'].inputs.frames).toEqual({ __value__: ['a', 'b'] })
  })

  it('submits an unknown executable class as-is instead of rewiring it', () => {
    const { prompt, warnings } = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: 'CustomSamplerPack', widgets_values: ['ckpt'], outputs: [{ name: 'MODEL', links: [2] }] },
          {
            id: 2,
            type: 'KSampler',
            inputs: [{ name: 'model', link: 2 }],
            widgets_values: [0, 20, 8, 'euler', 'normal']
          }
        ],
        links: [link(2, 1, 0, 2, 0)]
      },
      { KSampler: objectInfo.KSampler }
    )

    expect(Object.values(prompt).some((n) => n.class_type === 'CustomSamplerPack')).toBe(true)
    expect(warnings.join('\n')).toContain('not in object_info')
  })

  it('keeps a legitimate widget value that reads like a control value', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [{ id: 1, type: 'WidgetTagger', widgets_values: ['fixed', 1, 'randomize'] }],
        links: []
      },
      { WidgetTagger: { input: { required: { tag: ['STRING', {}], steps: ['INT', {}] } } } }
    )

    expect(prompt['1'].inputs).toMatchObject({ tag: 'fixed', steps: 1 })
  })
})

describe('findPromptTarget', () => {
  it('picks the positive conditioning, not the negative one', () => {
    const target = findPromptTarget({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a harbour at dusk' }, _meta: { title: 'pos' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' }, _meta: { title: 'neg' } },
      '3': {
        class_type: 'KSampler',
        inputs: { positive: ['1', 0], negative: ['2', 0] },
        _meta: { title: 'KSampler' }
      }
    })

    expect(target).toEqual({ nodeId: '1', input: 'text', samplerId: '3' })
  })

  it('follows the positive conditioning chain to the text node', () => {
    const target = findPromptTarget({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a harbour at dusk' }, _meta: { title: 'pos' } },
      '2': { class_type: 'ConditioningCombine', inputs: { conditioning: ['1', 0] }, _meta: { title: 'combine' } },
      '3': {
        class_type: 'KSampler',
        inputs: { positive: ['2', 0], negative: ['1', 0] },
        _meta: { title: 'KSampler' }
      }
    })

    expect(target).toEqual({ nodeId: '1', input: 'text', samplerId: '3' })
  })

  it('returns nothing when no conditioning node carries text', () => {
    expect(
      findPromptTarget({ '1': { class_type: 'SaveImage', inputs: { images: ['2', 0] }, _meta: { title: 'x' } } })
    ).toBeUndefined()
  })

  it('recognizes the SDXL text encodes as prompt targets', () => {
    const target = findPromptTarget({
      '1': { class_type: 'CLIPTextEncodeSDXL', inputs: { text_g: '', text_l: 'kept' }, _meta: { title: 'pos' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' }, _meta: { title: 'neg' } },
      '3': {
        class_type: 'KSampler',
        inputs: { positive: ['1', 0], negative: ['2', 0] },
        _meta: { title: 'KSampler' }
      }
    })

    expect(target).toEqual({ nodeId: '1', input: 'text_g', samplerId: '3' })
  })
})
