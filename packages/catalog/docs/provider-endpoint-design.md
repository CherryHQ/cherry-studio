# Provider Endpoint Schema Design ✅ IMPLEMENTED

## Problem Analysis

### Previous Issues (SOLVED)
1. ❌ **provider_type** was semantically unclear - represented API format/protocol, not provider type
2. ❌ **api_host** was in metadata but is a core configuration field
3. ❌ **anthropic_api_host** existed as a separate field for dual-protocol providers
4. ❌ **supported_endpoints** was too coarse-grained (all were "CHAT_COMPLETIONS")
5. ❌ No clear mapping between endpoint types, their API hosts, and request formats

### Real-World Patterns

Different LLM providers use different API formats:
- **OpenAI**: Covers `/v1/chat/completions`, `/v1/embeddings`, `/v1/images/generations`, etc.
- **Anthropic**: `/v1/messages` (Claude API)
- **Gemini**: Custom Google API format
- **DeepSeek**: Supports both OpenAI format AND Anthropic format at different base URLs

### Key Insight
Most providers share the same **base_url** for all their endpoints - only the API **format** and endpoint **path** differ.

## Final Schema Design (IMPLEMENTED)

### Two-Layer Abstraction

1. **Endpoint Type** - What functionality (chat, embeddings, images, etc.)
2. **API Format** - What protocol (OpenAI, Anthropic, Gemini, etc.)

```typescript
// Endpoint types - represents the API functionality
export const EndpointTypeSchema = z.enum([
  // LLM endpoints
  'CHAT_COMPLETIONS',
  'TEXT_COMPLETIONS',

  // Embedding endpoints
  'EMBEDDINGS',
  'RERANK',

  // Image endpoints
  'IMAGE_GENERATION',
  'IMAGE_EDIT',
  'IMAGE_VARIATION',

  // Audio endpoints
  'AUDIO_TRANSCRIPTION',
  'AUDIO_TRANSLATION',
  'TEXT_TO_SPEECH',

  // Video endpoints
  'VIDEO_GENERATION'
])

// API format types - represents the protocol/format of the API
export const ApiFormatSchema = z.enum([
  'OPENAI',     // OpenAI standard format (covers chat, embeddings, images, etc.)
  'ANTHROPIC',  // Anthropic format
  'GEMINI',     // Google Gemini API format
  'CUSTOM'      // Custom/proprietary format
])

// Format configuration - maps API format to base URL
export const FormatConfigSchema = z.object({
  format: ApiFormatSchema,
  base_url: z.string().url(),
  default: z.boolean().default(false)
})

// Provider schema with format configurations
export const ProviderConfigSchema = z.object({
  id: ProviderIdSchema,
  name: z.string(),
  description: z.string().optional(),
  authentication: AuthenticationSchema.default('API_KEY'),

  // API format configurations
  // Each provider can support multiple API formats (e.g., OpenAI + Anthropic)
  formats: z.array(FormatConfigSchema).min(1)
    .refine((formats) => formats.filter(f => f.default).length <= 1, {
      message: 'Only one format can be marked as default'
    }),

  // Supported endpoint types (optional, for documentation)
  supported_endpoints: z.array(EndpointTypeSchema).optional(),

  // API compatibility - kept for online updates
  api_compatibility: ApiCompatibilitySchema.optional(),

  documentation: z.string().url().optional(),
  website: z.string().url().optional(),
  deprecated: z.boolean().default(false),

  // Additional metadata (only truly extra fields go here)
  metadata: MetadataSchema
})
```

### Example Data

#### Single Format Provider (OpenAI)
```json
{
  "id": "openai",
  "name": "OpenAI",
  "formats": [
    {
      "format": "OPENAI",
      "base_url": "https://api.openai.com",
      "default": true
    }
  ],
  "supported_endpoints": [
    "CHAT_COMPLETIONS",
    "EMBEDDINGS",
    "IMAGE_GENERATION",
    "TEXT_TO_SPEECH",
    "AUDIO_TRANSCRIPTION"
  ]
}
```

#### Multi-Format Provider (DeepSeek)
```json
{
  "id": "deepseek",
  "name": "DeepSeek",
  "formats": [
    {
      "format": "OPENAI",
      "base_url": "https://api.deepseek.com",
      "default": true
    },
    {
      "format": "ANTHROPIC",
      "base_url": "https://api.deepseek.com/anthropic"
    }
  ],
  "supported_endpoints": ["CHAT_COMPLETIONS"]
}
```

#### Custom Format Provider (Anthropic)
```json
{
  "id": "anthropic",
  "name": "Anthropic",
  "formats": [
    {
      "format": "ANTHROPIC",
      "base_url": "https://api.anthropic.com",
      "default": true
    }
  ],
  "supported_endpoints": ["CHAT_COMPLETIONS"]
}
```

## Benefits

1. ✅ **Clear Semantics**: `format` clearly indicates the API protocol, `endpoint_type` indicates functionality
2. ✅ **Simplified Structure**: Same base_url for most providers, only format differs
3. ✅ **Multi-Protocol Support**: Providers can support multiple formats naturally (e.g., DeepSeek)
4. ✅ **Default Selection**: Client knows which format to use by default
5. ✅ **No Metadata Pollution**: Core config fields are top-level, not in metadata
6. ✅ **Extensible**: Easy to add new endpoint types or formats
7. ✅ **Business Logic Separation**: Schema doesn't encode priority/selection logic - that's for client code

## Migration Completed ✅

Migration script: `scripts/migrate-providers-to-formats.ts`

Transformations applied:
- `metadata.provider_type` → `formats[0].format` (mapped to OPENAI/ANTHROPIC/GEMINI)
- `metadata.api_host` → `formats[0].base_url`
- `metadata.anthropic_api_host` → `formats[1]` with format: ANTHROPIC
- `supported_endpoints` → set to ["CHAT_COMPLETIONS"] as default
- Cleaned metadata to remove migrated fields

## Special Cases

### Replicate (per-model endpoints)
For providers where each model has a unique endpoint URL:
- Provider defines `formats: [{ format: "CUSTOM", base_url: "https://api.replicate.com", default: true }]`
- Model stores custom endpoint in `metadata.custom_endpoint` or similar field
- Client code handles CUSTOM format by checking model metadata

### Future: Multiple Endpoint Types
When providers add support for embeddings, images, etc.:
- Simply update `supported_endpoints` array
- Client code maps `endpoint_type + format` to correct API path
  - Example: `EMBEDDINGS + OPENAI` → `{base_url}/v1/embeddings`
  - Example: `CHAT_COMPLETIONS + ANTHROPIC` → `{base_url}/v1/messages`
