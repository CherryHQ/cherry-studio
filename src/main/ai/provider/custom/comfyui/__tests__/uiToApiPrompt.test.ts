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
        seed: ['INT', { default: 0, control_after_generate: true }],
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
  MarkdownNote: { input: { required: { text: ['STRING', {}] } } },
  // Integer-like keys iterate first in JS, so the bare object order is not the
  // declaration order — `input_order` is what the server sends instead.
  OrderedSampler: {
    input: { required: { '2': ['INT', {}], '1': ['STRING', {}] } },
    input_order: { required: ['1', '2'] }
  },
  // `strength` forces its widget into a socket (frontend ≥ 1.16), so it must
  // not spend a positional slot; `caption`/`styles` declare a widgetType.
  StyledImage: {
    input: {
      required: {
        image: ['IMAGE'],
        strength: ['FLOAT', { forceInput: true }],
        palette: ['PAINTER_INPUT', { widgetType: 'PAINTER' }],
        steps: ['INT', {}]
      }
    }
  }
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
            widgets_values: [0, 'fixed', 8, 1, 'res_multistep', 'simple', 1]
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

  it('rewires past a bypass to the producer the downstream input accepts', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: 'ImageProducer', outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [7] }] },
          { id: 2, type: 'MaskProducer', outputs: [{ name: 'MASK', type: 'MASK', links: [8] }] },
          {
            id: 3,
            type: 'Anything',
            mode: 4,
            // The wildcard output matches both, but only the MASK producer is
            // compatible with what the consumer's mask input declares.
            inputs: [
              { name: 'a', type: 'IMAGE', link: 7 },
              { name: 'b', type: 'MASK', link: 8 }
            ],
            outputs: [{ name: '*', type: '*', links: [9] }]
          },
          { id: 4, type: 'MaskConsumer', inputs: [{ name: 'mask', type: 'MASK', link: 9 }] }
        ],
        links: [link(7, 1, 0, 3, 0), link(8, 2, 0, 3, 1), link(9, 3, 0, 4, 0)]
      },
      {
        ...objectInfo,
        ImageProducer: { input: {} },
        MaskProducer: { input: {} },
        MaskConsumer: { input: { required: { mask: ['MASK'] } } }
      }
    )

    const masks = Object.values(prompt).find((n) => n.class_type === 'MaskConsumer')!
    expect(masks.inputs.mask).toEqual(['2', 0])
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

  it('aligns widget values over a COMBO-declared input', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [{ id: 1, type: 'ComboNode', widgets_values: ['Option 2', 3] }],
        links: []
      },
      {
        ComboNode: {
          input: { required: { mode: ['COMBO', { options: ['Option 1', 'Option 2'] }], steps: ['INT', {}] } }
        }
      }
    )

    expect(prompt['1'].inputs).toMatchObject({ mode: 'Option 2', steps: 3 })
  })

  it('keys object-form widget values by name', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [{ id: 1, type: 'NamedWidgets', widgets_values: { steps: 4, label: 'kept' } }],
        links: []
      },
      { NamedWidgets: { input: { required: { label: ['STRING', {}], steps: ['INT', {}] } } } }
    )

    expect(prompt['1'].inputs).toMatchObject({ label: 'kept', steps: 4 })
  })

  it('prefers the named widget values the frontend saves alongside the positional ones', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [
          {
            id: 1,
            type: 'NamedWidgets',
            widgets_values: ['stale positional'],
            widgets_values_named: { steps: 4 }
          }
        ],
        links: []
      },
      { NamedWidgets: { input: { required: { steps: ['INT', {}], label: ['STRING', {}] } } } }
    )

    expect(prompt['1'].inputs).toMatchObject({ steps: 4 })
    expect(prompt['1'].inputs).not.toHaveProperty('label')
    expect(prompt['1'].inputs).not.toHaveProperty('stale positional')
  })

  it('wraps a curve widget value in the frontend envelope', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [
          {
            id: 1,
            type: 'CurveNode',
            widgets_values: [
              {
                points: [
                  [0, 0],
                  [1, 1]
                ],
                interpolation: 'monotone_cubic'
              }
            ]
          }
        ],
        links: []
      },
      { CurveNode: { input: { required: { curve: ['CURVE', {}] } } } }
    )

    expect(prompt['1'].inputs.curve).toEqual({
      __type__: 'CURVE',
      __value__: {
        points: [
          [0, 0],
          [1, 1]
        ],
        interpolation: 'monotone_cubic'
      }
    })
  })

  it('aligns widget values across COLOR, COLORS, and RANGE widgets', () => {
    const { prompt, warnings } = convertUiWorkflowToPrompt(
      {
        nodes: [
          {
            id: 1,
            type: 'StyledImage',
            // Legacy positional-only values: the color widgets sit between the
            // string and the int, each spending exactly one slot.
            widgets_values: ['out', '#ff8800', ['#ff0000', '#00ff00'], { min: 0.25, max: 0.75 }, 7]
          }
        ],
        links: []
      },
      {
        StyledImage: {
          input: {
            required: {
              filename_prefix: ['STRING', {}],
              color: ['COLOR', {}],
              palette: ['COLORS', {}],
              span: ['RANGE', {}],
              steps: ['INT', {}]
            }
          }
        }
      }
    )

    // The colors serialize plainly and the colors array rides the generic
    // array envelope, matching the frontend's graphToPrompt.
    expect(prompt['1'].inputs).toEqual({
      filename_prefix: 'out',
      color: '#ff8800',
      palette: { __value__: ['#ff0000', '#00ff00'] },
      span: { min: 0.25, max: 0.75 },
      steps: 7
    })
    expect(warnings).toEqual([])
  })

  it('expands a DynamicCombo value with its selected option children', () => {
    const { prompt } = convertUiWorkflowToPrompt(
      {
        nodes: [{ id: 1, type: 'SaveImageAdvanced', widgets_values: ['ComfyUI', 'png', '16-bit', 'sRGB'] }],
        links: []
      },
      {
        SaveImageAdvanced: {
          input: {
            required: {
              images: ['IMAGE'],
              filename_prefix: ['STRING', {}],
              format: [
                'COMFY_DYNAMICCOMBO_V3',
                {
                  options: [
                    {
                      key: 'png',
                      inputs: {
                        required: {
                          bit_depth: [['8-bit', '16-bit'], { advanced: true }],
                          input_color_space: [['sRGB'], { advanced: true }]
                        }
                      }
                    },
                    {
                      key: 'avif',
                      inputs: {
                        required: {
                          bit_depth: [['auto'], { advanced: true }],
                          input_color_space: [['sRGB'], { advanced: true }],
                          crf: ['INT', { advanced: true }]
                        }
                      }
                    }
                  ]
                }
              ]
            }
          }
        }
      }
    )

    expect(prompt['1'].inputs).toMatchObject({
      filename_prefix: 'ComfyUI',
      format: 'png',
      'format.bit_depth': '16-bit',
      'format.input_color_space': 'sRGB'
    })
    expect(prompt['1'].inputs).not.toHaveProperty('format.crf')
  })

  it('applies a PrimitiveNode’s value to the widget it feeds and drops the node', () => {
    const { prompt, warnings } = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: 'EmptyLatentImage', widgets_values: [512, 512, 1] },
          {
            id: 2,
            type: 'PrimitiveNode',
            outputs: [{ name: 'INT', links: [6] }],
            widgets_values: [30]
          },
          {
            id: 3,
            type: 'KSampler',
            inputs: [
              { name: 'model', link: 3 },
              { name: 'seed', link: 4 },
              { name: 'steps', link: 6 },
              { name: 'positive', link: 7 },
              { name: 'negative', link: 8 },
              { name: 'latent_image', link: 5 }
            ],
            widgets_values: [0, 'fixed', 20, 8, 'res_multistep', 'simple', 1]
          },
          { id: 4, type: 'CheckpointLoaderSimple', widgets_values: ['model.safetensors'] }
        ],
        links: [
          link(3, 4, 0, 3, 0),
          link(4, 4, 0, 3, 1),
          link(5, 1, 0, 3, 5),
          link(6, 2, 0, 3, 2),
          link(7, 4, 0, 3, 3),
          link(8, 4, 0, 3, 4)
        ]
      },
      objectInfo
    )

    // The value lands on the widget, and the editor-only node never reaches the prompt.
    expect(prompt['3'].inputs.steps).toBe(30)
    expect(prompt['2']).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('reads positional values in the server’s declared input order', () => {
    const { prompt, warnings } = convertUiWorkflowToPrompt(
      { nodes: [{ id: 1, type: 'OrderedSampler', widgets_values: ['first', 2] }], links: [] },
      objectInfo
    )

    expect(prompt['1'].inputs).toMatchObject({ '1': 'first', '2': 2 })
    expect(warnings).toEqual([])
  })

  it('spends no positional slot on a forced input, and one on a widgetType override', () => {
    const styled = (widgets: unknown[]) => ({
      nodes: [
        { id: 1, type: 'EmptyLatentImage', widgets_values: [512, 512, 1] },
        {
          id: 2,
          type: 'StyledImage',
          inputs: [
            { name: 'image', link: 9 },
            { name: 'strength', link: 10 }
          ],
          widgets_values: widgets
        }
      ],
      links: [link(9, 1, 0, 2, 0), link(10, 2, 0, 2, 1)]
    })

    // Frontend ≥ 1.16: `strength` is a socket, so it saves no value, and the
    // unknown `PAINTER_INPUT` type still spends a slot because it declares one.
    const current = convertUiWorkflowToPrompt(styled(['80,20,20', 20]), objectInfo)
    expect(current.prompt['2'].inputs).toMatchObject({ palette: '80,20,20', steps: 20 })
    expect(current.warnings).toEqual([])

    // A workflow saved before 1.16 carries a dummy for `strength`; it is
    // dropped instead of shifting every later value onto the wrong input.
    const legacy = convertUiWorkflowToPrompt(styled([0.5, '80,20,20', 20]), objectInfo)
    expect(legacy.prompt['2'].inputs).toMatchObject({ palette: '80,20,20', steps: 20 })
    expect(legacy.warnings).toEqual([])
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

  it('prefers the seed-carrying sampler over a conditioning transformer', () => {
    const target = findPromptTarget({
      '1': { class_type: 'ConditioningTransformer', inputs: { positive: ['3', 0] }, _meta: { title: 'forwarder' } },
      '2': { class_type: 'KSampler', inputs: { seed: 7, positive: ['3', 0] }, _meta: { title: 'KSampler' } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: '' }, _meta: { title: 'pos' } }
    })

    expect(target).toEqual({ nodeId: '3', input: 'text', samplerId: '2' })
  })

  it('does not cross into the negative branch while following the positive chain', () => {
    const target = findPromptTarget({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: '' }, _meta: { title: 'pos' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: '' }, _meta: { title: 'neg' } },
      '3': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['2', 0] }, _meta: { title: 'zero' } },
      '4': {
        class_type: 'ConditioningCombine',
        inputs: { conditioning_1: ['1', 0], conditioning_2: ['3', 0] },
        _meta: { title: 'combine' }
      },
      '5': {
        class_type: 'KSampler',
        inputs: { seed: 7, positive: ['4', 0], negative: ['3', 0] },
        _meta: { title: 'KSampler' }
      }
    })

    expect(target).toEqual({ nodeId: '1', input: 'text', samplerId: '5' })
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

  it('targets the node itself when a self-contained generator owns the prompt', () => {
    // MiniMaxH3MLXTurbo takes the prompt as its own widget and schedules its own
    // noise: there is no `positive` edge anywhere in the graph to walk.
    const target = findPromptTarget({
      '1': {
        class_type: 'MiniMaxH3MLXTurbo',
        inputs: { prompt: 'a red car', model_profile: '8-bit', seed: 42, width: 864 },
        _meta: { title: 'MiniMaxH3MLXTurbo' }
      },
      '2': { class_type: 'CreateVideo', inputs: { images: ['1', 0], fps: 24 }, _meta: { title: 'video' } },
      '3': { class_type: 'SaveVideo', inputs: { video: ['2', 0] }, _meta: { title: 'save' } }
    })

    expect(target).toEqual({ nodeId: '1', input: 'prompt', samplerId: '1' })
  })

  it.each([
    ['CLIPTextEncodeFlux', { clip_l: 'kept', t5xxl: '' }, 't5xxl'],
    ['CLIPTextEncodeSD3', { clip_l: 'kept', clip_g: 'kept', t5xxl: '' }, 't5xxl'],
    ['CLIPLumina2Encode', { system_prompt: 'style', user_prompt: '' }, 'user_prompt']
  ])('recognizes the %s prompt streams', (classType, inputs, expected) => {
    const target = findPromptTarget({
      '1': { class_type: classType, inputs, _meta: { title: 'pos' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' }, _meta: { title: 'neg' } },
      '3': { class_type: 'KSampler', inputs: { positive: ['1', 0], negative: ['2', 0] }, _meta: { title: 'KSampler' } }
    })

    expect(target).toEqual({ nodeId: '1', input: expected, samplerId: '3' })
  })
})
