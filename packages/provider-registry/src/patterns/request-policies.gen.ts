// Generated from the catalog. Do not edit.
import type { ModelConfig } from '../schemas/model'
import type { MessageCompatibility } from '../schemas/requestPolicy'

export const REQUEST_POLICIES: Record<
  string,
  { parameterSupport?: Partial<NonNullable<ModelConfig['parameterSupport']>>; messages?: MessageCompatibility }
> = {
  '302ai/claude-fable-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  '302ai/claude-fable-5-1': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  '302ai/claude-haiku-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  '302ai/claude-opus-4-1-20250805': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  '302ai/claude-opus-4-5-20251101': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  '302ai/claude-opus-4-7-thinking': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  '302ai/claude-opus-4-8': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  '302ai/claude-opus-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  '302ai/claude-opus-5-thinking': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  '302ai/claude-sonnet-4-5-20250929-thinking': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  '302ai/claude-sonnet-4-6-thinking': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  '302ai/claude-sonnet-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  '302ai/claude-sonnet-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  '302ai/gemini-3-1-flash-image-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gemini-3-1-flash-lite': {
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gemini-3-1-flash-lite-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gemini-3-1-pro-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gemini-3-5-flash-lite': {
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gemini-3-5-flash-thinking': {
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gemini-3-6-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gemini-3-7-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gemini-3-8-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gemini-3-flash-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gemini-3-pro-image-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gemini-4-argon': {
    parameterSupport: {
      cachedContent: false,
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      },
      topK: {
        supported: false
      },
      frequencyPenalty: false,
      presencePenalty: false,
      maxTokens: true,
      stopSequences: true,
      systemMessage: true
    },
    messages: {
      thoughtSignatures: true
    }
  },
  '302ai/gpt-6-astra': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: false,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  '302ai/gpt-6-luna': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  '302ai/gpt-6-sol': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  '302ai/kimi-k2-5': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  '302ai/kimi-k2-6': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  '302ai/kimi-k2-7-code': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  '302ai/kimi-k2-thinking': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  '302ai/kimi-k3': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  '302ai/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  '302ai/qwen3-235b-a22b': {
    messages: {
      thinkingPrompt: true
    }
  },
  '302ai/qwen3-30b-a3b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'anthropic/claude-3-haiku': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    }
  },
  'anthropic/claude-opus-4': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'anthropic/claude-opus-4-1': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'anthropic/claude-sonnet-4': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'aws-bedrock/claude-fable-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'aws-bedrock/claude-haiku-4-5-20251001': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'aws-bedrock/claude-opus-4-1-20250805': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'aws-bedrock/claude-opus-4-5-20251101': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'aws-bedrock/claude-opus-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'aws-bedrock/claude-opus-4-7': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'aws-bedrock/claude-opus-4-8': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'aws-bedrock/claude-sonnet-4-5-20250929': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'aws-bedrock/claude-sonnet-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'aws-bedrock/kimi-k2-5': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'aws-bedrock/kimi-k2-thinking': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'aws-bedrock/qwen3-235b-a22b-2507': {
    messages: {
      thinkingPrompt: true
    }
  },
  'aws-bedrock/qwen3-32b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'claude-3-haiku': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    }
  },
  'claude-code/claude-fable-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-code/claude-fable-5-1': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-code/claude-haiku-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-haiku-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-code/claude-opus-4-1': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-opus-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-opus-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-opus-4-6[1m]': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-opus-4-7': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-opus-4-7[1m]': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-opus-4-8': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-opus-4-8[1m]': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-opus-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-code/claude-opus-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-code/claude-opus-5[1m]': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-code/claude-sonnet-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-sonnet-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-sonnet-4-6[1m]': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-code/claude-sonnet-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-code/claude-sonnet-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-fable-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-fable-5-1': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-fable-latest': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-haiku-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'claude-haiku-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-haiku-latest': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    }
  },
  'claude-opus-4': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-opus-4-1': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-opus-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'claude-opus-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-opus-4-7': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-opus-4-8': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-opus-4-8-fast': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-opus-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-opus-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-opus-5-fast': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-opus-latest': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    }
  },
  'claude-sonnet-4': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-sonnet-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'claude-sonnet-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'claude-sonnet-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-sonnet-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'claude-sonnet-latest': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    }
  },
  'copilot/claude-fable-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'copilot/claude-fable-5-1': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'copilot/claude-haiku-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'copilot/claude-opus-4-7': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'copilot/claude-opus-4-8': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'copilot/claude-opus-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'copilot/claude-opus-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'copilot/claude-sonnet-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'copilot/claude-sonnet-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'copilot/claude-sonnet-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'copilot/gemini-3-5-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'copilot/gemini-3-6-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'copilot/gemini-3-7-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'copilot/gemini-3-8-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'copilot/gemini-4-argon': {
    parameterSupport: {
      cachedContent: false,
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      },
      topK: {
        supported: false
      },
      frequencyPenalty: false,
      presencePenalty: false,
      maxTokens: true,
      stopSequences: true,
      systemMessage: true
    },
    messages: {
      thoughtSignatures: true
    }
  },
  'copilot/gpt-6-1-sol': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: false,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'copilot/gpt-6-astra': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: false,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'copilot/gpt-6-luna': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  'copilot/gpt-6-sol': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  'copilot/kimi-k2-7-code': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'copilot/kimi-k3': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'dashscope/kimi-k3': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'dashscope/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'dashscope/moonshot-kimi-k2-instruct': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'dashscope/qwen3-14b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'dashscope/qwen3-235b-a22b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'dashscope/qwen3-32b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'dmxapi/gemini-3-1-flash-image-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'doubao/qwen3-14b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'fireworks/kimi-k2-6': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'fireworks/kimi-k2-7-code': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'fireworks/kimi-k3': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'fireworks/kimi-k3-fast': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'fireworks/kimi-latest': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'fireworks/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'gateway/claude-3-haiku': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    }
  },
  'gateway/claude-fable-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'gateway/claude-fable-5-1': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'gateway/claude-haiku-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'gateway/claude-opus-4': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'gateway/claude-opus-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'gateway/claude-opus-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'gateway/claude-opus-4-7': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'gateway/claude-opus-4-8': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'gateway/claude-opus-4-8-fast': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'gateway/claude-opus-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'gateway/claude-opus-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'gateway/claude-opus-5-fast': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'gateway/claude-sonnet-4': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'gateway/claude-sonnet-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'gateway/claude-sonnet-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'gateway/claude-sonnet-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'gateway/claude-sonnet-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'gateway/gemini-3-1-flash-image': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-1-flash-image-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-1-flash-lite': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-1-flash-lite-image': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-1-pro-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-5-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-5-flash-lite': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-5-transcribe': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-6-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-7-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-8-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-3-pro-image': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gemini-4-argon': {
    parameterSupport: {
      cachedContent: false,
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      },
      topK: {
        supported: false
      },
      frequencyPenalty: false,
      presencePenalty: false,
      maxTokens: true,
      stopSequences: true,
      systemMessage: true
    },
    messages: {
      thoughtSignatures: true
    }
  },
  'gateway/gpt-6-1-sol': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: false,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'gateway/gpt-6-astra': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: false,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'gateway/gpt-6-luna': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  'gateway/gpt-6-sol': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  'gateway/kimi-k2-5': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'gateway/kimi-k2-6': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'gateway/kimi-k2-7-code': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'gateway/kimi-k2-7-code-highspeed': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'gateway/kimi-k2-thinking': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'gateway/kimi-k3': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'gateway/kimi-k3-fast': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'gateway/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'gateway/minimax-m3-1-flash': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'gateway/qwen3-235b-a22b-thinking': {
    messages: {
      thinkingPrompt: true
    }
  },
  'gemini-3-1-flash-image': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-1-flash-image-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-1-flash-lite': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-1-flash-lite-image': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-1-flash-lite-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-1-flash-live-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-1-flash-tts-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-1-pro-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-1-pro-preview-customtools': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-5-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-5-flash-lite': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-5-live-translate-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-5-transcribe': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-5-transcribe-live': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-6-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-7-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-8-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-flash-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-pro-image': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-3-pro-image-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini-4-argon': {
    parameterSupport: {
      cachedContent: false,
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      },
      topK: {
        supported: false
      },
      frequencyPenalty: false,
      presencePenalty: false,
      maxTokens: true,
      stopSequences: true,
      systemMessage: true
    },
    messages: {
      thoughtSignatures: true
    }
  },
  'gemini/gemini-3-1-flash-lite-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'gpt-6-1-sol': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: false,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'gpt-6-astra': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: false,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'gpt-6-luna': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  'gpt-6-sol': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  'huggingface/kimi-k2-5': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'huggingface/kimi-k2-6': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'huggingface/kimi-k2-7-code': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'huggingface/kimi-k2-instruct': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'huggingface/kimi-k2-thinking': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'huggingface/kimi-k3': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'huggingface/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'huggingface/qwen3-235b-a22b-thinking-2507': {
    messages: {
      thinkingPrompt: true
    }
  },
  'huggingface/qwen3-30b-a3b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'huggingface/qwen3-32b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'kimi-k2': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'kimi-k2-5': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'kimi-k2-6': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'kimi-k2-7-code': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'kimi-k2-7-code-highspeed': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'kimi-k2-instruct': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'kimi-k2-thinking-maas': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'kimi-k3': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'kimi-k3-fast': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'kimi-latest': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'lanyun/kimi-k2': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'lanyun/qwen3-235b-a22b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'lanyun/qwen3-32b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'minimax-global/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'minimax-global/minimax-m3-1-flash': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'minimax-m3-1-flash': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'minimax/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'minimax/minimax-m3-1-flash': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'modelscope/qwen3-235b-a22b-thinking-2507': {
    messages: {
      thinkingPrompt: true
    }
  },
  'modelscope/qwen3-30b-a3b-thinking-2507': {
    messages: {
      thinkingPrompt: true
    }
  },
  'moonshot-global/kimi-k2-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'moonshot-global/kimi-k2-6': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'moonshot-global/kimi-k2-7-code': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'moonshot-global/kimi-k2-7-code-highspeed': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'moonshot-global/kimi-k3': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'moonshot-global/kimi-k3-fast': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'moonshot-global/kimi-latest': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'moonshot/kimi-k2-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'moonshot/kimi-k2-6': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'moonshot/kimi-k2-7-code': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'moonshot/kimi-k2-7-code-highspeed': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'moonshot/kimi-k3': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'moonshot/kimi-k3-fast': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'moonshot/kimi-latest': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'nvidia/kimi-k2-6': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'nvidia/kimi-k3': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'nvidia/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'openai-codex/gpt-6-1-sol': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: false,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'openai-codex/gpt-6-astra': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: false,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'openai-codex/gpt-6-luna': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  'openai-codex/gpt-6-sol': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  'opencode/gpt-6-luna': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  'opencode/kimi-k2-5': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'opencode/kimi-k2-6': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'opencode/kimi-k2-7-code': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'opencode/kimi-k3': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'opencode/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'opencode/minimax-m3-1-flash': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'openrouter/claude-fable-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'openrouter/claude-fable-5-1': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'openrouter/claude-fable-latest': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'openrouter/claude-haiku-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'openrouter/claude-haiku-latest': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    }
  },
  'openrouter/claude-opus-4-1': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'openrouter/claude-opus-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'openrouter/claude-opus-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'openrouter/claude-opus-4-7': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'openrouter/claude-opus-4-8': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'openrouter/claude-opus-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'openrouter/claude-opus-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'openrouter/claude-opus-latest': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    }
  },
  'openrouter/claude-sonnet-4': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'openrouter/claude-sonnet-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'openrouter/claude-sonnet-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'openrouter/claude-sonnet-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'openrouter/claude-sonnet-5-5': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'openrouter/claude-sonnet-latest': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    }
  },
  'openrouter/gemini-3-1-flash-image': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-1-flash-image-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-1-flash-lite': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-1-flash-lite-image': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-1-flash-lite-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-1-pro-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-1-pro-preview-customtools': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-5-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-5-flash-lite': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-6-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-7-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-8-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-flash-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-pro-image': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-3-pro-image-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gemini-4-argon': {
    parameterSupport: {
      cachedContent: false,
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      },
      topK: {
        supported: false
      },
      frequencyPenalty: false,
      presencePenalty: false,
      maxTokens: true,
      stopSequences: true,
      systemMessage: true
    },
    messages: {
      thoughtSignatures: true
    }
  },
  'openrouter/gpt-6-1-sol': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: false,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'openrouter/gpt-6-astra': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: false,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'openrouter/gpt-6-luna': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  'openrouter/gpt-6-sol': {
    parameterSupport: {
      temperature: {
        requiresExplicitReasoningOff: true,
        supported: true
      },
      topP: {
        requiresExplicitReasoningOff: true,
        supported: true
      }
    }
  },
  'openrouter/kimi-k2-5': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'openrouter/kimi-k2-6': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'openrouter/kimi-k2-7-code': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'openrouter/kimi-k2-thinking': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'openrouter/kimi-k3': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'openrouter/kimi-latest': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'openrouter/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'openrouter/qwen3-14b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'openrouter/qwen3-235b-a22b-2507': {
    messages: {
      thinkingPrompt: true
    }
  },
  'openrouter/qwen3-30b-a3b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'openrouter/qwen3-32b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'openrouter/qwen3-8b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'poe/claude-haiku-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'poe/claude-opus-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'poe/claude-opus-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'poe/claude-opus-4-7': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'poe/claude-opus-4-8': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'poe/claude-sonnet-4-5': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'poe/claude-sonnet-4-6': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'poe/gemini-3-1-pro': {
    messages: {
      thoughtSignatures: true
    }
  },
  'ppio/kimi-k2-5': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'ppio/kimi-k2-instruct': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'ppio/kimi-k2-thinking': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'ppio/qwen3-235b-a22b-fp8': {
    messages: {
      thinkingPrompt: true
    }
  },
  'ppio/qwen3-30b-a3b-fp8': {
    messages: {
      thinkingPrompt: true
    }
  },
  'ppio/qwen3-32b-fp8': {
    messages: {
      thinkingPrompt: true
    }
  },
  'qwen-mt-plus': {
    messages: {
      translation: true
    }
  },
  'qwen-mt-turbo': {
    messages: {
      translation: true
    }
  },
  'qwen3-14b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'qwen3-235b-a22b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'qwen3-30b-a3b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'qwen3-32b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'qwen3-8b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'radeon-cloud/kimi-k2-6': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'silicon/kimi-k2-5': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'silicon/kimi-k2-6': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'silicon/kimi-k2-7-code': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'silicon/kimi-k3': {
    messages: {
      dynamicToolDeclarations: true
    }
  },
  'silicon/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'silicon/qwen3-14b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'silicon/qwen3-235b-a22b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'silicon/qwen3-32b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'silicon/qwen3-8b': {
    messages: {
      thinkingPrompt: true
    }
  },
  'together/kimi-k2-6': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'tokenhub/kimi-k2-5': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'tokenhub/kimi-k2-6': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'tokenhub/kimi-k2-7-code': {
    messages: {
      dynamicToolDeclarations: false
    }
  },
  'tokenhub/minimax-m3': {
    parameterSupport: {
      frequencyPenalty: true,
      maxTokens: true,
      presencePenalty: true,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: true
      },
      topK: {
        supported: false
      },
      topP: {
        supported: true
      }
    }
  },
  'vertexai/claude-fable-5-1@default': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'vertexai/claude-fable-5@default': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'vertexai/claude-haiku-4-5@20251001': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'vertexai/claude-opus-4-1@20250805': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'vertexai/claude-opus-4-5@20251101': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'vertexai/claude-opus-4-6@default': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'vertexai/claude-opus-4-7@default': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'vertexai/claude-opus-4-8@default': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'vertexai/claude-opus-4@20250514': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'vertexai/claude-opus-5-5@default': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'vertexai/claude-opus-5@default': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'vertexai/claude-sonnet-4-5@20250929': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        exclusiveWithTemperature: true,
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      interleavedThinkingBeta: true,
      vertexWebSearchBeta: true
    }
  },
  'vertexai/claude-sonnet-4-6@default': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'vertexai/claude-sonnet-4@20250514': {
    parameterSupport: {
      temperature: {
        range: {
          max: 1,
          min: 0
        },
        supported: true,
        whenReasoning: {
          supported: false
        }
      },
      topP: {
        supported: true,
        whenReasoning: {
          range: {
            max: 1,
            min: 0.95
          }
        }
      }
    },
    messages: {
      vertexWebSearchBeta: true
    }
  },
  'vertexai/claude-sonnet-5-5@default': {
    parameterSupport: {
      frequencyPenalty: false,
      maxTokens: true,
      presencePenalty: false,
      stopSequences: true,
      systemMessage: true,
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'vertexai/claude-sonnet-5@default': {
    parameterSupport: {
      temperature: {
        supported: false
      },
      topK: {
        supported: false
      },
      topP: {
        supported: false
      }
    }
  },
  'vertexai/gemini-3-1-flash-image': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-3-1-flash-lite': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-3-1-flash-lite-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-3-1-pro-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-3-1-pro-preview-customtools': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-3-5-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-3-5-flash-lite': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-3-6-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-3-7-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-3-8-flash': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-3-flash-preview': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-3-pro-image': {
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/gemini-4-argon': {
    parameterSupport: {
      cachedContent: false,
      temperature: {
        supported: false
      },
      topP: {
        supported: false
      },
      topK: {
        supported: false
      },
      frequencyPenalty: false,
      presencePenalty: false,
      maxTokens: true,
      stopSequences: true,
      systemMessage: true
    },
    messages: {
      thoughtSignatures: true
    }
  },
  'vertexai/kimi-k2-thinking-maas': {
    messages: {
      dynamicToolDeclarations: false
    }
  }
}
