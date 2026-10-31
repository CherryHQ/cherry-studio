---
icon: square-info
---
# Embedding Model Reference Information

This page lists common embedding models and their maximum input length (in tokens), for filling in the knowledge base settings. Providers update their models often — check the linked official pages for the latest list.

{% hint style="info" %}
To stay on the safe side, some `max input` values here are slightly below the official maximum (for example 8191 instead of 8192). If you're unsure, use the values in this table.
{% endhint %}

{% hint style="success" %}
Want to work offline? Cherry Studio also has a built-in **local embedding model** (Qwen3 Embedding 0.6B) — see [Local Models](../pre-basic/settings/local-models.md).
{% endhint %}

### OpenAI

[Official model information](https://platform.openai.com/docs/guides/embeddings#embedding-models)

| Name | max input |
| --- | --- |
| text-embedding-3-small | 8191 |
| text-embedding-3-large | 8191 |

### Google Gemini

[Official model information](https://ai.google.dev/gemini-api/docs/embeddings)

| Name | max input |
| --- | --- |
| gemini-embedding-001 | 2048 |

### Jina

[Official model information](https://jina.ai/models/)

| Name | max input |
| --- | --- |
| jina-embeddings-v4 | 32768 |
| jina-embeddings-v3 | 8191 |
| jina-clip-v2 | 8191 |

### SiliconFlow

[Official model information](https://siliconflow.com/models)

| Name | max input |
| --- | --- |
| Qwen/Qwen3-Embedding-8B | 32768 |
| Qwen/Qwen3-Embedding-4B | 32768 |
| Qwen/Qwen3-Embedding-0.6B | 32768 |
| BAAI/bge-m3 | 8191 |
| netease-youdao/bce-embedding-base\_v1 | 512 |

### Cohere

[Official model information](https://docs.cohere.com/docs/models#embed)

| Name | max input |
| --- | --- |
| embed-v4.0 | 128000 |
| embed-english-v3.0 | 512 |
| embed-multilingual-v3.0 | 512 |

### Together AI

[Official model information](https://docs.together.ai/docs/serverless-models#embedding-models)

| Name                        | max input |
| ------------------------- | --------- |
| M2-BERT-80M-2K-Retrieval  | 2048      |
| M2-BERT-80M-8K-Retrieval  | 8192      |
| M2-BERT-80M-32K-Retrieval | 32768     |
| UAE-Large-v1              | 512       |
| BGE-Large-EN-v1.5         | 512       |
| BGE-Base-EN-v1.5          | 512       |

### nomic

[Official model information](https://docs.nomic.ai/atlas/embeddings-and-retrieval/text-embedding)

| Name                    | max input |
| --------------------- | --------- |
| nomic-embed-text-v1   | 8192      |
| nomic-embed-text-v1.5 | 8192      |
| gte-multilingual-base | 8192      |

### Upstage

[Official model information](https://console.upstage.ai/docs/capabilities/embeddings)

| Name                | max input |
| ----------------- | --------- |
| embedding-query   | 4000      |
| embedding-passage | 4000      |
