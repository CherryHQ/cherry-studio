# Cherry Studio oMLX Integration Branch

This branch adds optional local oMLX integration to Cherry Studio.

## What this branch adds

- oMLX model provider in Settings → Model Providers
- Local oMLX Agent backend
- Local model list support from oMLX / OpenAI-compatible API
- oMLX models available in Agent model picker
- Default oMLX API host: `http://127.0.0.1:8000`

## What this branch does not change

- CherryAI / CherryIN remain the default cloud model experience.
- The default assistant model remains `Qwen | CherryAI`.
- oMLX is optional and disabled by default.
- Users must manually enable oMLX if they want to use local models.

## Important note about CherryAI

The built-in `Qwen | CherryAI` model may require official CherryAI client signature support.
Fork or development builds may not include the official CherryAI signing secret.

If `Qwen | CherryAI` shows an invalid API key or invalid signature error, use one of the following:

1. Configure CherryIN or another cloud provider with your own API key.
2. Enable oMLX and use a local model.
3. Use the official Cherry Studio release for the built-in CherryAI experience.

## oMLX setup

Start your local oMLX OpenAI-compatible server first.

Example API endpoint:

```text
http://127.0.0.1:8000/v1/models
http://127.0.0.1:8000/v1/chat/completions
```

Then open Cherry Studio:

```text
Settings → Model Providers → oMLX
```

Enable oMLX and click “Get model list”.

## Recommended test

1. Confirm CherryIN appears before oMLX in Model Providers.
2. Confirm oMLX is disabled by default.
3. Enable oMLX manually.
4. Get the local model list.
5. Select an oMLX model.
6. Test chat and translation.
