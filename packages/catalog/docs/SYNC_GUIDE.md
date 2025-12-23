# Provider Model Synchronization Guide

This guide explains how to use the provider model synchronization system to automatically fetch and update model catalogs from provider APIs.

## Overview

The synchronization system consists of three main components:

1. **Provider API Configuration** (`models_api` in providers.json)
2. **Web UI Sync Button** (Manual sync per provider)
3. **Batch Sync Script** (Automated sync for all providers)

## Provider API Configuration

### Schema

Each provider can have a `models_api` configuration:

```json
{
  "id": "openrouter",
  "models_api": {
    "endpoints": [
      {
        "url": "https://openrouter.ai/api/v1/models",
        "endpoint_type": "CHAT_COMPLETIONS",
        "format": "OPENAI",
        "transformer": "openrouter"
      }
    ],
    "enabled": true,
    "update_frequency": "realtime",
    "last_synced": "2025-01-15T10:30:00.000Z"
  }
}
```

### Fields

- **`endpoints`**: Array of API endpoints to fetch models from
  - `url`: Full API endpoint URL
  - `endpoint_type`: Type of models (CHAT_COMPLETIONS, EMBEDDINGS, etc.)
  - `format`: API format (OPENAI, ANTHROPIC, GEMINI)
  - `transformer`: Optional custom transformer name (openrouter, aihubmix)

- **`enabled`**: Whether sync is enabled for this provider
- **`update_frequency`**: Suggested sync frequency
  - `realtime`: Aggregators that change frequently (OpenRouter, AIHubMix)
  - `daily`: Most official providers
  - `weekly`: Stable providers
  - `manual`: Manual sync only

- **`last_synced`**: ISO timestamp of last successful sync (auto-updated)

## Setup

### Environment Variables

Most providers require API keys to list their models. Configure your API keys:

1. **Copy the example file:**
   ```bash
   cd packages/catalog
   cp .env.example .env
   ```

2. **Edit `.env` and add your API keys:**
   ```bash
   # Official Providers
   OPENAI_API_KEY=sk-...
   GROQ_API_KEY=gsk_...
   TOGETHER_API_KEY=...

   # China Aggregators
   DEEPSEEK_API_KEY=...
   SILICON_API_KEY=...
   ```

3. **Keep `.env` secure:**
   - Never commit `.env` to git (already in `.gitignore`)
   - Use different keys for development and production
   - Rotate keys periodically

### API Key Format

Each provider has a corresponding environment variable:

| Provider ID | Environment Variable | Example Format |
|------------|---------------------|----------------|
| openai | `OPENAI_API_KEY` | `sk-...` |
| groq | `GROQ_API_KEY` | `gsk_...` |
| deepseek | `DEEPSEEK_API_KEY` | `sk-...` |
| silicon | `SILICON_API_KEY` | `sk-...` |
| together | `TOGETHER_API_KEY` | `...` |
| mistral | `MISTRAL_API_KEY` | `...` |
| perplexity | `PERPLEXITY_API_KEY` | `pplx-...` |

See `.env.example` for the complete list.

## Usage

### Method 1: Web UI (Per Provider)

1. Open the provider management page (`/providers`)
2. Find a provider with `models_api` enabled
3. Click the **Sync** button in the Actions column
4. Wait for the sync to complete (toast notification will show progress)
5. Review the statistics (fetched, new models, overrides)

**Features:**
- Real-time progress feedback
- Detailed statistics
- Manual trigger control
- Per-provider sync

**Use Cases:**
- Testing new provider configurations
- Emergency updates for specific providers
- Validating API changes

### Method 2: Batch Sync Script (All Providers)

Run the batch sync script to sync all providers at once:

```bash
cd packages/catalog
npm run sync:all
```

**Features:**
- Syncs all providers with `models_api.enabled = true`
- Skips OpenRouter and AIHubMix (use dedicated import scripts)
- Adds delays to avoid rate limiting
- Comprehensive progress logging
- Summary statistics

**Use Cases:**
- Scheduled updates (cron jobs, CI/CD)
- Initial bulk import
- Regular maintenance updates

**Output Example:**
```
============================================================
Batch Provider Model Sync
============================================================

Loading data files...

Loaded:
  - 51 providers
  - 604 models
  - 120 overrides

Providers to sync: 49
Skipping: openrouter, aihubmix (authoritative sources)

API Keys Status:
  ✓ Found: 12
  ✗ Missing: 37

Providers without API keys (will likely fail):
  - cherryin            (env: CHERRYIN_API_KEY)
  - silicon             (env: SILICON_API_KEY)
  ...

To configure API keys:
  1. Copy .env.example to .env
  2. Fill in your API keys
  3. Re-run this script

[deepseek] Syncing models...
  - Fetching from https://api.deepseek.com/v1/models
    ✓ Fetched 3 models
  + Adding 1 new models to models.json
  + Generated 2 new overrides

...

============================================================
Sync Summary
============================================================

Total providers: 49
  ✓ Successful: 47
  ✗ Failed: 2

Statistics:
  - Total models fetched: 520
  - New models added: 45
  - Overrides generated: 178
  - Overrides merged: 12

✓ Batch sync completed
============================================================
```

## How It Works

### Data Flow

