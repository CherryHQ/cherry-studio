# @cherrystudio/ai-sdk-provider

CherryIN provider bundle for the [Vercel AI SDK](https://ai-sdk.dev/).  
It exposes the CherryIN OpenAI-compatible entrypoints and dynamically routes Anthropic and Gemini model ids to their CherryIN upstream equivalents.

## Installation

```bash
yarn add @cherrystudio/ai-sdk-provider
```

## Usage

```ts
import { createCherryIn, cherryIn } from '@cherrystudio/ai-sdk-provider'

const cherryInProvider = createCherryIn({
  apiKey: process.env.CHERRYIN_API_KEY,
  // optional overrides:
  // baseURL: 'https://open.cherryin.net/v1',
  // anthropicBaseURL: 'https://open.cherryin.net/anthropic',
  // geminiBaseURL: 'https://open.cherryin.net/gemini/v1beta',
})

// Chat models will auto-route based on the model id prefix:
const openaiModel = cherryInProvider.chat('gpt-4o-mini')
const anthropicModel = cherryInProvider.chat('claude-3-5-sonnet-latest')
const geminiModel = cherryInProvider.chat('gemini-2.0-pro-exp')

const { text } = await openaiModel.invoke('Hello CherryIN!')
```

The provider also exposes `completion`, `responses`, `embedding`, `image`, `transcription`, and `speech` helpers aligned with the upstream APIs.

See [AI SDK docs](https://ai-sdk.dev/providers/community-providers/custom-providers) for configuring custom providers.
