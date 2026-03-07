# Provider Catalog Reference

This document describes the Provider/Model catalog system architecture, schemas, and data flows.

## Overview

The catalog system manages AI model and provider configurations with a three-layer merge architecture:

1. **Preset Layer** (read-only, bundled in app) - Catalog definitions
2. **Override Layer** (read-only) - Provider-specific model overrides
3. **User Layer** (SQLite, writable) - User customizations

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Data Layer Architecture                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   Preset Layer (Read-only)                    User Layer (SQLite, Writable)    │
│   ════════════════════════                    ═══════════════════════════      │
│                                                                                 │
│   providers.json                              user_provider                     │
│   • Provider configurations                   • Endpoint overrides              │
│   • Endpoint mappings                         • Multi API Key (1:N)             │
│   • API compatibility                         • API features override           │
│                                                                                 │
│   models.json                                 user_model (merged table)         │
│   • Base model definitions                    • presetModelId → override        │
│   • Capabilities, modalities                  • presetModelId null → custom     │
│   • Context windows, pricing                  • Source tracking                 │
│                                                                                 │
│   provider-models.json                                                          │
│   • Provider-model mappings                                                     │
│   • Provider-level overrides                                                    │
│   • Variant configurations                                                      │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Merge Priority

When resolving a model or provider configuration:

**Models**: `user_model` > `provider-models.json` > `models.json`

**Providers**: `user_provider` > `providers.json`

---

## Preset Schemas

Location: `packages/provider-catalog/src/schemas/`

### Provider Schema (`provider.ts`)

Defines how to connect to AI service providers.

```typescript
// Endpoint types encode format information
// CHAT_COMPLETIONS → OpenAI format
// MESSAGES → Anthropic format
// RESPONSES → OpenAI Responses API
// GENERATE_CONTENT → Gemini format

const EndpointTypeSchema = z.enum([
  // Text generation
  'CHAT_COMPLETIONS',    // OpenAI /v1/chat/completions
  'TEXT_COMPLETIONS',    // OpenAI /v1/completions (legacy)
  'MESSAGES',            // Anthropic /v1/messages
  'RESPONSES',           // OpenAI /v1/responses
  'GENERATE_CONTENT',    // Gemini /v1beta/models/{model}:generateContent

  // Embeddings
  'EMBEDDINGS',          // /v1/embeddings
  'RERANK',              // /v1/rerank

  // Images
  'IMAGE_GENERATION',    // /v1/images/generations
  'IMAGE_EDIT',          // /v1/images/edits

  // Audio
  'AUDIO_TRANSCRIPTION', // /v1/audio/transcriptions
  'AUDIO_TRANSLATION',   // /v1/audio/translations
  'TEXT_TO_SPEECH',      // /v1/audio/speech

  // Video
  'VIDEO_GENERATION'
])

const ProviderConfigSchema = z.object({
  id: z.string(),                              // Provider ID
  name: z.string(),                            // Display name
  description: z.string().optional(),

  // Endpoint configuration: type → full URL
  endpoints: z.record(z.string(), z.string().url()),
  // Example:
  // {
  //   'CHAT_COMPLETIONS': 'https://api.openai.com/v1/chat/completions',
  //   'EMBEDDINGS': 'https://api.openai.com/v1/embeddings'
  // }

  default_chat_endpoint: EndpointTypeSchema.optional(),

  api_compatibility: z.object({
    supports_array_content: z.boolean().optional(),   // default: true
    supports_stream_options: z.boolean().optional(),  // default: true
    supports_developer_role: z.boolean().optional(),  // default: true
    supports_service_tier: z.boolean().optional(),    // default: false
    supports_thinking_control: z.boolean().optional() // default: true
  }).optional(),

  website: z.string().url().optional(),
  models_api_url: z.string().url().optional(),        // Models list API
  metadata: z.record(z.string(), z.any()).optional()
})
```

### Model Schema (`model.ts`)

Defines model capabilities and configurations.

