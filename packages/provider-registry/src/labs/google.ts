import { googleModels } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'google',
  name: 'Google',
  fetchModels: googleModels(),
  modelsDevProviders: ['google', 'google-vertex'],
  families: ['gemini', 'gemma'],
  // `text-embedding-004/005` + `text-multilingual-embedding-*` are Google's Vertex embeddings — claim them
  // here so they aren't mis-attributed to OpenAI (bare `text-embedding`) or left to a gateway listing.
  idPrefixes: [
    'gemini',
    'gemma',
    'palm',
    'learnlm',
    'text-embedding-004',
    'text-embedding-005',
    'text-multilingual-embedding'
  ],
  webSearch: [
    'gemini-2',
    'gemini-3-flash',
    'gemini-3-pro',
    'gemini-3-5-flash',
    'gemini-3-5-pro',
    'gemini-flash-latest',
    'gemini-pro-latest',
    'gemini-flash-lite-latest'
  ],
  models: [
    {
      id: 'gemini-2-5-flash-image',
      name: 'gemini-2.5-flash-image',
      family: 'gemini-flash',
      // No web-search: only gemini-3 image models (Nano Banana Pro) ground on Google Search; 2.5 does not.
      capabilities: ['reasoning', 'image-recognition', 'image-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text', 'image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              imageResolution: {
                options: ['1K', '2K', '4K'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'gemini-3-pro-image-preview',
      name: 'gemini-3-pro-image-preview',
      family: 'gemini-pro',
      capabilities: ['reasoning', 'image-recognition', 'image-generation', 'file-input', 'web-search'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text', 'image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              imageResolution: {
                options: ['1K', '2K', '4K'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-4-0-ultra-generate-001',
      name: 'Imagen 4 Ultra',
      family: 'imagen',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['DONT_ALLOW', 'ALLOW_ADULT', 'ALLOW_ALL'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-4-0-fast-generate-001',
      name: 'Imagen 4 Fast',
      family: 'imagen',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['DONT_ALLOW', 'ALLOW_ADULT', 'ALLOW_ALL'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-4-0-generate-001',
      name: 'Imagen 4',
      family: 'imagen',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['DONT_ALLOW', 'ALLOW_ADULT', 'ALLOW_ALL'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'gemini-2-5-flash-image-preview',
      name: 'Nano Banana Preview (Gemini 2.5 Flash Image Preview)',
      family: 'gemini-flash',
      capabilities: ['reasoning', 'image-recognition', 'image-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text', 'image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              imageResolution: {
                options: ['1K', '2K', '4K'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-4',
      name: 'Imagen-4',
      family: 'imagen',
      capabilities: ['function-call', 'file-input', 'image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['DONT_ALLOW', 'ALLOW_ADULT', 'ALLOW_ALL'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-3',
      name: 'Imagen-3',
      family: 'imagen',
      capabilities: ['function-call', 'image-generation', 'file-input'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              negativePrompt: {
                multiline: true,
                type: 'text'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['DONT_ALLOW', 'ALLOW_ADULT', 'ALLOW_ALL'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-4-ultra',
      name: 'Imagen-4-Ultra',
      family: 'imagen',
      capabilities: ['function-call', 'file-input', 'image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['DONT_ALLOW', 'ALLOW_ADULT', 'ALLOW_ALL'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-3-fast',
      name: 'Imagen-3-Fast',
      family: 'imagen',
      capabilities: ['function-call', 'image-generation', 'file-input'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              negativePrompt: {
                multiline: true,
                type: 'text'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['DONT_ALLOW', 'ALLOW_ADULT', 'ALLOW_ALL'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-4-fast',
      name: 'Imagen-4-Fast',
      family: 'imagen',
      capabilities: ['function-call', 'file-input', 'image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['DONT_ALLOW', 'ALLOW_ADULT', 'ALLOW_ALL'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-4-0',
      name: 'Imagen 4 0',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['DONT_ALLOW', 'ALLOW_ADULT', 'ALLOW_ALL'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-4-0-fast-generate-preview-06-06',
      name: 'Imagen 4 0 Fast Generate Preview 06 06',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['DONT_ALLOW', 'ALLOW_ADULT', 'ALLOW_ALL'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-4-0-ultra',
      name: 'Imagen 4 0 Ultra',
      family: 'imagen',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['DONT_ALLOW', 'ALLOW_ADULT', 'ALLOW_ALL'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'gemini-3-1-flash-image-preview',
      name: 'Google: Nano Banana 2 (Gemini 3.1 Flash Image Preview)',
      family: 'gemini-flash',
      capabilities: ['reasoning', 'image-recognition', 'image-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text', 'image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              imageResolution: {
                options: ['1K', '2K', '4K'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-4-0-generate-preview-06-06',
      name: 'Imagen 4.0 Preview',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              numImages: {
                default: 4,
                max: 4,
                min: 1,
                type: 'range'
              },
              personGeneration: {
                options: ['ALLOW_ALL', 'ALLOW_ADULT', 'DONT_ALLOW'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'imagen-4-0-ultra-generate-preview-06-06',
      name: 'Imagen 4.0 Ultra Preview',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              personGeneration: {
                options: ['ALLOW_ALL', 'ALLOW_ADULT', 'DONT_ALLOW'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'gemini-3-pro-image',
      name: 'Nano Banana Pro (Gemini 3 Pro Image)',
      family: 'gemini',
      capabilities: [
        'function-call',
        'reasoning',
        'image-recognition',
        'image-generation',
        'structured-output',
        'file-input',
        'web-search'
      ],
      inputModalities: ['image', 'text'],
      outputModalities: ['text', 'image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                options: ['ASPECT_1_1', 'ASPECT_3_4', 'ASPECT_4_3', 'ASPECT_9_16', 'ASPECT_16_9'],
                render: 'chips',
                type: 'enum'
              },
              imageResolution: {
                options: ['1K', '2K', '4K'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    }
  ]
})
