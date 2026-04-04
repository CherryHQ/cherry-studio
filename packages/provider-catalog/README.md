# Cherry Studio Catalog

Comprehensive AI model catalog with provider information, pricing, capabilities, and automatic synchronization.

## Quick Start

### 1. Setup API Keys

Most providers require API keys to list models:

```bash
# Copy example file
cp .env.example .env

# Edit .env and add your API keys
# OPENAI_API_KEY=sk-...
# GROQ_API_KEY=gsk_...
# DEEPSEEK_API_KEY=...
```

### 2. Sync Provider Models

**Option A: Sync all providers (batch)**
```bash
npm run sync:all
```

**Option B: Import authoritative sources**
```bash
# OpenRouter (360+ models)
npm run import:openrouter

# AIHubMix (600+ models)
npm run import:aihubmix
```

**Option C: Use Web UI**
```bash
cd web
npm run dev
# Open http://localhost:3000/providers
# Click "Sync" button on any provider
```

## Features

### Provider Management
- ✅ 51 providers configured with API endpoints
- ✅ Automatic model discovery via `models_api`
- ✅ Support for multiple API formats (OpenAI, Anthropic, Gemini)
- ✅ Custom transformers for aggregators

### Model Catalog
- ✅ 1000+ models from various providers
- ✅ Comprehensive metadata (pricing, capabilities, limits)
- ✅ Input/output modalities
- ✅ Case-insensitive model IDs

### Override System
- ✅ Provider-specific model overrides
- ✅ Tracks all provider-supported models (even if identical)
- ✅ Smart merging (preserves manual edits)
- ✅ Priority system (auto < 100 < manual)
- ✅ Automatic deduplication

### Synchronization
- ✅ Batch sync all providers
- ✅ Per-provider sync via Web UI
- ✅ API key management
- ✅ Rate limiting and error handling

## Data Files

```
data/
├── models.json       # Base model catalog (authoritative)
├── providers.json    # Provider configurations with models_api
└── overrides.json    # Provider-specific model overrides
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run sync:all` | Sync all providers (except OpenRouter/AIHubMix) |
| `npm run import:openrouter` | Import models from OpenRouter |
| `npm run import:aihubmix` | Import models from AIHubMix |
| `npm run build` | Build TypeScript package |
| `npm run test` | Run test suite |

## Architecture

### Transformers

Transform provider API responses to internal format:

- **OpenAI-compatible** (default): Standard `/v1/models` format
- **OpenRouter**: Custom aggregator format with advanced capabilities
- **AIHubMix**: CSV-based format with type/feature parsing

### Data Flow

```
Provider API → Transformer → ModelConfig[]
                                 ↓
                    Compare with models.json
                                 ↓
              ┌──────────────────┴─────────────────┐
              ↓                                     ↓
        New Model                            Existing Model
              ↓                                     ↓
    Add to models.json                    Generate Override
                                                    ↓
                                          Merge with existing
                                                    ↓
                                            Save to overrides.json
```

## Documentation

- [Sync Guide](./docs/SYNC_GUIDE.md) - Detailed synchronization documentation
- [Schema Documentation](./src/schemas/README.md) - Data schemas and validation

## Development

### Prerequisites

- Node.js 18+
- Yarn 4+

### Setup

```bash
# Install dependencies
yarn install

# Run tests
npm run test

# Build package
npm run build

# Watch mode
npm run dev
```

### Adding a Provider

1. Add provider config to `data/providers.json`:
```json
{
  "id": "new-provider",
  "name": "New Provider",
  "models_api": {
    "endpoints": [
      {
        "url": "https://api.provider.com/v1/models",
        "endpoint_type": "CHAT_COMPLETIONS",
        "format": "OPENAI"
      }
    ],
    "enabled": true,
    "update_frequency": "daily"
  }
}
```

2. Add API key mapping in `scripts/sync-all-providers.ts`:
```typescript
const PROVIDER_ENV_MAP: Record<string, string> = {
  // ...
  'new-provider': 'NEW_PROVIDER_API_KEY'
}
```

3. Add to `.env.example`:
```bash
NEW_PROVIDER_API_KEY=
```

4. Run sync:
```bash
npm run sync:all
```

### Adding a Custom Transformer

See [Transformers Guide](./docs/SYNC_GUIDE.md#transformers) for details.

## License

MIT

## Contributing

Contributions welcome! Please read the [Sync Guide](./docs/SYNC_GUIDE.md) first.
