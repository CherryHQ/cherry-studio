# Embedding & Rerank

Data comes from the model catalog bundled with Cherry Studio ([provider-registry](https://github.com/CherryHQ/cherry-studio/tree/main/packages/provider-registry)), synced automatically with the application repository; a `-` means the source data does not provide that field.

Context length and max output are abbreviated with K / M and rounded (1K is roughly 1,000–1,024 tokens, 1M roughly one million), e.g. 131,072 and 128,000 both read 128K. Hover a value to see the exact number; confirm limits with the model provider.

> **Data updated**: 2026-10-27 14:14:54 UTC / 2026-10-27 22:14:54 CST (Beijing time)

<div data-models-table="num:2,3;sort:1;search:0,1;cap:4:Image recognition,Speech recognition,Video understanding,File input,Embedding,Rerank;in:5:Image input=Image,Audio input=Audio,Video input=Video;out:6:Text output=Text,Vector output=Vector">

| Model | Provider | Context | Max output | Capabilities | Input modalities | Output modalities |
| --- | --- | --- | --- | --- | --- | --- |
| Qwen3 Embedding 0.6B<br><code>qwen3-embedding-0-6b</code> | alibaba | <span title="32,768">32K</span> | <span title="32,768">32K</span> | Embedding | Text | Vector |
| Qwen3 Embedding 4B<br><code>qwen3-embedding-4b</code> | alibaba | <span title="32,768">32K</span> | <span title="32,768">32K</span> | Embedding | Text | Vector |
| Qwen3 Embedding 8B<br><code>qwen3-embedding-8b</code> | alibaba | <span title="32,768">32K</span> | <span title="32,768">32K</span> | Embedding | Text | Vector |
| Qwen3 Reranker 0.6B<br><code>qwen3-reranker-0-6b</code> | alibaba | <span title="32,768">32K</span> | - | Rerank | Text | - |
| Qwen3 Reranker 4B<br><code>qwen3-reranker-4b</code> | alibaba | <span title="32,768">32K</span> | - | Rerank | Text | - |
| Qwen3 Reranker 8B<br><code>qwen3-reranker-8b</code> | alibaba | <span title="32,768">32K</span> | - | Rerank | Text | - |
| Titan Text Embeddings V2<br><code>titan-embed-text-v2</code> | amazon | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| BGE Base EN v1.5<br><code>bge-base-en-v1-5</code> | baai | 512 | - | Embedding | Text | Vector |
| BGE Base ZH v1.5<br><code>bge-base-zh-v1-5</code> | baai | 512 | - | Embedding | Text | Vector |
| BGE Large EN v1.5<br><code>bge-large-en-v1-5</code> | baai | 512 | - | Embedding | Text | Vector |
| BGE Large ZH v1.5<br><code>bge-large-zh-v1-5</code> | baai | 512 | - | Embedding | Text | Vector |
| BGE M3<br><code>bge-m3</code> | baai | <span title="8,192">8K</span> | <span title="1,024">1K</span> | Embedding | Text | Vector |
| BGE Multilingual Gemma2<br><code>bge-multilingual-gemma2</code> | baai | <span title="8,192">8K</span> | - | Embedding | Text | Vector |
| BGE Reranker Base<br><code>bge-reranker-base</code> | baai | 512 | - | Rerank | Text | - |
| BGE Reranker Large<br><code>bge-reranker-large</code> | baai | 512 | - | Rerank | Text | - |
| BGE Reranker v2 Gemma<br><code>bge-reranker-v2-gemma</code> | baai | <span title="8,192">8K</span> | - | Rerank | Text | - |
| BGE Reranker v2 M3<br><code>bge-reranker-v2-m3</code> | baai | <span title="8,192">8K</span> | - | Rerank | Text | - |
| BGE Small EN v1.5<br><code>bge-small-en-v1-5</code> | baai | 512 | - | Embedding | Text | Vector |
| BGE Small ZH v1.5<br><code>bge-small-zh-v1-5</code> | baai | 512 | - | Embedding | Text | Vector |
| Doubao Embedding Large Text<br><code>doubao-embedding-large-text</code> | bytedance | - | - | Embedding | Text | Vector |
| Doubao Embedding Text<br><code>doubao-embedding-text</code> | bytedance | - | - | Embedding | Text | Vector |
| Doubao Embedding Vision<br><code>doubao-embedding-vision</code> | bytedance | <span title="131,072">128K</span> | - | Embedding | Text, Image, Video | Vector |
| Embed English Light v3.0<br><code>embed-english-light-v3-0</code> | cohere | 512 | - | Embedding | Text | Vector |
| Embed English v3.0<br><code>embed-english-v3-0</code> | cohere | 512 | - | Embedding | Text, Image | Vector |
| Embed Multilingual Light v3.0<br><code>embed-multilingual-light-v3-0</code> | cohere | 512 | - | Embedding | Text | Vector |
| Embed Multilingual v3.0<br><code>embed-multilingual-v3-0</code> | cohere | 512 | - | Embedding | Text, Image | Vector |
| Embed v4.0<br><code>embed-v4-0</code> | cohere | <span title="131,072">128K</span> | <span title="1,536">1.5K</span> | Embedding | Text, Image | Vector |
| Rerank English v3.0<br><code>rerank-english-v3-0</code> | cohere | <span title="4,096">4K</span> | - | Rerank | Text | - |
| Rerank Multilingual v3.0<br><code>rerank-multilingual-v3-0</code> | cohere | <span title="4,096">4K</span> | - | Rerank | Text | - |
| Rerank v3.5<br><code>rerank-v3-5</code> | cohere | <span title="4,096">4K</span> | <span title="4,096">4K</span> | Rerank | Text | Text |
| Rerank v4 Fast<br><code>rerank-v4-fast</code> | cohere | <span title="32,768">32K</span> | <span title="32,000">32K</span> | Rerank | Text | Text |
| Rerank v4 Pro<br><code>rerank-v4-pro</code> | cohere | <span title="32,768">32K</span> | <span title="32,000">32K</span> | Rerank | Text | Text |
| Gemini Embedding 001<br><code>gemini-embedding-001</code> | google | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Gemini Embedding 2<br><code>gemini-embedding-2</code> | google | <span title="8,192">8K</span> | 1 | Image recognition, Speech recognition, Video understanding, File input, Embedding | Text, Image, Audio, Video | Vector |
| Gemini Embedding 2 Preview<br><code>gemini-embedding-2-preview</code> | google | <span title="8,192">8K</span> | - | Embedding, Image recognition, Speech recognition, Video understanding, File input | Text, Image, Audio, Video | Vector |
| Text Embedding 005<br><code>text-embedding-005</code> | google | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Text Multilingual Embedding 002<br><code>text-multilingual-embedding-002</code> | google | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Jina CLIP v1<br><code>jina-clip-v1</code> | jina | <span title="8,192">8K</span> | - | Embedding | Text, Image | Vector |
| Jina CLIP v2<br><code>jina-clip-v2</code> | jina | <span title="8,192">8K</span> | - | Embedding | Text, Image | Vector |
| Jina Code Embeddings 0.5B<br><code>jina-code-embeddings-0-5b</code> | jina | <span title="32,768">32K</span> | - | Embedding | Text | Vector |
| Jina Code Embeddings 1.5B<br><code>jina-code-embeddings-1-5b</code> | jina | <span title="32,768">32K</span> | - | Embedding | Text | Vector |
| Jina ColBERT v1 EN<br><code>jina-colbert-v1-en</code> | jina | <span title="8,192">8K</span> | - | Embedding, Rerank | Text | Vector |
| Jina ColBERT v2<br><code>jina-colbert-v2</code> | jina | <span title="8,192">8K</span> | - | Embedding, Rerank | Text | Vector |
| Jina Embedding B EN v1<br><code>jina-embedding-b-en-v1</code> | jina | 512 | - | Embedding | Text | Vector |
| Jina Embeddings v2 Base Code<br><code>jina-embeddings-v2-base-code</code> | jina | <span title="8,192">8K</span> | - | Embedding | Text | Vector |
| Jina Embeddings v2 Base DE<br><code>jina-embeddings-v2-base-de</code> | jina | <span title="8,192">8K</span> | - | Embedding | Text | Vector |
| Jina Embeddings v2 Base EN<br><code>jina-embeddings-v2-base-en</code> | jina | <span title="8,192">8K</span> | - | Embedding | Text | Vector |
| Jina Embeddings v2 Base ES<br><code>jina-embeddings-v2-base-es</code> | jina | <span title="8,192">8K</span> | - | Embedding | Text | Vector |
| Jina Embeddings v2 Base ZH<br><code>jina-embeddings-v2-base-zh</code> | jina | <span title="8,192">8K</span> | - | Embedding | Text | Vector |
| Jina Embeddings v3<br><code>jina-embeddings-v3</code> | jina | <span title="8,192">8K</span> | - | Embedding | Text | Vector |
| Jina Embeddings v4<br><code>jina-embeddings-v4</code> | jina | <span title="32,768">32K</span> | - | Embedding | Text, Image | Vector |
| Jina Embeddings v5 Omni Nano<br><code>jina-embeddings-v5-omni-nano</code> | jina | <span title="8,192">8K</span> | - | Embedding | Text, Image | Vector |
| Jina Embeddings v5 Omni Small<br><code>jina-embeddings-v5-omni-small</code> | jina | <span title="32,768">32K</span> | - | Embedding | Text, Image | Vector |
| Jina Embeddings v5 Text Nano<br><code>jina-embeddings-v5-text-nano</code> | jina | <span title="8,192">8K</span> | - | Embedding | Text | Vector |
| Jina Embeddings v5 Text Small<br><code>jina-embeddings-v5-text-small</code> | jina | <span title="32,768">32K</span> | - | Embedding | Text | Vector |
| Jina Reranker m0<br><code>jina-reranker-m0</code> | jina | <span title="10,240">10K</span> | - | Rerank | Text, Image | - |
| Jina Reranker v1 Base EN<br><code>jina-reranker-v1-base-en</code> | jina | <span title="8,192">8K</span> | - | Rerank | Text | - |
| Jina Reranker v1 Tiny EN<br><code>jina-reranker-v1-tiny-en</code> | jina | <span title="8,192">8K</span> | - | Rerank | Text | - |
| Jina Reranker v1 Turbo EN<br><code>jina-reranker-v1-turbo-en</code> | jina | <span title="8,192">8K</span> | - | Rerank | Text | - |
| Jina Reranker v2 Base Multilingual<br><code>jina-reranker-v2-base-multilingual</code> | jina | <span title="1,024">1K</span> | - | Rerank | Text | - |
| Jina Reranker v3<br><code>jina-reranker-v3</code> | jina | <span title="131,072">128K</span> | - | Rerank | Text | - |
| llama-3_2-nemoretriever-300m-embed-v1<br><code>llama-3-2-nemoretriever-300m-embed-v1</code> | meta | <span title="32,768">32K</span> | <span title="2,048">2K</span> | Embedding | Text | Vector |
| llama-nemotron-embed-vl-1b-v2<br><code>llama-nemotron-embed-vl-1b-v2</code> | meta | <span title="32,768">32K</span> | <span title="2,048">2K</span> | Image recognition, File input, Embedding | Text, Image | Vector |
| llama-nemotron-rerank-vl-1b-v2<br><code>llama-nemotron-rerank-vl-1b-v2</code> | meta | <span title="128,000">128K</span> | <span title="4,096">4K</span> | Image recognition, File input, Rerank | Text, Image | Text |
| Codestral Embed<br><code>codestral-embed</code> | mistral | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Mistral Embed<br><code>mistral-embed</code> | mistral | <span title="8,192">8K</span> | <span title="3,072">3K</span> | Embedding | Text | Vector |
| nv-embed-v1<br><code>nv-embed-v1</code> | nvidia | <span title="32,768">32K</span> | <span title="2,048">2K</span> | Embedding | Text | Vector |
| nv-embedcode-7b-v1<br><code>nv-embedcode-7b-v1</code> | nvidia | <span title="32,768">32K</span> | <span title="2,048">2K</span> | Embedding | Text | Vector |
| rerank-qa-mistral-4b<br><code>rerank-qa-mistral-4b</code> | nvidia | <span title="128,000">128K</span> | <span title="4,096">4K</span> | Rerank | Text | Text |
| text-embedding-3-large<br><code>text-embedding-3-large</code> | openai | <span title="8,192">8K</span> | <span title="3,072">3K</span> | Embedding | Text | Vector |
| text-embedding-3-small<br><code>text-embedding-3-small</code> | openai | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| text-embedding-ada-002<br><code>text-embedding-ada-002</code> | openai | <span title="8,192">8K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Embed v1 0.6b<br><code>pplx-embed-v1-0-6b</code> | vercel | <span title="32,000">32K</span> | - | Embedding | Text | Vector |
| Embed v1 4b<br><code>pplx-embed-v1-4b</code> | vercel | <span title="32,000">32K</span> | - | Embedding | Text | Vector |
| Rerank 1<br><code>rerank-1</code> | voyage | <span title="8,000">8K</span> | - | Rerank | Text | - |
| Rerank 2<br><code>rerank-2</code> | voyage | <span title="16,000">16K</span> | - | Rerank | Text | - |
| Rerank 2 Lite<br><code>rerank-2-lite</code> | voyage | <span title="8,000">8K</span> | - | Rerank | Text | - |
| Rerank 2.5<br><code>rerank-2-5</code> | voyage | <span title="32,000">32K</span> | <span title="32,000">32K</span> | Rerank | Text | Text |
| Rerank 2.5 Lite<br><code>rerank-2-5-lite</code> | voyage | <span title="32,000">32K</span> | <span title="32,000">32K</span> | Rerank | Text | Text |
| Rerank Lite 1<br><code>rerank-lite-1</code> | voyage | <span title="4,000">4K</span> | - | Rerank | Text | - |
| Voyage 2<br><code>voyage-2</code> | voyage | <span title="4,000">4K</span> | - | Embedding | Text | Vector |
| Voyage 3<br><code>voyage-3</code> | voyage | <span title="32,000">32K</span> | - | Embedding | Text | Vector |
| Voyage 3 Large<br><code>voyage-3-large</code> | voyage | <span title="32,000">32K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Voyage 3 Lite<br><code>voyage-3-lite</code> | voyage | <span title="32,000">32K</span> | - | Embedding | Text | Vector |
| Voyage 3.5<br><code>voyage-3-5</code> | voyage | <span title="32,000">32K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Voyage 3.5 Lite<br><code>voyage-3-5-lite</code> | voyage | <span title="32,000">32K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Voyage 4<br><code>voyage-4</code> | voyage | <span title="32,000">32K</span> | - | Embedding | Text | Vector |
| Voyage 4 Large<br><code>voyage-4-large</code> | voyage | <span title="32,000">32K</span> | - | Embedding | Text | Vector |
| Voyage 4 Lite<br><code>voyage-4-lite</code> | voyage | <span title="32,000">32K</span> | - | Embedding | Text | Vector |
| Voyage 4 Nano<br><code>voyage-4-nano</code> | voyage | <span title="32,000">32K</span> | - | Embedding | Text | Vector |
| Voyage Code 2<br><code>voyage-code-2</code> | voyage | <span title="16,000">16K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Voyage Code 3<br><code>voyage-code-3</code> | voyage | <span title="32,000">32K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Voyage Finance 2<br><code>voyage-finance-2</code> | voyage | <span title="32,000">32K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Voyage Large 2<br><code>voyage-large-2</code> | voyage | <span title="16,000">16K</span> | - | Embedding | Text | Vector |
| Voyage Large 2 Instruct<br><code>voyage-large-2-instruct</code> | voyage | <span title="16,000">16K</span> | - | Embedding | Text | Vector |
| Voyage Law 2<br><code>voyage-law-2</code> | voyage | <span title="16,000">16K</span> | <span title="1,536">1.5K</span> | Embedding | Text | Vector |
| Voyage Multilingual 2<br><code>voyage-multilingual-2</code> | voyage | <span title="32,000">32K</span> | - | Embedding | Text | Vector |
| Voyage Multimodal 3<br><code>voyage-multimodal-3</code> | voyage | <span title="32,000">32K</span> | - | Embedding | Text, Image | Vector |
| Voyage Multimodal 3.5<br><code>voyage-multimodal-3-5</code> | voyage | <span title="32,000">32K</span> | - | Embedding | Text, Image, Video | Vector |
| BCE Embedding Base v1<br><code>bce-embedding-base-v1</code> | youdao | 512 | - | Embedding | Text | Vector |
| BCE Reranker Base v1<br><code>bce-reranker-base-v1</code> | youdao | 512 | - | Rerank | Text | - |
| Embedding-3<br><code>embedding-3</code> | zhipu | <span title="8,192">8K</span> | - | Embedding | Text | Vector |

</div>
