# 文本对话

数据来自 Cherry Studio 内置模型目录（[provider-registry](https://github.com/CherryHQ/cherry-studio/tree/main/packages/provider-registry)），随应用仓库自动同步；表中 `-` 表示数据源未提供该字段。

上下文长度与最大输出以 K / M 缩写并四舍五入（1K 约为 1,000～1,024 tokens，1M 约为 100 万 tokens），例如 131,072 与 128,000 均写作 128K。悬停可查看完整数值，精确限制请以模型服务商为准。

> **数据更新时间**: 2026-10-27 14:14:54 UTC / 2026-10-27 22:14:54 CST (北京时间)

<div data-models-table="num:2,3;sort:1;search:0,1;cap:4:函数调用,推理,识图,结构化输出,文件输入">

| 模型名称 | 服务商 | 上下文长度 | 最大输出 | 能力 | 输入模态 | 输出模态 |
| --- | --- | --- | --- | --- | --- | --- |
| jamba-1-5-large<br><code>jamba-1-5-large</code> | ai21 | - | - | - | - | - |
| jamba-1-5-mini<br><code>jamba-1-5-mini</code> | ai21 | - | - | - | - | - |
| jamba-large-1-7<br><code>jamba-large-1-7</code> | ai21 | - | - | - | - | - |
| jamba-mini-1-7<br><code>jamba-mini-1-7</code> | ai21 | - | - | - | - | - |
| Qwen 3 Coder 30B A3B Instruct<br><code>qwen3-coder-30b-a3b</code> | alibaba | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen 3.32B<br><code>qwen-3-32b</code> | alibaba | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用、推理 | 文本 | 文本 |
| Qwen 3.6 Max Preview<br><code>qwen-3-6-max-preview</code> | alibaba | <span title="240,000">240K</span> | <span title="64,000">64K</span> | 函数调用、推理、文件输入 | 文本 | 文本 |
| Qwen Deep Research<br><code>qwen-deep-research</code> | alibaba | <span title="1,000,000">1M</span> | <span title="32,768">32K</span> | 函数调用 | 文本 | 文本 |
| Qwen Doc Turbo<br><code>qwen-doc-turbo</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Qwen Flash<br><code>qwen-flash</code> | alibaba | <span title="1,000,000">1M</span> | <span title="32,768">32K</span> | 函数调用、推理 | 文本 | 文本 |
| Qwen Long<br><code>qwen-long</code> | alibaba | <span title="10,000,000">10M</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Qwen Math Plus<br><code>qwen-math-plus</code> | alibaba | <span title="4,096">4K</span> | <span title="3,072">3K</span> | 函数调用 | 文本 | 文本 |
| Qwen Math Turbo<br><code>qwen-math-turbo</code> | alibaba | <span title="4,096">4K</span> | <span title="3,072">3K</span> | 函数调用 | 文本 | 文本 |
| Qwen Max<br><code>qwen-max</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Qwen Plus<br><code>qwen-plus</code> | alibaba | <span title="1,000,000">1M</span> | <span title="32,768">32K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Qwen Plus Character<br><code>qwen-plus-character</code> | alibaba | <span title="32,768">32K</span> | <span title="4,096">4K</span> | 函数调用 | 文本 | 文本 |
| Qwen Plus Character (Japanese)<br><code>qwen-plus-character-ja</code> | alibaba | <span title="8,192">8K</span> | 512 | 函数调用 | 文本 | 文本 |
| Qwen Turbo<br><code>qwen-turbo</code> | alibaba | <span title="1,000,000">1M</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| Qwen-MT Plus<br><code>qwen-mt-plus</code> | alibaba | <span title="16,384">16K</span> | <span title="8,192">8K</span> | - | 文本 | 文本 |
| Qwen-MT Turbo<br><code>qwen-mt-turbo</code> | alibaba | <span title="16,384">16K</span> | <span title="8,192">8K</span> | - | 文本 | 文本 |
| Qwen: Qwen2.5 7B Instruct<br><code>qwen-2-5-7b-instruct</code> | alibaba | <span title="32,768">32K</span> | - | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen: Qwen3 30B A3B Instruct 2507<br><code>qwen3-30b-a3b-instruct</code> | alibaba | <span title="262,144">256K</span> | - | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen: Qwen3 30B A3B Thinking 2507<br><code>qwen3-30b-a3b</code> | alibaba | <span title="131,072">128K</span> | - | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Qwen2.5 14B Instruct<br><code>qwen2-5-14b-instruct</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Qwen2.5 32B Instruct<br><code>qwen2-5-32b-instruct</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Qwen2.5 72B Instruct<br><code>qwen-2-5-72b-instruct</code> | alibaba | <span title="32,768">32K</span> | - | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen2.5 72B Instruct<br><code>qwen2-5-72b-instruct</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Qwen2.5 7B Instruct<br><code>qwen2-5-7b-instruct</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Qwen2.5 Coder 32B Instruct<br><code>qwen-2-5-coder-32b-instruct</code> | alibaba | <span title="32,768">32K</span> | - | - | 文本 | 文本 |
| Qwen2.5-Coder 32B Instruct<br><code>qwen2-5-coder-32b-instruct</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen2.5-Coder 7B Instruct<br><code>qwen2-5-coder-7b-instruct</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Qwen2.5-Math 72B Instruct<br><code>qwen2-5-math-72b-instruct</code> | alibaba | <span title="4,096">4K</span> | <span title="3,072">3K</span> | 函数调用 | 文本 | 文本 |
| Qwen2.5-Math 7B Instruct<br><code>qwen2-5-math-7b-instruct</code> | alibaba | <span title="4,096">4K</span> | <span title="3,072">3K</span> | 函数调用 | 文本 | 文本 |
| Qwen3 14B<br><code>qwen3-14b</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Qwen3 235B A22B Instruct<br><code>qwen3-235b-a22b-instruct-2507-maas</code> | alibaba | <span title="262,144">256K</span> | <span title="16,384">16K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen3 235B A22B Instruct 2507<br><code>qwen-3-235b</code> | alibaba | <span title="262,144">256K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| Qwen3 32B<br><code>qwen3-32b</code> | alibaba | <span title="131,072">128K</span> | <span title="16,384">16K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Qwen3 8B<br><code>qwen3-8b</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Qwen3 Coder 480B A35B Instruct<br><code>qwen3-coder</code> | alibaba | <span title="262,144">256K</span> | <span title="65,536">64K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen3 Coder 480B A35B Instruct<br><code>qwen3-coder-480b-a35b</code> | alibaba | <span title="131,072">128K</span> | <span title="65,536">64K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen3 Coder Flash<br><code>qwen3-coder-flash</code> | alibaba | <span title="1,000,000">1M</span> | <span title="65,536">64K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen3 Coder Next<br><code>qwen3-coder-next</code> | alibaba | <span title="262,144">256K</span> | <span title="256,000">256K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen3 Coder Plus<br><code>qwen3-coder-plus</code> | alibaba | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen3 Max<br><code>qwen3-max</code> | alibaba | <span title="262,144">256K</span> | <span title="65,536">64K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Qwen3 Max Preview<br><code>qwen3-max-preview</code> | alibaba | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 函数调用 | 文本 | 文本 |
| Qwen3-14B<br><code>qwen-3-14b</code> | alibaba | <span title="40,960">40K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| Qwen3-30B-A3B<br><code>qwen-3-30b</code> | alibaba | <span title="40,960">40K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| Qwen3-Coder 30B-A3B Instruct<br><code>qwen3-coder-30b-a3b-instruct</code> | alibaba | <span title="262,144">256K</span> | <span title="65,536">64K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen3-Coder 480B-A35B Instruct<br><code>qwen3-coder-480b-a35b-instruct</code> | alibaba | <span title="262,144">256K</span> | <span title="66,536">66.54K</span> | 函数调用 | 文本 | 文本 |
| Qwen3-Next 80B-A3B (Thinking)<br><code>qwen3-next-80b-a3b</code> | alibaba | <span title="262,144">256K</span> | <span title="262,000">262K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Qwen3-Next 80B-A3B Instruct<br><code>qwen3-next-80b-a3b-instruct</code> | alibaba | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Qwen3.6 Max Preview<br><code>qwen3-6-max-preview</code> | alibaba | <span title="262,144">256K</span> | <span title="65,536">64K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Qwen3.7 Max<br><code>qwen3-7-max</code> | alibaba | <span title="1,000,000">1M</span> | <span title="65,536">64K</span> | 函数调用、推理、结构化输出、文件输入 | 文本 | 文本 |
| QwQ 32B<br><code>qwq-32b</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、推理 | 文本 | 文本 |
| QwQ Plus<br><code>qwq-plus</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、推理 | 文本 | 文本 |
| Tongyi Intent Detect V3<br><code>tongyi-intent-detect-v3</code> | alibaba | <span title="8,192">8K</span> | <span title="1,024">1K</span> | - | 文本 | 文本 |
| Amazon: Nova Micro 1.0<br><code>nova-micro-v1</code> | amazon | <span title="128,000">128K</span> | - | 函数调用 | 文本 | 文本 |
| Nova Micro<br><code>nova-micro</code> | amazon | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Trinity Large Thinking<br><code>trinity-large</code> | arceeai | <span title="262,144">256K</span> | <span title="80,000">80K</span> | 函数调用、推理 | 文本 | 文本 |
| ERNIE 3.5 128K<br><code>ernie-3-5-128k</code> | baidu | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| ERNIE 3.5 8K<br><code>ernie-3-5-8k</code> | baidu | <span title="8,192">8K</span> | - | 函数调用 | - | - |
| ERNIE 4.0 8K<br><code>ernie-4-0-8k</code> | baidu | <span title="8,192">8K</span> | - | 函数调用 | - | - |
| ERNIE 4.0 Turbo 128K<br><code>ernie-4-0-turbo-128k</code> | baidu | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| ERNIE 4.0 Turbo 8K<br><code>ernie-4-0-turbo-8k</code> | baidu | <span title="8,192">8K</span> | - | 函数调用 | - | - |
| ERNIE 4.5<br><code>ernie-4-5</code> | baidu | <span title="123,904">121K</span> | - | 函数调用 | - | - |
| ERNIE 4.5 A3B<br><code>ernie-4-5-a3b</code> | baidu | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| ERNIE 4.5 A47B<br><code>ernie-4-5-a47b</code> | baidu | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| ERNIE 4.5 Turbo<br><code>ernie-4-5-turbo</code> | baidu | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| ERNIE 5.0<br><code>ernie-5-0</code> | baidu | <span title="131,072">128K</span> | - | 推理、函数调用 | - | - |
| ERNIE Character 8K<br><code>ernie-character-8k</code> | baidu | <span title="8,192">8K</span> | - | - | - | - |
| ERNIE Lite 8K<br><code>ernie-lite-8k</code> | baidu | <span title="8,192">8K</span> | - | - | - | - |
| ERNIE Speed 128K<br><code>ernie-speed-128k</code> | baidu | <span title="131,072">128K</span> | - | - | - | - |
| ERNIE Tiny 8K<br><code>ernie-tiny-8k</code> | baidu | <span title="8,192">8K</span> | - | - | - | - |
| ERNIE X1 Turbo<br><code>ernie-x1-turbo</code> | baidu | <span title="32,768">32K</span> | - | 推理、函数调用 | - | - |
| ERNIE X1.1 Preview<br><code>ernie-x1-1-preview</code> | baidu | <span title="32,768">32K</span> | - | 推理、函数调用 | - | - |
| Ling 3.0 Flash<br><code>ling-3-0-flash</code> | bailing | <span title="262,144">256K</span> | <span title="32,000">32K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Ling 3.0 Flash Fin<br><code>ling-3-0-flash-fin</code> | bailing | <span title="262,144">256K</span> | <span title="32,000">32K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Ling 3.0 Flash Sante<br><code>ling-3-0-flash-sante</code> | bailing | <span title="262,144">256K</span> | <span title="32,000">32K</span> | 函数调用、推理 | 文本 | 文本 |
| Ling-1T<br><code>ling-1t</code> | bailing | <span title="128,000">128K</span> | <span title="32,000">32K</span> | 函数调用 | 文本 | 文本 |
| Ring-1T<br><code>ring-1t</code> | bailing | <span title="128,000">128K</span> | <span title="32,000">32K</span> | 推理 | 文本 | 文本 |
| ByteDance-Seed/Seed-OSS-36B-Instruct<br><code>seed-oss-36b-instruct</code> | bytedance | <span title="262,000">262K</span> | <span title="262,000">262K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Doubao 1.5 Lite 32k<br><code>doubao-1-5-lite-32k</code> | bytedance | <span title="32,768">32K</span> | <span title="12,288">12K</span> | 函数调用 | 文本 | 文本 |
| Doubao 1.5 Pro 256k<br><code>doubao-1-5-pro-256k</code> | bytedance | <span title="262,144">256K</span> | - | 函数调用 | 文本 | 文本 |
| Doubao 1.5 Pro 32k<br><code>doubao-1-5-pro-32k</code> | bytedance | <span title="131,072">128K</span> | <span title="16,384">16K</span> | 函数调用 | 文本 | 文本 |
| Doubao 1.5 Thinking Pro<br><code>doubao-1-5-thinking-pro</code> | bytedance | <span title="131,072">128K</span> | <span title="16,384">16K</span> | 推理、函数调用 | 文本 | 文本 |
| Doubao 1.5 Thinking Pro M<br><code>doubao-1-5-thinking-pro-m</code> | bytedance | <span title="131,072">128K</span> | <span title="16,384">16K</span> | 推理、函数调用 | 文本 | 文本 |
| Doubao Seed Translation<br><code>doubao-seed-translation</code> | bytedance | <span title="4,096">4K</span> | <span title="3,072">3K</span> | - | 文本 | 文本 |
| doubao-seed-1-8<br><code>doubao-seed-1-8</code> | bytedance | - | - | - | - | - |
| Aya Expanse 32B<br><code>c4ai-aya-expanse-32b</code> | cohere | <span title="131,072">128K</span> | <span title="4,096">4K</span> | 函数调用 | 文本 | 文本 |
| Aya Expanse 8B<br><code>c4ai-aya-expanse-8b</code> | cohere | <span title="8,192">8K</span> | <span title="4,096">4K</span> | 函数调用 | 文本 | 文本 |
| Command<br><code>command</code> | cohere | <span title="4,096">4K</span> | <span title="4,096">4K</span> | 函数调用 | - | - |
| Command A<br><code>command-a</code> | cohere | <span title="262,144">256K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Command A<br><code>command-a-03-2025</code> | cohere | <span title="262,144">256K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Command A Reasoning<br><code>command-a-reasoning-08-2025</code> | cohere | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 函数调用、推理 | 文本 | 文本 |
| Command A Translate<br><code>command-a-translate-08-2025</code> | cohere | <span title="8,192">8K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Command Light<br><code>command-light</code> | cohere | <span title="4,096">4K</span> | <span title="4,096">4K</span> | 函数调用 | - | - |
| Command R<br><code>command-r</code> | cohere | <span title="131,072">128K</span> | <span title="4,096">4K</span> | 函数调用 | - | - |
| Command R (08-2024)<br><code>command-r-08-2024</code> | cohere | <span title="131,072">128K</span> | <span title="4,096">4K</span> | 函数调用 | 文本 | 文本 |
| Command R+<br><code>command-r-plus</code> | cohere | <span title="131,072">128K</span> | <span title="4,096">4K</span> | 函数调用 | - | - |
| Command R+ (08-2024)<br><code>command-r-plus-08-2024</code> | cohere | <span title="131,072">128K</span> | <span title="4,096">4K</span> | 函数调用 | 文本 | 文本 |
| Command R7B<br><code>command-r7b-12-2024</code> | cohere | <span title="131,072">128K</span> | <span title="4,096">4K</span> | 函数调用 | 文本 | 文本 |
| Command R7B Arabic<br><code>command-r7b-arabic-02-2025</code> | cohere | <span title="128,000">128K</span> | <span title="4,000">4K</span> | 函数调用 | 文本 | 文本 |
| North Mini Code<br><code>north-mini-code</code> | cohere | <span title="131,072">128K</span> | - | 函数调用 | 文本 | 文本 |
| North Mini Code 1.0<br><code>north-mini-code-1-0</code> | cohere | <span title="131,072">128K</span> | <span title="64,000">64K</span> | 函数调用 | 文本 | 文本 |
| Tiny Aya Earth<br><code>tiny-aya-earth</code> | cohere | <span title="8,192">8K</span> | <span title="8,192">8K</span> | 函数调用 | - | - |
| Tiny Aya Fire<br><code>tiny-aya-fire</code> | cohere | <span title="8,192">8K</span> | <span title="8,192">8K</span> | 函数调用 | - | - |
| Tiny Aya Global<br><code>tiny-aya-global</code> | cohere | <span title="8,192">8K</span> | <span title="8,192">8K</span> | 函数调用 | - | - |
| Tiny Aya Water<br><code>tiny-aya-water</code> | cohere | <span title="8,192">8K</span> | <span title="8,192">8K</span> | 函数调用 | - | - |
| DeepSeek R1<br><code>deepseek-r1</code> | deepseek | <span title="163,840">160K</span> | <span title="32,768">32K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| DeepSeek R1 Distill Llama 70B<br><code>deepseek-r1-distill-llama-70b</code> | deepseek | <span title="32,768">32K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| DeepSeek R1 Distill Llama 8B<br><code>deepseek-r1-distill-llama-8b</code> | deepseek | <span title="32,768">32K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| DeepSeek R1 Distill Qwen 1.5B<br><code>deepseek-r1-distill-qwen-1-5b</code> | deepseek | <span title="32,768">32K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| DeepSeek R1 Distill Qwen 14B<br><code>deepseek-r1-distill-qwen-14b</code> | deepseek | <span title="32,768">32K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| DeepSeek R1 Distill Qwen 32B<br><code>deepseek-r1-distill-qwen-32b</code> | deepseek | <span title="32,768">32K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| DeepSeek R1 Distill Qwen 7B<br><code>deepseek-r1-distill-qwen-7b</code> | deepseek | <span title="32,768">32K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| DeepSeek V3<br><code>deepseek-v3</code> | deepseek | <span title="163,840">160K</span> | <span title="163,840">160K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| DeepSeek V3.1<br><code>deepseek-v3-1</code> | deepseek | <span title="163,840">160K</span> | <span title="128,000">128K</span> | 函数调用、推理 | 文本 | 文本 |
| DeepSeek V3.1<br><code>deepseek-v3-1-maas</code> | deepseek | <span title="163,840">160K</span> | <span title="32,768">32K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| DeepSeek V3.2<br><code>deepseek-v3-2-maas</code> | deepseek | <span title="163,840">160K</span> | <span title="65,536">64K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| DeepSeek V3.2 Exp<br><code>deepseek-v3-2-exp</code> | deepseek | <span title="163,840">160K</span> | <span title="65,536">64K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| DeepSeek V4 Flash<br><code>deepseek-v4-flash</code> | deepseek | <span title="1,048,576">1.05M</span> | <span title="393,216">384K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| DeepSeek V4 Pro<br><code>deepseek-v4-pro</code> | deepseek | <span title="1,048,576">1.05M</span> | <span title="393,216">384K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| DeepSeek: DeepSeek V3<br><code>deepseek-chat</code> | deepseek | <span title="163,840">160K</span> | - | 函数调用、结构化输出 | 文本 | 文本 |
| DeepSeek: DeepSeek V3 0324<br><code>deepseek-chat-v3</code> | deepseek | <span title="163,840">160K</span> | - | 函数调用、结构化输出 | 文本 | 文本 |
| DeepSeek: DeepSeek V3.1<br><code>deepseek-chat-v3-1</code> | deepseek | <span title="163,840">160K</span> | - | 函数调用、推理、结构化输出 | 文本 | 文本 |
| siliconflow/deepseek-v3.1-terminus<br><code>deepseek-v3-1-terminus</code> | deepseek | <span title="163,840">160K</span> | <span title="65,536">64K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| siliconflow/deepseek-v3.2<br><code>deepseek-v3-2</code> | deepseek | <span title="163,840">160K</span> | <span title="65,536">64K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Gemma 2 2b It<br><code>gemma-2-2b-it</code> | google | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Google: Gemma 2 27B<br><code>gemma-2-27b-it</code> | google | <span title="8,192">8K</span> | - | 结构化输出 | 文本 | 文本 |
| Mercury 2<br><code>mercury-2</code> | inception | <span title="128,000">128K</span> | <span title="128,000">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Mercury 2.5<br><code>mercury-2-5</code> | inception | <span title="260,000">260K</span> | <span title="65,536">64K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Mercury Coder Small Beta<br><code>mercury-coder-small</code> | inception | <span title="32,000">32K</span> | <span title="16,384">16K</span> | 函数调用 | 文本 | 文本 |
| Mercury Edit 2<br><code>mercury-edit-2</code> | inception | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 推理 | 文本 | 文本 |
| LiquidAI: LFM2.5-2.6B (free)<br><code>lfm-2-5-2-6b</code> | liquidai | <span title="65,536">64K</span> | - | 函数调用、推理、结构化输出 | 文本 | 文本 |
| LongCat-2.0<br><code>longcat-2-0</code> | meituan | <span title="1,048,576">1.05M</span> | <span title="131,072">128K</span> | 函数调用、推理 | 文本 | 文本 |
| Llama 3.1 70b Instruct<br><code>llama-3-1-70b-instruct</code> | meta | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Llama 3.1 70B Instruct<br><code>llama-3-1-70b</code> | meta | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Llama 3.1 70B Instruct (US)<br><code>llama3-1-70b-instruct</code> | meta | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用 | 文本 | 文本 |
| Llama 3.1 8B Instruct<br><code>llama-3-1-8b</code> | meta | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Llama 3.1 8B Instruct<br><code>llama-3-1-8b-instruct</code> | meta | <span title="131,072">128K</span> | <span title="4,096">4K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Llama 3.1 8B Instruct<br><code>llama3-1-8b-instruct</code> | meta | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用 | 文本 | 文本 |
| Llama 3.2 1b Instruct<br><code>llama-3-2-1b-instruct</code> | meta | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Llama 3.2 3B Instruct<br><code>llama-3-2-3b-instruct</code> | meta | <span title="131,072">128K</span> | <span title="32,000">32K</span> | 结构化输出 | 文本 | 文本 |
| Llama 3.3 70b Instruct<br><code>llama-3-3-70b-instruct</code> | meta | <span title="131,072">128K</span> | <span title="4,096">4K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Llama 3.3 70B Instruct<br><code>llama-3-3-70b-instruct-maas</code> | meta | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Llama 3.3 70B Instruct<br><code>llama3-3-70b-instruct</code> | meta | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用 | 文本 | 文本 |
| Llama 3.3 Nemotron Super 49B v1<br><code>llama-3-3-nemotron-super-49b-v1</code> | meta | <span title="131,072">128K</span> | <span title="65,536">64K</span> | 函数调用、推理 | 文本 | 文本 |
| Llama 3.3 Nemotron Super 49B v1.5<br><code>llama-3-3-nemotron-super-49b-v1-5</code> | meta | <span title="131,072">128K</span> | <span title="65,536">64K</span> | 函数调用、推理 | 文本 | 文本 |
| Llama-3.3-70B-Instruct<br><code>llama-3-3-70b</code> | meta | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、文件输入 | 文本 | 文本 |
| Microsoft: Phi 4<br><code>phi-4</code> | microsoft | <span title="16,384">16K</span> | - | 结构化输出 | 文本 | 文本 |
| Phi 4 Multimodal<br><code>phi-4-multimodal-instruct</code> | microsoft | <span title="128,000">128K</span> | <span title="16,384">16K</span> | - | 文本 | 文本 |
| Phi-4-Mini<br><code>phi-4-mini-instruct</code> | microsoft | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| MiniMax M2.1 Lightning<br><code>minimax-m2-1-lightning</code> | minimax | <span title="204,800">200K</span> | <span title="131,072">128K</span> | 函数调用、推理 | 文本 | 文本 |
| MiniMax-M2<br><code>minimax-m2</code> | minimax | <span title="205,000">205K</span> | <span title="205,000">205K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| MiniMax-M2.1<br><code>minimax-m2-1</code> | minimax | <span title="204,800">200K</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| MiniMax-M2.5<br><code>minimax-m2-5</code> | minimax | <span title="204,800">200K</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| MiniMax-M2.5-highspeed<br><code>minimax-m2-5-highspeed</code> | minimax | <span title="204,800">200K</span> | <span title="131,072">128K</span> | 函数调用、推理 | 文本 | 文本 |
| MiniMax-M2.7<br><code>minimax-m2-7</code> | minimax | <span title="204,800">200K</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出、文件输入 | 文本 | 文本 |
| MiniMax-M2.7-highspeed<br><code>minimax-m2-7-highspeed</code> | minimax | <span title="204,800">200K</span> | <span title="131,100">131.1K</span> | 函数调用、推理、文件输入 | 文本 | 文本 |
| MiniMax: MiniMax M1<br><code>minimax-m1</code> | minimax | <span title="1,000,000">1M</span> | - | 函数调用、推理 | 文本 | 文本 |
| MiniMax: MiniMax M2-her<br><code>minimax-m2-her</code> | minimax | <span title="65,536">64K</span> | - | - | 文本 | 文本 |
| Codestral (latest)<br><code>codestral</code> | mistral | <span title="256,000">256K</span> | <span title="4,096">4K</span> | 函数调用、结构化输出、文件输入 | 文本 | 文本 |
| Codestral (latest)<br><code>codestral-latest</code> | mistral | <span title="256,000">256K</span> | <span title="4,096">4K</span> | 函数调用 | 文本 | 文本 |
| Devstral 2<br><code>devstral</code> | mistral | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、结构化输出、文件输入 | 文本 | 文本 |
| Devstral 2<br><code>devstral-2</code> | mistral | <span title="256,000">256K</span> | <span title="256,000">256K</span> | 函数调用 | 文本 | 文本 |
| Devstral 2<br><code>devstral-latest</code> | mistral | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用 | 文本 | 文本 |
| Devstral 2 (latest)<br><code>devstral-medium-latest</code> | mistral | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用 | 文本 | 文本 |
| Devstral 2 123B<br><code>devstral-2-123b</code> | mistral | <span title="256,000">256K</span> | <span title="8,192">8K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Devstral Medium<br><code>devstral-medium</code> | mistral | <span title="128,000">128K</span> | <span title="128,000">128K</span> | 函数调用 | 文本 | 文本 |
| Magistral Medium (latest)<br><code>magistral-medium-latest</code> | mistral | <span title="128,000">128K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| Ministral 14B 3.0<br><code>ministral-3-14b-instruct</code> | mistral | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Ministral 3 8B<br><code>ministral-3-8b-instruct</code> | mistral | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| Ministral 3B (latest)<br><code>ministral-3b-latest</code> | mistral | <span title="128,000">128K</span> | <span title="128,000">128K</span> | 函数调用 | 文本 | 文本 |
| Ministral 8B (latest)<br><code>ministral-8b-latest</code> | mistral | <span title="128,000">128K</span> | <span title="128,000">128K</span> | 函数调用 | 文本 | 文本 |
| Mistral 7B<br><code>open-mistral-7b</code> | mistral | <span title="8,000">8K</span> | <span title="8,000">8K</span> | 函数调用 | 文本 | 文本 |
| Mistral-7B-Instruct-v0.3<br><code>mistral-7b-instruct-v0-3</code> | mistral | <span title="65,536">64K</span> | <span title="65,536">64K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| mistral-nemotron<br><code>mistral-nemotron</code> | mistral | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Mistral: Mistral Small 3<br><code>mistral-small-24b-instruct</code> | mistral | <span title="32,768">32K</span> | - | 结构化输出 | 文本 | 文本 |
| Mistral: Saba<br><code>mistral-saba</code> | mistral | <span title="32,768">32K</span> | - | 函数调用、结构化输出、文件输入 | 文本 | 文本 |
| Mixtral 8x22B<br><code>open-mixtral-8x22b</code> | mistral | <span title="64,000">64K</span> | <span title="64,000">64K</span> | 函数调用 | 文本 | 文本 |
| Mixtral 8x7B<br><code>open-mixtral-8x7b</code> | mistral | <span title="32,000">32K</span> | <span title="32,000">32K</span> | 函数调用 | 文本 | 文本 |
| Kimi K2 0905<br><code>kimi-k2-instruct</code> | moonshot | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用 | 文本 | 文本 |
| Kimi K2 Thinking<br><code>kimi-k2-thinking-maas</code> | moonshot | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Moonshot Kimi K2 Thinking<br><code>kimi-k2</code> | moonshot | <span title="262,144">256K</span> | <span title="216,144">216.14K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Nous: Hermes 3 405B Instruct<br><code>hermes-3-llama-3-1-405b</code> | nousresearch | <span title="131,072">128K</span> | - | 结构化输出 | 文本 | 文本 |
| Nous: Hermes 4 405B<br><code>hermes-4-405b</code> | nousresearch | <span title="131,072">128K</span> | - | 推理、结构化输出 | 文本 | 文本 |
| esm2-650m<br><code>esm2-650m</code> | nvidia | <span title="128,000">128K</span> | <span title="8,192">8K</span> | - | 文本 | 文本 |
| esmfold<br><code>esmfold</code> | nvidia | <span title="128,000">128K</span> | <span title="8,192">8K</span> | - | 文本 | 文本 |
| gliner-pii<br><code>gliner-pii</code> | nvidia | <span title="128,000">128K</span> | <span title="4,096">4K</span> | - | 文本 | 文本 |
| Laguna XS 2.1<br><code>laguna-xs-2-1</code> | nvidia | <span title="262,144">256K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| Llama 3.1 Nemotron 70B Instruct<br><code>llama-3-1-nemotron-70b-instruct</code> | nvidia | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Llama 3.1 Nemotron Nano 8B v1<br><code>llama-3-1-nemotron-nano-8b-v1</code> | nvidia | <span title="131,072">128K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| Llama 3.1 Nemotron Ultra 253B<br><code>llama-3-1-nemotron-ultra-253b-v1</code> | nvidia | <span title="128,000">128K</span> | <span title="16,384">16K</span> | 函数调用、推理 | 文本 | 文本 |
| llama-3.1-nemotron-safety-guard-8b-v3<br><code>llama-3-1-nemotron-safety-guard-8b-v3</code> | nvidia | <span title="128,000">128K</span> | <span title="4,096">4K</span> | - | 文本 | 文本 |
| Mistral: Mixtral 8x22B Instruct<br><code>mixtral-8x22b-instruct</code> | nvidia | <span title="65,536">64K</span> | <span title="13,108">12.8K</span> | 函数调用、结构化输出、文件输入 | 文本 | 文本 |
| Mistral: Mixtral 8x7B Instruct<br><code>mixtral-8x7b-instruct</code> | nvidia | <span title="32,768">32K</span> | <span title="16,384">16K</span> | 函数调用 | 文本 | 文本 |
| Nemotron 3 Super<br><code>nemotron-3-super-120b-a12b</code> | nvidia | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Nemotron 3 Ultra 550B A55B<br><code>nemotron-3-ultra-550b-a55b</code> | nvidia | <span title="1,000,000">1M</span> | <span title="65,536">64K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Nemotron 3.5 Lightning 30B<br><code>nemotron-3-5-lightning</code> | nvidia | <span title="1,000,000">1M</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Nemotron 3.5 Lightning 30B A3B<br><code>nemotron-3-5-lightning-30b-a3b</code> | nvidia | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| nemotron-3-content-safety<br><code>nemotron-3-content-safety</code> | nvidia | <span title="128,000">128K</span> | <span title="4,096">4K</span> | - | 文本 | 文本 |
| nemotron-3-nano-30b-a3b<br><code>nemotron-3-nano-30b-a3b</code> | nvidia | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| nemotron-content-safety-reasoning-4b<br><code>nemotron-content-safety-reasoning-4b</code> | nvidia | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 推理 | 文本 | 文本 |
| nemotron-mini-4b-instruct<br><code>nemotron-mini-4b-instruct</code> | nvidia | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| NVIDIA Nemotron 3 Super 120B A12B<br><code>nemotron-super-3-120b</code> | nvidia | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| NVIDIA Nemotron Nano 3 30B<br><code>nemotron-nano-3-30b</code> | nvidia | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| nvidia-nemotron-nano-9b-v2<br><code>nemotron-nano-9b-v2</code> | nvidia | <span title="131,072">128K</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| riva-translate-4b-instruct-v1_1<br><code>riva-translate-4b-instruct-v1-1</code> | nvidia | <span title="128,000">128K</span> | <span title="4,096">4K</span> | - | 文本 | 文本 |
| sarvam-m<br><code>sarvam-m</code> | nvidia | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| studiovoice<br><code>studiovoice</code> | nvidia | <span title="128,000">128K</span> | <span title="8,192">8K</span> | - | 文本 | 文本 |
| usdcode<br><code>usdcode</code> | nvidia | <span title="128,000">128K</span> | <span title="4,096">4K</span> | - | 文本 | 文本 |
| usdvalidate<br><code>usdvalidate</code> | nvidia | - | <span title="4,096">4K</span> | - | 文本 | 文本 |
| GPT OSS 120B<br><code>gpt-oss-120b-maas</code> | openai | <span title="131,072">128K</span> | <span title="32,768">32K</span> | 函数调用、推理 | 文本 | 文本 |
| GPT OSS 20B<br><code>gpt-oss-20b</code> | openai | <span title="131,072">128K</span> | <span title="32,768">32K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GPT OSS 20B<br><code>gpt-oss-20b-maas</code> | openai | <span title="131,072">128K</span> | <span title="32,768">32K</span> | 函数调用、推理 | 文本 | 文本 |
| GPT OSS Safeguard 120B<br><code>gpt-oss-safeguard-120b</code> | openai | <span title="128,000">128K</span> | <span title="16,384">16K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GPT-3.5 Turbo<br><code>gpt-3-5-turbo</code> | openai | <span title="16,385">16K</span> | <span title="4,096">4K</span> | 函数调用、结构化输出 | 文本 | 文本 |
| GPT-4<br><code>gpt-4</code> | openai | <span title="8,192">8K</span> | <span title="8,192">8K</span> | 函数调用、结构化输出、文件输入 | 文本 | 文本 |
| GPT-5 Chat<br><code>gpt-5-chat</code> | openai | - | - | 函数调用、推理、识图、结构化输出、文件输入 | - | 文本 |
| GPT-OSS-120B<br><code>gpt-oss-120b</code> | openai | <span title="131,072">128K</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| gpt-oss-safeguard-20b<br><code>gpt-oss-safeguard-20b</code> | openai | <span title="131,072">128K</span> | <span title="16,384">16K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| o3-mini<br><code>o3-mini</code> | openai | <span title="200,000">200K</span> | <span title="100,000">100K</span> | 函数调用、推理、结构化输出、文件输入 | 文本 | 文本 |
| OpenAI: GPT-3.5 Turbo 16k<br><code>gpt-3-5-turbo-16k</code> | openai | <span title="16,385">16K</span> | - | 函数调用、结构化输出 | 文本 | 文本 |
| OpenAI: GPT-3.5 Turbo Instruct<br><code>gpt-3-5-turbo-instruct</code> | openai | <span title="4,095">4K</span> | - | 结构化输出 | 文本 | 文本 |
| OpenAI: GPT-4 Turbo Preview<br><code>gpt-4-turbo-preview</code> | openai | <span title="128,000">128K</span> | - | 函数调用、结构化输出 | 文本 | 文本 |
| Perplexity Sonar Deep Research<br><code>sonar-deep-research</code> | perplexity | <span title="128,000">128K</span> | <span title="32,768">32K</span> | 推理 | 文本 | 文本 |
| Reka Flash 3<br><code>reka-flash-3</code> | reka | <span title="65,536">64K</span> | - | 推理、结构化输出 | 文本 | 文本 |
| Step 1 (32K)<br><code>step-1-32k</code> | stepfun | <span title="32,768">32K</span> | <span title="32,768">32K</span> | 函数调用 | 文本 | 文本 |
| Step 2 (16K)<br><code>step-2-16k</code> | stepfun | <span title="16,384">16K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| Kat Coder Pro V2<br><code>kat-coder-pro-v2</code> | streamlake | <span title="262,144">256K</span> | <span title="256,000">256K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| KAT-Coder-Pro V1<br><code>kat-coder-pro-v1</code> | streamlake | <span title="256,000">256K</span> | <span title="32,000">32K</span> | 推理 | 文本 | 文本 |
| Hunyuan 2.0 Instruct<br><code>hunyuan-2-0-instruct</code> | tencent | <span title="147,456">144K</span> | <span title="16,384">16K</span> | 函数调用 | - | - |
| Hunyuan 2.0 Thinking<br><code>hunyuan-2-0</code> | tencent | <span title="196,608">192K</span> | <span title="65,536">64K</span> | 推理、函数调用 | - | - |
| Hunyuan 3<br><code>hy3</code> | tencent | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 推理、函数调用 | 文本 | 文本 |
| Hunyuan 3 Preview<br><code>hy3-preview</code> | tencent | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 推理、函数调用 | 文本 | 文本 |
| Hunyuan 4 Preview<br><code>hy4-preview</code> | tencent | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 推理、函数调用、结构化输出 | 文本 | 文本 |
| Hunyuan A13B Instruct<br><code>hunyuan-a13b-instruct</code> | tencent | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 推理、函数调用 | 文本 | 文本 |
| Hunyuan MT2 Lite<br><code>hy-mt2-lite</code> | tencent | <span title="8,192">8K</span> | <span title="4,096">4K</span> | - | 文本 | 文本 |
| Hunyuan MT2 Plus<br><code>hy-mt2-plus</code> | tencent | <span title="8,192">8K</span> | <span title="4,096">4K</span> | - | 文本 | 文本 |
| Hunyuan MT2 Pro<br><code>hy-mt2-pro</code> | tencent | <span title="8,192">8K</span> | <span title="4,096">4K</span> | - | 文本 | 文本 |
| Hunyuan Role<br><code>hy-role</code> | tencent | <span title="32,768">32K</span> | <span title="4,096">4K</span> | - | - | - |
| Hunyuan T1<br><code>hunyuan-t1</code> | tencent | - | - | 推理、函数调用 | - | - |
| Hunyuan TurboS<br><code>hunyuan-turbos</code> | tencent | - | - | 函数调用 | - | - |
| Tencent Code<br><code>tc-code</code> | tencent | - | - | 函数调用 | - | - |
| Tencent: Hy-MT2-1.8B<br><code>hy-mt2-1-8b</code> | tencent | <span title="8,192">8K</span> | - | - | 文本 | 文本 |
| Tencent: Hy-MT2-30B-A3B<br><code>hy-mt2-30b-a3b</code> | tencent | <span title="8,192">8K</span> | - | 结构化输出 | 文本 | 文本 |
| Tencent: Hy-MT2-7B<br><code>hy-mt2-7b</code> | tencent | <span title="8,192">8K</span> | - | 结构化输出 | 文本 | 文本 |
| Solar Pro 4<br><code>solar-pro4</code> | upstage | <span title="524,288">512K</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| solar-10.7b-instruct<br><code>solar-10-7b-instruct</code> | upstage | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用 | 文本 | 文本 |
| solar-mini<br><code>solar-mini</code> | upstage | <span title="32,768">32K</span> | <span title="4,096">4K</span> | 函数调用 | 文本 | 文本 |
| solar-pro2<br><code>solar-pro2</code> | upstage | <span title="65,536">64K</span> | <span title="8,192">8K</span> | 函数调用、推理 | 文本 | 文本 |
| solar-pro3<br><code>solar-pro3</code> | upstage | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、推理 | 文本 | 文本 |
| Upstage: Solar Pro 3<br><code>solar-pro-3</code> | upstage | <span title="131,072">128K</span> | - | 函数调用、推理、结构化输出 | 文本 | 文本 |
| Laguna S 2.1 Free<br><code>laguna-s-2-1</code> | vercel | <span title="1,048,576">1.05M</span> | <span title="131,072">128K</span> | 函数调用、推理 | 文本 | 文本 |
| Morph v3 Fast<br><code>morph-v3-fast</code> | vercel | <span title="81,920">80K</span> | <span title="16,000">16K</span> | - | 文本 | 文本 |
| Morph v3 Large<br><code>morph-v3-large</code> | vercel | <span title="262,144">256K</span> | <span title="32,000">32K</span> | 结构化输出 | 文本 | 文本 |
| Palmyra X4 (US)<br><code>palmyra-x4</code> | writer | <span title="122,880">120K</span> | <span title="8,192">8K</span> | 函数调用、推理 | 文本 | 文本 |
| Palmyra X5 (US)<br><code>palmyra-x5</code> | writer | <span title="1,040,000">1.04M</span> | <span title="8,192">8K</span> | 函数调用、推理 | 文本 | 文本 |
| Grok 2<br><code>grok-2</code> | xai | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| Grok 3<br><code>grok-3</code> | xai | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| Grok 3 Fast<br><code>grok-3-fast</code> | xai | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| Grok 3 Mini<br><code>grok-3-mini</code> | xai | <span title="131,072">128K</span> | - | 推理、函数调用 | - | - |
| Grok 3 Mini Fast<br><code>grok-3-mini-fast</code> | xai | <span title="131,072">128K</span> | - | 推理、函数调用 | - | - |
| Grok 4<br><code>grok-4</code> | xai | <span title="256,000">256K</span> | - | 推理、函数调用、识图 | - | - |
| Grok 4 Fast<br><code>grok-4-fast</code> | xai | <span title="2,000,000">2M</span> | - | 推理、函数调用 | - | - |
| Grok 4.1<br><code>grok-4-1</code> | xai | <span title="256,000">256K</span> | - | 推理、函数调用 | - | - |
| Grok Beta<br><code>grok-beta</code> | xai | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| Grok Code Fast 1<br><code>grok-code-fast-1</code> | xai | <span title="256,000">256K</span> | - | 函数调用 | - | - |
| MiMo-V2-Flash<br><code>mimo-v2-flash</code> | xiaomi | <span title="262,144">256K</span> | <span title="65,536">64K</span> | 函数调用、推理 | 文本 | 文本 |
| MiMo-V2-Pro<br><code>mimo-v2-pro</code> | xiaomi | <span title="1,048,576">1.05M</span> | <span title="131,072">128K</span> | 函数调用、推理 | 文本 | 文本 |
| MiMo-V2.5-Pro<br><code>mimo-v2-5-pro</code> | xiaomi | <span title="1,050,000">1.05M</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出、文件输入 | 文本 | 文本 |
| MiMo-V2.5-Pro-UltraSpeed<br><code>mimo-v2-5-pro-ultraspeed</code> | xiaomi | <span title="1,048,576">1.05M</span> | <span title="131,072">128K</span> | 函数调用、推理 | 文本 | 文本 |
| GLM 4.5<br><code>glm-4-5</code> | zhipu | <span title="131,072">128K</span> | <span title="98,304">96K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GLM 4.5 Air<br><code>glm-4-5-air</code> | zhipu | <span title="131,072">128K</span> | <span title="98,304">96K</span> | 函数调用、推理 | 文本 | 文本 |
| GLM 4.6<br><code>glm-4-6</code> | zhipu | <span title="204,800">200K</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GLM 4.7<br><code>glm-4-7</code> | zhipu | <span title="204,800">200K</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GLM 4.7 Flash<br><code>glm-4-7-flash</code> | zhipu | <span title="202,752">198K</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GLM 4.7 FlashX<br><code>glm-4-7-flashx</code> | zhipu | <span title="200,000">200K</span> | <span title="131,072">128K</span> | 函数调用、推理 | 文本 | 文本 |
| GLM 5 Turbo<br><code>glm-5-turbo</code> | zhipu | <span title="202,800">202.8K</span> | <span title="131,100">131.1K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GLM 5.2 Fast<br><code>glm-5-2-fast</code> | zhipu | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GLM 5.3<br><code>glm-5-3</code> | zhipu | <span title="1,310,720">1.31M</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GLM 5.3 Fast<br><code>glm-5-3-fast</code> | zhipu | <span title="1,048,576">1.05M</span> | <span title="262,144">256K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GLM-3-Turbo<br><code>glm-3-turbo</code> | zhipu | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| GLM-4<br><code>glm-4</code> | zhipu | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| GLM-4-Air<br><code>glm-4-air</code> | zhipu | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| GLM-4-AirX<br><code>glm-4-airx</code> | zhipu | <span title="8,192">8K</span> | - | 函数调用 | - | - |
| GLM-4-Flash<br><code>glm-4-flash</code> | zhipu | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| GLM-4-FlashX<br><code>glm-4-flashx</code> | zhipu | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| GLM-4-Long<br><code>glm-4-long</code> | zhipu | <span title="1,024,000">1.02M</span> | - | 函数调用 | - | - |
| GLM-4-Plus<br><code>glm-4-plus</code> | zhipu | <span title="131,072">128K</span> | - | 函数调用 | - | - |
| GLM-4.5-Flash<br><code>glm-4-5-flash</code> | zhipu | <span title="131,072">128K</span> | <span title="98,304">96K</span> | 函数调用、推理 | 文本 | 文本 |
| GLM-4.7<br><code>glm-4-7-maas</code> | zhipu | <span title="200,000">200K</span> | <span title="128,000">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GLM-5<br><code>glm-5</code> | zhipu | <span title="204,800">200K</span> | <span title="131,100">131.1K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GLM-5<br><code>glm-5-maas</code> | zhipu | <span title="202,752">198K</span> | <span title="131,072">128K</span> | 函数调用、推理 | 文本 | 文本 |
| GLM-5.1<br><code>glm-5-1</code> | zhipu | <span title="204,800">200K</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出、文件输入 | 文本 | 文本 |
| GLM-5.2<br><code>glm-5-2</code> | zhipu | <span title="1,048,576">1.05M</span> | <span title="131,072">128K</span> | 函数调用、推理、结构化输出 | 文本 | 文本 |
| GLM-Z1<br><code>glm-z1</code> | zhipu | <span title="131,072">128K</span> | - | 推理 | - | - |
| GLM-Z1-Air<br><code>glm-z1-air</code> | zhipu | <span title="131,072">128K</span> | - | 推理 | - | - |
| GLM-Z1-AirX<br><code>glm-z1-airx</code> | zhipu | <span title="131,072">128K</span> | - | 推理 | - | - |
| GLM-Z1-Flash<br><code>glm-z1-flash</code> | zhipu | <span title="131,072">128K</span> | - | 推理 | - | - |
| Z.ai: GLM Latest<br><code>glm-latest</code> | zhipu | <span title="1,310,720">1.31M</span> | - | 函数调用、推理、结构化输出 | 文本 | 文本 |

</div>