```typescript
const ModelCapabilityTypeSchema = z.enum([
  'FUNCTION_CALL',       // Function calling
  'REASONING',           // Extended thinking
  'IMAGE_RECOGNITION',   // Vision understanding
  'IMAGE_GENERATION',    // Image creation
  'AUDIO_RECOGNITION',   // Audio understanding
  'AUDIO_GENERATION',    // Speech synthesis
  'EMBEDDING',           // Vector embeddings
  'RERANK',              // Result reranking
  'AUDIO_TRANSCRIPT',    // Speech-to-text
  'VIDEO_RECOGNITION',   // Video understanding
  'VIDEO_GENERATION',    // Video creation
  'STRUCTURED_OUTPUT',   // JSON mode
  'FILE_INPUT',          // File attachments
  'WEB_SEARCH',          // Built-in search
  'CODE_EXECUTION',      // Code sandbox
  'FILE_SEARCH',         // File search
  'COMPUTER_USE'         // Computer control
])

const ModalitySchema = z.enum(['TEXT', 'VISION', 'AUDIO', 'VIDEO', 'VECTOR'])

const ModelConfigSchema = z.object({
  id: z.string(),                              // Model ID for API calls
  name: z.string().optional(),                 // Display name
  description: z.string().optional(),

  capabilities: z.array(ModelCapabilityTypeSchema).optional(),
  input_modalities: z.array(ModalitySchema).optional(),
  output_modalities: z.array(ModalitySchema).optional(),

  context_window: z.number().optional(),
  max_output_tokens: z.number().optional(),
  max_input_tokens: z.number().optional(),

  pricing: ModelPricingSchema.optional(),
  reasoning: ReasoningSchema.optional(),
  parameters: ParameterSupportSchema.optional(),

  family: z.string().optional(),               // e.g., "GPT-4", "Claude 3"
  publisher: z.string().optional(),            // e.g., "anthropic", "openai"
  open_weights: z.boolean().optional(),        // Weights publicly available
  alias: z.array(z.string()).optional(),       // Date version aliases

  metadata: z.record(z.string(), z.any()).optional()
})
```

### Provider-Models Schema (`provider-models.ts`)

Defines provider-specific model overrides.

```typescript
const CapabilityOverrideSchema = z.object({
  add: z.array(ModelCapabilityTypeSchema).optional(),    // Add capabilities
  remove: z.array(ModelCapabilityTypeSchema).optional(), // Remove capabilities
  force: z.array(ModelCapabilityTypeSchema).optional()   // Complete replacement
})

const ProviderModelOverrideSchema = z.object({
  provider_id: z.string(),
  model_id: z.string(),

  // Variant identifier for same model with different configurations
  // Examples: 'free', 'thinking', 'nitro', 'search'
  model_variant: z.string().optional(),

  capabilities: CapabilityOverrideSchema.optional(),
  limits: z.object({
    context_window: z.number().optional(),
    max_output_tokens: z.number().optional(),
    max_input_tokens: z.number().optional(),
    rate_limit: z.number().optional()          // Requests per minute
  }).optional(),

  pricing: ModelPricingSchema.partial().optional(),
  reasoning: ReasoningSchema.optional(),
  parameters: ParameterSupportSchema.partial().optional(),

  // Endpoint type overrides (when model uses different endpoints than provider default)
  endpoint_types: z.array(EndpointTypeSchema).optional(),
  // Modality overrides (when provider supports different modalities than base model)
  input_modalities: z.array(ModalitySchema).optional(),
  output_modalities: z.array(ModalitySchema).optional(),

  disabled: z.boolean().optional(),
  replace_with: z.string().optional(),

  reason: z.string().optional(),               // Override reason
  priority: z.number().default(0)              // Higher = takes precedence
})
```

---

## Runtime Types

Location: `packages/shared/data/types/`

### UniqueModelId

Format: `providerId::modelId`

```typescript
type UniqueModelId = `${string}::${string}`

// Create: createUniqueModelId('anthropic', 'claude-3-5-sonnet')
//         → 'anthropic::claude-3-5-sonnet'

// Parse: parseUniqueModelId('anthropic::claude-3-5-sonnet')
//        → { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' }
```

