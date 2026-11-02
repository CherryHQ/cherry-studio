# 嵌入与重排

数据来自 Cherry Studio 内置模型目录（[provider-registry](https://github.com/CherryHQ/cherry-studio/tree/main/packages/provider-registry)），随应用仓库自动同步；表中 `-` 表示数据源未提供该字段。

上下文长度与最大输出以 K / M 缩写并四舍五入（1K 约为 1,000～1,024 tokens，1M 约为 100 万 tokens），例如 131,072 与 128,000 均写作 128K。悬停可查看完整数值，精确限制请以模型服务商为准。

> **数据更新时间**: 2026-10-27 14:14:54 UTC / 2026-10-27 22:14:54 CST (北京时间)

<div data-models-table="num:2,3;sort:1;search:0,1;cap:4:识图,语音识别,视频理解,文件输入,嵌入,重排;in:5:图片输入=图片,音频输入=音频,视频输入=视频;out:6:文本输出=文本,向量输出=向量">

| 模型名称 | 服务商 | 上下文长度 | 最大输出 | 能力 | 输入模态 | 输出模态 |
| --- | --- | --- | --- | --- | --- | --- |
| Qwen3 Embedding 0.6B<br><code>qwen3-embedding-0-6b</code> | alibaba | <span title="32,768">32K</span> | <span title="32,768">32K</span> | 嵌入 | 文本 | 向量 |
| Qwen3 Embedding 4B<br><code>qwen3-embedding-4b</code> | alibaba | <span title="32,768">32K</span> | <span title="32,768">32K</span> | 嵌入 | 文本 | 向量 |
| Qwen3 Embedding 8B<br><code>qwen3-embedding-8b</code> | alibaba | <span title="32,768">32K</span> | <span title="32,768">32K</span> | 嵌入 | 文本 | 向量 |
| Qwen3 Reranker 0.6B<br><code>qwen3-reranker-0-6b</code> | alibaba | <span title="32,768">32K</span> | - | 重排 | 文本 | - |
| Qwen3 Reranker 4B<br><code>qwen3-reranker-4b</code> | alibaba | <span title="32,768">32K</span> | - | 重排 | 文本 | - |
| Qwen3 Reranker 8B<br><code>qwen3-reranker-8b</code> | alibaba | <span title="32,768">32K</span> | - | 重排 | 文本 | - |
| Titan Text Embeddings V2<br><code>titan-embed-text-v2</code> | amazon | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| BGE Base EN v1.5<br><code>bge-base-en-v1-5</code> | baai | 512 | - | 嵌入 | 文本 | 向量 |
| BGE Base ZH v1.5<br><code>bge-base-zh-v1-5</code> | baai | 512 | - | 嵌入 | 文本 | 向量 |
| BGE Large EN v1.5<br><code>bge-large-en-v1-5</code> | baai | 512 | - | 嵌入 | 文本 | 向量 |
| BGE Large ZH v1.5<br><code>bge-large-zh-v1-5</code> | baai | 512 | - | 嵌入 | 文本 | 向量 |
| BGE M3<br><code>bge-m3</code> | baai | <span title="8,192">8K</span> | <span title="1,024">1K</span> | 嵌入 | 文本 | 向量 |
| BGE Multilingual Gemma2<br><code>bge-multilingual-gemma2</code> | baai | <span title="8,192">8K</span> | - | 嵌入 | 文本 | 向量 |
| BGE Reranker Base<br><code>bge-reranker-base</code> | baai | 512 | - | 重排 | 文本 | - |
| BGE Reranker Large<br><code>bge-reranker-large</code> | baai | 512 | - | 重排 | 文本 | - |
| BGE Reranker v2 Gemma<br><code>bge-reranker-v2-gemma</code> | baai | <span title="8,192">8K</span> | - | 重排 | 文本 | - |
| BGE Reranker v2 M3<br><code>bge-reranker-v2-m3</code> | baai | <span title="8,192">8K</span> | - | 重排 | 文本 | - |
| BGE Small EN v1.5<br><code>bge-small-en-v1-5</code> | baai | 512 | - | 嵌入 | 文本 | 向量 |
| BGE Small ZH v1.5<br><code>bge-small-zh-v1-5</code> | baai | 512 | - | 嵌入 | 文本 | 向量 |
| Doubao Embedding Large Text<br><code>doubao-embedding-large-text</code> | bytedance | - | - | 嵌入 | 文本 | 向量 |
| Doubao Embedding Text<br><code>doubao-embedding-text</code> | bytedance | - | - | 嵌入 | 文本 | 向量 |
| Doubao Embedding Vision<br><code>doubao-embedding-vision</code> | bytedance | <span title="131,072">128K</span> | - | 嵌入 | 文本、图片、视频 | 向量 |
| Embed English Light v3.0<br><code>embed-english-light-v3-0</code> | cohere | 512 | - | 嵌入 | 文本 | 向量 |
| Embed English v3.0<br><code>embed-english-v3-0</code> | cohere | 512 | - | 嵌入 | 文本、图片 | 向量 |
| Embed Multilingual Light v3.0<br><code>embed-multilingual-light-v3-0</code> | cohere | 512 | - | 嵌入 | 文本 | 向量 |
| Embed Multilingual v3.0<br><code>embed-multilingual-v3-0</code> | cohere | 512 | - | 嵌入 | 文本、图片 | 向量 |
| Embed v4.0<br><code>embed-v4-0</code> | cohere | <span title="131,072">128K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本、图片 | 向量 |
| Rerank English v3.0<br><code>rerank-english-v3-0</code> | cohere | <span title="4,096">4K</span> | - | 重排 | 文本 | - |
| Rerank Multilingual v3.0<br><code>rerank-multilingual-v3-0</code> | cohere | <span title="4,096">4K</span> | - | 重排 | 文本 | - |
| Rerank v3.5<br><code>rerank-v3-5</code> | cohere | <span title="4,096">4K</span> | <span title="4,096">4K</span> | 重排 | 文本 | 文本 |
| Rerank v4 Fast<br><code>rerank-v4-fast</code> | cohere | <span title="32,768">32K</span> | <span title="32,000">32K</span> | 重排 | 文本 | 文本 |
| Rerank v4 Pro<br><code>rerank-v4-pro</code> | cohere | <span title="32,768">32K</span> | <span title="32,000">32K</span> | 重排 | 文本 | 文本 |
| Gemini Embedding 001<br><code>gemini-embedding-001</code> | google | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Gemini Embedding 2<br><code>gemini-embedding-2</code> | google | <span title="8,192">8K</span> | 1 | 识图、语音识别、视频理解、文件输入、嵌入 | 文本、图片、音频、视频 | 向量 |
| Gemini Embedding 2 Preview<br><code>gemini-embedding-2-preview</code> | google | <span title="8,192">8K</span> | - | 嵌入、识图、语音识别、视频理解、文件输入 | 文本、图片、音频、视频 | 向量 |
| Text Embedding 005<br><code>text-embedding-005</code> | google | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Text Multilingual Embedding 002<br><code>text-multilingual-embedding-002</code> | google | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Jina CLIP v1<br><code>jina-clip-v1</code> | jina | <span title="8,192">8K</span> | - | 嵌入 | 文本、图片 | 向量 |
| Jina CLIP v2<br><code>jina-clip-v2</code> | jina | <span title="8,192">8K</span> | - | 嵌入 | 文本、图片 | 向量 |
| Jina Code Embeddings 0.5B<br><code>jina-code-embeddings-0-5b</code> | jina | <span title="32,768">32K</span> | - | 嵌入 | 文本 | 向量 |
| Jina Code Embeddings 1.5B<br><code>jina-code-embeddings-1-5b</code> | jina | <span title="32,768">32K</span> | - | 嵌入 | 文本 | 向量 |
| Jina ColBERT v1 EN<br><code>jina-colbert-v1-en</code> | jina | <span title="8,192">8K</span> | - | 嵌入、重排 | 文本 | 向量 |
| Jina ColBERT v2<br><code>jina-colbert-v2</code> | jina | <span title="8,192">8K</span> | - | 嵌入、重排 | 文本 | 向量 |
| Jina Embedding B EN v1<br><code>jina-embedding-b-en-v1</code> | jina | 512 | - | 嵌入 | 文本 | 向量 |
| Jina Embeddings v2 Base Code<br><code>jina-embeddings-v2-base-code</code> | jina | <span title="8,192">8K</span> | - | 嵌入 | 文本 | 向量 |
| Jina Embeddings v2 Base DE<br><code>jina-embeddings-v2-base-de</code> | jina | <span title="8,192">8K</span> | - | 嵌入 | 文本 | 向量 |
| Jina Embeddings v2 Base EN<br><code>jina-embeddings-v2-base-en</code> | jina | <span title="8,192">8K</span> | - | 嵌入 | 文本 | 向量 |
| Jina Embeddings v2 Base ES<br><code>jina-embeddings-v2-base-es</code> | jina | <span title="8,192">8K</span> | - | 嵌入 | 文本 | 向量 |
| Jina Embeddings v2 Base ZH<br><code>jina-embeddings-v2-base-zh</code> | jina | <span title="8,192">8K</span> | - | 嵌入 | 文本 | 向量 |
| Jina Embeddings v3<br><code>jina-embeddings-v3</code> | jina | <span title="8,192">8K</span> | - | 嵌入 | 文本 | 向量 |
| Jina Embeddings v4<br><code>jina-embeddings-v4</code> | jina | <span title="32,768">32K</span> | - | 嵌入 | 文本、图片 | 向量 |
| Jina Embeddings v5 Omni Nano<br><code>jina-embeddings-v5-omni-nano</code> | jina | <span title="8,192">8K</span> | - | 嵌入 | 文本、图片 | 向量 |
| Jina Embeddings v5 Omni Small<br><code>jina-embeddings-v5-omni-small</code> | jina | <span title="32,768">32K</span> | - | 嵌入 | 文本、图片 | 向量 |
| Jina Embeddings v5 Text Nano<br><code>jina-embeddings-v5-text-nano</code> | jina | <span title="8,192">8K</span> | - | 嵌入 | 文本 | 向量 |
| Jina Embeddings v5 Text Small<br><code>jina-embeddings-v5-text-small</code> | jina | <span title="32,768">32K</span> | - | 嵌入 | 文本 | 向量 |
| Jina Reranker m0<br><code>jina-reranker-m0</code> | jina | <span title="10,240">10K</span> | - | 重排 | 文本、图片 | - |
| Jina Reranker v1 Base EN<br><code>jina-reranker-v1-base-en</code> | jina | <span title="8,192">8K</span> | - | 重排 | 文本 | - |
| Jina Reranker v1 Tiny EN<br><code>jina-reranker-v1-tiny-en</code> | jina | <span title="8,192">8K</span> | - | 重排 | 文本 | - |
| Jina Reranker v1 Turbo EN<br><code>jina-reranker-v1-turbo-en</code> | jina | <span title="8,192">8K</span> | - | 重排 | 文本 | - |
| Jina Reranker v2 Base Multilingual<br><code>jina-reranker-v2-base-multilingual</code> | jina | <span title="1,024">1K</span> | - | 重排 | 文本 | - |
| Jina Reranker v3<br><code>jina-reranker-v3</code> | jina | <span title="131,072">128K</span> | - | 重排 | 文本 | - |
| llama-3_2-nemoretriever-300m-embed-v1<br><code>llama-3-2-nemoretriever-300m-embed-v1</code> | meta | <span title="32,768">32K</span> | <span title="2,048">2K</span> | 嵌入 | 文本 | 向量 |
| llama-nemotron-embed-vl-1b-v2<br><code>llama-nemotron-embed-vl-1b-v2</code> | meta | <span title="32,768">32K</span> | <span title="2,048">2K</span> | 识图、文件输入、嵌入 | 文本、图片 | 向量 |
| llama-nemotron-rerank-vl-1b-v2<br><code>llama-nemotron-rerank-vl-1b-v2</code> | meta | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 识图、文件输入、重排 | 文本、图片 | 文本 |
| Codestral Embed<br><code>codestral-embed</code> | mistral | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Mistral Embed<br><code>mistral-embed</code> | mistral | <span title="8,192">8K</span> | <span title="3,072">3K</span> | 嵌入 | 文本 | 向量 |
| nv-embed-v1<br><code>nv-embed-v1</code> | nvidia | <span title="32,768">32K</span> | <span title="2,048">2K</span> | 嵌入 | 文本 | 向量 |
| nv-embedcode-7b-v1<br><code>nv-embedcode-7b-v1</code> | nvidia | <span title="32,768">32K</span> | <span title="2,048">2K</span> | 嵌入 | 文本 | 向量 |
| rerank-qa-mistral-4b<br><code>rerank-qa-mistral-4b</code> | nvidia | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 重排 | 文本 | 文本 |
| text-embedding-3-large<br><code>text-embedding-3-large</code> | openai | <span title="8,192">8K</span> | <span title="3,072">3K</span> | 嵌入 | 文本 | 向量 |
| text-embedding-3-small<br><code>text-embedding-3-small</code> | openai | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| text-embedding-ada-002<br><code>text-embedding-ada-002</code> | openai | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Embed v1 0.6b<br><code>pplx-embed-v1-0-6b</code> | vercel | <span title="32,000">32K</span> | - | 嵌入 | 文本 | 向量 |
| Embed v1 4b<br><code>pplx-embed-v1-4b</code> | vercel | <span title="32,000">32K</span> | - | 嵌入 | 文本 | 向量 |
| Rerank 1<br><code>rerank-1</code> | voyage | <span title="8,000">8K</span> | - | 重排 | 文本 | - |
| Rerank 2<br><code>rerank-2</code> | voyage | <span title="16,000">16K</span> | - | 重排 | 文本 | - |
| Rerank 2 Lite<br><code>rerank-2-lite</code> | voyage | <span title="8,000">8K</span> | - | 重排 | 文本 | - |
| Rerank 2.5<br><code>rerank-2-5</code> | voyage | <span title="32,000">32K</span> | <span title="32,000">32K</span> | 重排 | 文本 | 文本 |
| Rerank 2.5 Lite<br><code>rerank-2-5-lite</code> | voyage | <span title="32,000">32K</span> | <span title="32,000">32K</span> | 重排 | 文本 | 文本 |
| Rerank Lite 1<br><code>rerank-lite-1</code> | voyage | <span title="4,000">4K</span> | - | 重排 | 文本 | - |
| Voyage 2<br><code>voyage-2</code> | voyage | <span title="4,000">4K</span> | - | 嵌入 | 文本 | 向量 |
| Voyage 3<br><code>voyage-3</code> | voyage | <span title="32,000">32K</span> | - | 嵌入 | 文本 | 向量 |
| Voyage 3 Large<br><code>voyage-3-large</code> | voyage | <span title="32,000">32K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Voyage 3 Lite<br><code>voyage-3-lite</code> | voyage | <span title="32,000">32K</span> | - | 嵌入 | 文本 | 向量 |
| Voyage 3.5<br><code>voyage-3-5</code> | voyage | <span title="32,000">32K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Voyage 3.5 Lite<br><code>voyage-3-5-lite</code> | voyage | <span title="32,000">32K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Voyage 4<br><code>voyage-4</code> | voyage | <span title="32,000">32K</span> | - | 嵌入 | 文本 | 向量 |
| Voyage 4 Large<br><code>voyage-4-large</code> | voyage | <span title="32,000">32K</span> | - | 嵌入 | 文本 | 向量 |
| Voyage 4 Lite<br><code>voyage-4-lite</code> | voyage | <span title="32,000">32K</span> | - | 嵌入 | 文本 | 向量 |
| Voyage 4 Nano<br><code>voyage-4-nano</code> | voyage | <span title="32,000">32K</span> | - | 嵌入 | 文本 | 向量 |
| Voyage Code 2<br><code>voyage-code-2</code> | voyage | <span title="16,000">16K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Voyage Code 3<br><code>voyage-code-3</code> | voyage | <span title="32,000">32K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Voyage Finance 2<br><code>voyage-finance-2</code> | voyage | <span title="32,000">32K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Voyage Large 2<br><code>voyage-large-2</code> | voyage | <span title="16,000">16K</span> | - | 嵌入 | 文本 | 向量 |
| Voyage Large 2 Instruct<br><code>voyage-large-2-instruct</code> | voyage | <span title="16,000">16K</span> | - | 嵌入 | 文本 | 向量 |
| Voyage Law 2<br><code>voyage-law-2</code> | voyage | <span title="16,000">16K</span> | <span title="1,536">1.5K</span> | 嵌入 | 文本 | 向量 |
| Voyage Multilingual 2<br><code>voyage-multilingual-2</code> | voyage | <span title="32,000">32K</span> | - | 嵌入 | 文本 | 向量 |
| Voyage Multimodal 3<br><code>voyage-multimodal-3</code> | voyage | <span title="32,000">32K</span> | - | 嵌入 | 文本、图片 | 向量 |
| Voyage Multimodal 3.5<br><code>voyage-multimodal-3-5</code> | voyage | <span title="32,000">32K</span> | - | 嵌入 | 文本、图片、视频 | 向量 |
| BCE Embedding Base v1<br><code>bce-embedding-base-v1</code> | youdao | 512 | - | 嵌入 | 文本 | 向量 |
| BCE Reranker Base v1<br><code>bce-reranker-base-v1</code> | youdao | 512 | - | 重排 | 文本 | - |
| Embedding-3<br><code>embedding-3</code> | zhipu | <span title="8,192">8K</span> | - | 嵌入 | 文本 | 向量 |

</div>