```
Provider API → Transformer → ModelConfig
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

### Override Generation

The system automatically generates overrides for **all models** supported by a provider, even if identical to the base model. This serves two purposes:

1. **Provider Support Tracking**: Mark which providers support which models
2. **Difference Recording**: Record any differences from the base model

**Override Types:**

1. **Empty Override** (identical models):
   ```json
   {
     "provider_id": "groq",
     "model_id": "llama-3.1-8b",
     "priority": 0
   }
   ```
   This marks that the provider supports the model with no differences.

2. **Override with Differences**:
   ```json
   {
     "provider_id": "provider-x",
     "model_id": "gpt-4",
     "priority": 0,
     "pricing": {
       "input": { "per_million_tokens": 5.0, "currency": "USD" },
       "output": { "per_million_tokens": 15.0, "currency": "USD" }
     },
     "limits": {
       "context_window": 32000
     }
   }
   ```

**Priority System:**
- `priority < 100`: Auto-generated overrides (replaced on sync)
- `priority >= 100`: Manual overrides (preserved during sync)

### Merge Strategy

When syncing:

1. **New Models**: Added directly to `models.json`
2. **Existing Models with Differences**: Override created/updated in `overrides.json`
3. **Manual Overrides**: Preserved (priority >= 100)
4. **Auto Overrides**: Replaced with latest data (priority < 100)

## Transformers

### Built-in Transformers

1. **OpenAI-compatible** (default): Standard OpenAI API format
   - Used by most providers (deepseek, groq, together, etc.)
   - Handles `{ data: [...] }` responses
   - Basic capability inference

2. **OpenRouter**: Custom transformer for OpenRouter aggregator
   - Normalizes model IDs to lowercase
   - Extracts provider from model ID format (`openai/gpt-4`)
   - Advanced capability inference from supported_parameters
   - Pricing conversion (per-token → per-million)

3. **AIHubMix**: Custom transformer for AIHubMix aggregator
   - Normalizes model IDs to lowercase
   - Parses CSV fields (types, features, input_modalities)
   - Capability mapping (thinking → REASONING, etc.)
   - Provider extraction from model ID

### Adding Custom Transformers

To add a custom transformer:

1. Create `src/utils/importers/{provider}/transformer.ts`
2. Implement `ITransformer` interface
3. Update sync endpoint to use your transformer
4. Add transformer name to provider config

Example:
```typescript
import type { ModelConfig } from '../../../schemas'
import type { ITransformer } from '../base/base-transformer'

export class CustomTransformer implements ITransformer<CustomModel> {
  extractModels(response: any): CustomModel[] {
    // Extract models from API response
  }

  transform(apiModel: CustomModel): ModelConfig {
    // Transform to internal format
  }
}
```

## Best Practices

### 1. Authoritative Sources

OpenRouter and AIHubMix are treated as **authoritative sources** because:
- They aggregate models from multiple providers
- They have custom transformers with advanced logic
- They should be imported using dedicated scripts:
  ```bash
  npm run import:openrouter
  npm run import:aihubmix
  ```

### 2. Sync Frequency

Recommended sync frequencies:

| Provider Type | Frequency | Reason |
|--------------|-----------|--------|
| Aggregators | Daily | Models change frequently |
| Official APIs | Weekly | Stable, infrequent updates |
| Beta/Experimental | Manual | May have unstable APIs |

### 3. API Keys

Most providers require API keys for model listing:

**For Batch Script:**
- Configure in `.env` file (see Setup section above)
- Script will automatically use the appropriate key for each provider
- Missing keys will trigger warnings but won't stop the sync

**For Web UI:**
- Currently uses same `.env` file (server-side)
- Future enhancement: API key input field in UI

### 4. Rate Limiting

The batch script includes:
- 1-second delay between providers
- Error handling to continue on failures
- Retry logic (future enhancement)

### 5. Manual Overrides

To create manual overrides that won't be replaced:

1. Set `priority >= 100` in `overrides.json`
2. Add reason field to document why it's manual
3. These will be preserved during sync

Example:
```json
{
  "provider_id": "custom-provider",
  "model_id": "special-model",
  "priority": 100,
  "reason": "Custom pricing negotiated with provider",
  "pricing": {
    "input": { "per_million_tokens": 1.0, "currency": "USD" },
    "output": { "per_million_tokens": 2.0, "currency": "USD" }
  }
}
```

## Troubleshooting

### Provider Sync Fails

1. Check if `models_api.enabled = true`
2. Verify API endpoint URL is accessible
3. Check if API key is required
4. Review transformer compatibility

### Models Not Appearing

1. Check if model IDs are normalized to lowercase
2. Verify transformer is extracting models correctly
3. Check console logs for transformation errors

### Overrides Not Generated

1. Verify model exists in base `models.json`
2. Check if differences actually exist (pricing, capabilities, etc.)
3. Review merge strategy settings

## Future Enhancements

- [ ] API key management in Web UI
- [ ] Scheduled sync (cron-style)
- [ ] Sync history and audit log
- [ ] Conflict resolution UI
- [ ] Retry logic with exponential backoff
- [ ] Webhook notifications
- [ ] Differential sync (only changed models)
- [ ] Provider-specific transformers registry