Uses `::` separator to avoid conflicts with model IDs containing `:` (e.g., `openrouter:anthropic/claude-3`).

### RuntimeModel

The merged "final state" model configuration for consumers.

```typescript
// Type-safe union types (mirroring catalog Zod enums)
type Modality = 'TEXT' | 'VISION' | 'AUDIO' | 'VIDEO' | 'VECTOR'
type EndpointType =
  | 'CHAT_COMPLETIONS' | 'TEXT_COMPLETIONS' | 'MESSAGES'
  | 'RESPONSES' | 'GENERATE_CONTENT'
  | 'EMBEDDINGS' | 'RERANK'
  | 'IMAGE_GENERATION' | 'IMAGE_EDIT'
  | 'AUDIO_TRANSCRIPTION' | 'AUDIO_TRANSLATION' | 'TEXT_TO_SPEECH'
  | 'VIDEO_GENERATION'

interface RuntimeReasoning {
  type: string                 // 'openai-chat', 'anthropic', 'gemini', etc.
  supportedEfforts: string[]
  defaultEffort?: string
  thinkingTokenLimits?: { min?: number; max?: number; default?: number }
  interleaved?: boolean        // Supports interleaved thinking output
}

interface RuntimeModel {
  uniqueId: UniqueModelId      // "anthropic::claude-3-5-sonnet"
  id: string                   // "claude-3-5-sonnet"
  providerId: string           // "anthropic"

  name: string
  description?: string
  group?: string               // UI grouping
  family?: string              // "Claude 3"
  ownedBy?: string

  capabilities: ModelCapability[]
  inputModalities?: Modality[]   // Supported input: TEXT, VISION, AUDIO, VIDEO
  outputModalities?: Modality[]  // Supported output: TEXT, VISION, AUDIO, VIDEO, VECTOR

  contextWindow?: number
  maxOutputTokens?: number
  maxInputTokens?: number

  endpointTypes?: EndpointType[] // Supported endpoint types (array, model may support multiple)
  supportsStreaming: boolean

  reasoning?: RuntimeReasoning
  parameters?: RuntimeParameterSupport
  pricing?: RuntimeModelPricing

  isEnabled: boolean
  isHidden: boolean
  replaceWith?: UniqueModelId
}
```

### RuntimeProvider

The merged "final state" provider configuration.

```typescript
interface RuntimeProvider {
  id: string
  source: 'preset' | 'user' | 'merged'
  presetProviderId?: string

  name: string
  description?: string

  endpoints: Record<string, string>
  defaultChatEndpoint?: string

  apiKeys: RuntimeApiKey[]
  activeApiKeyId?: string
  authType: 'api-key' | 'oauth' | 'iam-aws' | 'iam-gcp' | 'iam-azure'

  apiCompatibility: RuntimeApiCompatibility
  settings: RuntimeProviderSettings

  isEnabled: boolean
  isAuthenticated: boolean
}
```

---

## User Database Schemas

Location: `src/main/data/db/schemas/`

### user_provider Table

Stores user's provider configurations.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| providerId | TEXT | User-defined unique ID |
| presetProviderId | TEXT | Links to catalog preset |
| name | TEXT | Display name |
| endpoints | JSON | Endpoint URL overrides |
| defaultChatEndpoint | TEXT | Default text generation endpoint |
| apiKeys | JSON | Array of ApiKeyEntry |
| authConfig | JSON | Authentication configuration |
| apiCompatibility | JSON | API compatibility overrides |
| providerSettings | JSON | Provider-specific settings |
| isEnabled | BOOLEAN | Whether enabled |
| sortOrder | INTEGER | UI ordering |

**Design principle**: One provider instance = One API host (1:1 relationship)

### user_model Table

Stores all user models with fully resolved configurations. Capabilities are resolved once at add-time from catalog, so no runtime merge is needed.

| Column | Type | Description |
|--------|------|-------------|
| providerId | TEXT | Provider ID (part of PK) |
| modelId | TEXT | Model ID (part of PK) |
| presetModelId | TEXT | Traceability marker (which preset this came from) |
| name | TEXT | Display name |
| description | TEXT | Description |
| group | TEXT | UI grouping |
| capabilities | JSON | Complete capability list (resolved at add time) |
| inputModalities | JSON | Supported input modalities (e.g., TEXT, VISION, AUDIO) |
| outputModalities | JSON | Supported output modalities (e.g., TEXT, VISION, VECTOR) |
| endpointTypes | JSON | Endpoint type overrides (array) |
| customEndpointUrl | TEXT | Complete URL override |
| contextWindow | INTEGER | Context window override |
| maxOutputTokens | INTEGER | Max output override |
| supportsStreaming | BOOLEAN | Streaming support |
| reasoning | JSON | Reasoning configuration (includes `interleaved` flag) |
| parameters | JSON | Parameter support |
| isEnabled | BOOLEAN | Whether enabled |
| isHidden | BOOLEAN | Whether hidden in lists |
| sortOrder | INTEGER | UI ordering |

**Note**: `presetModelId` is a traceability marker only — it records which preset model was used as the template, but is not used for runtime merging.

---

## Merge Utilities

Location: `packages/shared/data/utils/modelMerger.ts`

### mergeModelConfig

Merges model configurations with proper priority.

```typescript
function mergeModelConfig(
  userModel: UserModel | null,
  catalogOverride: CatalogProviderModelOverride | null,
  presetModel: CatalogModel | null,
  providerId: string
): RuntimeModel

// Priority: userModel > catalogOverride > presetModel
```

### mergeProviderConfig

Merges provider configurations.

```typescript
function mergeProviderConfig(
  userProvider: UserProvider | null,
  presetProvider: CatalogProvider | null
): RuntimeProvider

// Priority: userProvider > presetProvider
```

### applyCapabilityOverride

Applies catalog provider-model capability modifications (not user-level).

```typescript
function applyCapabilityOverride(
  base: string[],
  override: { add?: string[]; remove?: string[]; force?: string[] }
): string[]

// 'force' completely replaces base
// Otherwise: add new, then remove specified
```

---

## Model ID Variants

### Variant Types

| Type | Example | Handling |
|------|---------|----------|
| Pricing variant | `:free`, `:nitro`, `-free` | Separate provider-models entry |
| Capability variant | `-thinking`, `-search` | capabilities.add in provider-models |
| Date version | `-20251101` | alias array in models.json |
| Provider prefix | `anthropic/`, `google/` | Strip during import |

### Normalization Rules

1. Strip provider prefixes: `anthropic/claude-3` → `claude-3`
2. Strip pricing suffixes: `claude-3:free` → `claude-3` (with variant entry)
3. Preserve capability variants: `claude-3-thinking` → separate handling
4. Track date versions: `gpt-4-turbo-2024-04-09` → in `alias` array

---

## Data Files

| File | Description |
|------|-------------|
| `packages/provider-catalog/data/providers.json` | Provider configurations |
| `packages/provider-catalog/data/models.json` | Base model definitions |
| `packages/provider-catalog/data/provider-models.json` | Provider-model overrides |
| `packages/provider-catalog/data/openrouter-models.json` | OpenRouter import data |
| `packages/provider-catalog/data/aihubmix-models.json` | AIHubMix import data |
| `packages/provider-catalog/data/modelsdev-models.json` | models.dev import data |

---

## API Compatibility Defaults

| Feature | Default | Description |
|---------|---------|-------------|
| `supports_array_content` | true | Array format for content |
| `supports_stream_options` | true | stream_options parameter |
| `supports_developer_role` | true | Developer role in messages |
| `supports_service_tier` | false | service_tier parameter |
| `supports_thinking_control` | true | Thinking control parameters |

---

## See Also

- [Data Management Overview](./README.md) - System selection and patterns
- [Catalog Web UI](../../packages/provider-catalog/web/) - Review and edit interface
