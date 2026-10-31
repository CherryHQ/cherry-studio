# 多模态对话

数据来自 Cherry Studio 内置模型目录（[provider-registry](https://github.com/CherryHQ/cherry-studio/tree/main/packages/provider-registry)），随应用仓库自动同步；表中 `-` 表示数据源未提供该字段。

上下文长度与最大输出以 K / M 缩写并四舍五入（1K 约为 1,000～1,024 tokens，1M 约为 100 万 tokens），例如 131,072 与 128,000 均写作 128K。悬停可查看完整数值，精确限制请以模型服务商为准。

> **数据更新时间**: 2026-10-27 14:14:54 UTC / 2026-10-27 22:14:54 CST (北京时间)

<div data-models-table="num:2,3;sort:1;search:0,1;cap:4:函数调用,推理,识图,语音识别,视频理解,结构化输出,文件输入,电脑操作,文件检索;in:5:文本输入=文本,图片输入=图片,音频输入=音频,视频输入=视频">

| 模型名称 | 服务商 | 上下文长度 | 最大输出 | 能力 | 输入模态 | 输出模态 |
| --- | --- | --- | --- | --- | --- | --- |
| QVQ Max<br><code>qvq-max</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、推理、识图 | 文本、图片 | 文本 |
| Qwen 3.8 Flash Next<br><code>qwen3-8-flash-next</code> | alibaba | <span title="1,048,576">1.05M</span> | <span title="1,048,576">1.05M</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Qwen-VL Max<br><code>qwen-vl-max</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、识图 | 文本、图片 | 文本 |
| Qwen-VL OCR<br><code>qwen-vl-ocr</code> | alibaba | <span title="34,096">34.1K</span> | <span title="4,096">4K</span> | 识图 | 文本、图片 | 文本 |
| Qwen-VL Plus<br><code>qwen-vl-plus</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、识图 | 文本、图片 | 文本 |
| Qwen: Qwen3 VL 30B A3B Instruct<br><code>qwen3-vl-30b-a3b-instruct</code> | alibaba | <span title="262,144">256K</span> | - | 函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| Qwen: Qwen3 VL 32B Instruct<br><code>qwen3-vl-32b-instruct</code> | alibaba | <span title="131,072">128K</span> | - | 函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| Qwen: Qwen3 VL 8B Instruct<br><code>qwen3-vl-8b-instruct</code> | alibaba | <span title="262,144">256K</span> | - | 函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| Qwen: Qwen3 VL 8B Thinking<br><code>qwen3-vl-8b</code> | alibaba | <span title="131,072">128K</span> | - | 函数调用、推理、识图、结构化输出 | 文本、图片 | 文本 |
| Qwen: Qwen3.5 Plus 2026-02-15<br><code>qwen3-5-plus-02-15</code> | alibaba | <span title="1,000,000">1M</span> | - | 函数调用、推理、识图、视频理解、结构化输出 | 文本、图片、视频 | 文本 |
| Qwen: Qwen3.5-9B<br><code>qwen3-5-9b</code> | alibaba | <span title="262,144">256K</span> | - | 函数调用、推理、识图、视频理解、结构化输出 | 文本、图片、视频 | 文本 |
| Qwen: Qwen3.5-Flash<br><code>qwen3-5-flash-02-23</code> | alibaba | <span title="1,000,000">1M</span> | - | 函数调用、推理、识图、视频理解、结构化输出 | 文本、图片、视频 | 文本 |
| Qwen2.5-VL 72B Instruct<br><code>qwen2-5-vl-72b-instruct</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| Qwen2.5-VL 7B Instruct<br><code>qwen2-5-vl-7b-instruct</code> | alibaba | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、识图 | 文本、图片 | 文本 |
| Qwen3 235B-A22B<br><code>qwen3-235b-a22b</code> | alibaba | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Qwen3 VL 235B A22B Instruct<br><code>qwen3-vl-235b-a22b-instruct</code> | alibaba | <span title="262,144">256K</span> | <span title="129,024">126K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Qwen3 VL Instruct<br><code>qwen3-vl-instruct</code> | alibaba | <span title="131,072">128K</span> | <span title="129,024">126K</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Qwen3 VL Thinking<br><code>qwen3-vl</code> | alibaba | <span title="131,072">128K</span> | <span title="32,768">32K</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Qwen3-VL 235B-A22B<br><code>qwen3-vl-235b-a22b</code> | alibaba | <span title="262,000">262K</span> | <span title="262,000">262K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Qwen3-VL 30B-A3B<br><code>qwen3-vl-30b-a3b</code> | alibaba | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 函数调用、推理、识图、结构化输出 | 文本、图片 | 文本 |
| Qwen3-VL Plus<br><code>qwen3-vl-plus</code> | alibaba | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 函数调用、推理、识图 | 文本、图片 | 文本 |
| Qwen3.5 122B-A10B<br><code>qwen3-5-122b-a10b</code> | alibaba | <span title="262,144">256K</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Qwen3.5 27B<br><code>qwen3-5-27b</code> | alibaba | <span title="262,144">256K</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Qwen3.5 35B-A3B<br><code>qwen3-5-35b-a3b</code> | alibaba | <span title="262,144">256K</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Qwen3.5 397B-A17B<br><code>qwen3-5-397b-a17b</code> | alibaba | <span title="262,144">256K</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Qwen3.5 4B<br><code>qwen3-5-4b</code> | alibaba | <span title="262,144">256K</span> | - | 函数调用、推理、识图、视频理解、结构化输出 | 文本、图片、视频 | 文本 |
| Qwen3.5 Flash<br><code>qwen3-5-flash</code> | alibaba | <span title="1,000,000">1M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Qwen3.5 Plus<br><code>qwen3-5-plus</code> | alibaba | <span title="1,000,000">1M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Qwen3.6 27B<br><code>qwen3-6-27b</code> | alibaba | <span title="262,144">256K</span> | <span title="256,000">256K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Qwen3.6 35B-A3B<br><code>qwen3-6-35b-a3b</code> | alibaba | <span title="262,144">256K</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Qwen3.6 Flash<br><code>qwen3-6-flash</code> | alibaba | <span title="1,000,000">1M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Qwen3.6 Plus<br><code>qwen3-6-plus</code> | alibaba | <span title="1,000,000">1M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Qwen3.7 Flash<br><code>qwen3-7-flash</code> | alibaba | <span title="1,000,000">1M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Qwen3.7 Plus<br><code>qwen3-7-plus</code> | alibaba | <span title="1,000,000">1M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Qwen3.8 2.4T A95B<br><code>qwen3-8-2-4t-a95b</code> | alibaba | <span title="1,048,576">1.05M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出 | 文本、图片 | 文本 |
| Qwen3.8 27B<br><code>qwen3-8-27b</code> | alibaba | <span title="1,000,000">1M</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Qwen3.8 Flash<br><code>qwen3-8-flash</code> | alibaba | <span title="1,000,000">1M</span> | <span title="131,072">128K</span> | 推理、函数调用、识图、视频理解、结构化输出 | 文本、图片、视频 | 文本 |
| Qwen3.8 Max<br><code>qwen3-8-max</code> | alibaba | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 推理、函数调用 | 文本、图片、视频 | 文本 |
| Qwen3.8 Max Preview<br><code>qwen3-8-max-preview</code> | alibaba | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 推理、函数调用 | 文本、图片、视频 | 文本 |
| Amazon: Nova 2 Lite<br><code>nova-2-lite-v1</code> | amazon | <span title="1,000,000">1M</span> | - | 函数调用、推理、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Amazon: Nova Lite 1.0<br><code>nova-lite-v1</code> | amazon | <span title="300,000">300K</span> | - | 函数调用、识图 | 文本、图片 | 文本 |
| Amazon: Nova Premier 1.0<br><code>nova-premier-v1</code> | amazon | <span title="1,000,000">1M</span> | - | 函数调用、识图 | 文本、图片 | 文本 |
| Amazon: Nova Pro 1.0<br><code>nova-pro-v1</code> | amazon | <span title="300,000">300K</span> | - | 函数调用、识图 | 文本、图片 | 文本 |
| Nova 2 Lite<br><code>nova-2-lite</code> | amazon | <span title="1,000,000">1M</span> | <span title="1,000,000">1M</span> | 函数调用、推理、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Nova Lite<br><code>nova-lite</code> | amazon | <span title="300,000">300K</span> | <span title="8,192">8K</span> | 函数调用、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Nova Pro<br><code>nova-pro</code> | amazon | <span title="300,000">300K</span> | <span title="8,192">8K</span> | 函数调用、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Anthropic Claude Haiku Latest<br><code>claude-haiku-latest</code> | anthropic | <span title="200,000">200K</span> | - | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Anthropic Claude Sonnet Latest<br><code>claude-sonnet-latest</code> | anthropic | <span title="1,000,000">1M</span> | - | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Anthropic: Claude Fable Latest<br><code>claude-fable-latest</code> | anthropic | <span title="1,000,000">1M</span> | - | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Anthropic: Claude Opus Latest<br><code>claude-opus-latest</code> | anthropic | <span title="1,000,000">1M</span> | - | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Fable 5<br><code>claude-fable-5</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Fable 5.1<br><code>claude-fable-5-1</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Haiku 3<br><code>claude-3-haiku</code> | anthropic | <span title="200,000">200K</span> | <span title="4,096">4K</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Claude Haiku 4.5<br><code>claude-haiku-4-5</code> | anthropic | <span title="200,000">200K</span> | <span title="64,000">64K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Haiku 5.5<br><code>claude-haiku-5-5</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 推理、函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Opus 4<br><code>claude-opus-4</code> | anthropic | <span title="200,000">200K</span> | <span title="32,000">32K</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Claude Opus 4.1<br><code>claude-opus-4-1</code> | anthropic | <span title="200,000">200K</span> | <span title="32,000">32K</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Claude Opus 4.5<br><code>claude-opus-4-5</code> | anthropic | <span title="200,000">200K</span> | <span title="64,000">64K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Opus 4.6<br><code>claude-opus-4-6</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Opus 4.6 (US)<br><code>claude-opus-4-6-v1</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Opus 4.7<br><code>claude-opus-4-7</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Opus 4.8<br><code>claude-opus-4-8</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Opus 4.8 (Fast)<br><code>claude-opus-4-8-fast</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Claude Opus 5<br><code>claude-opus-5</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Opus 5 (Fast)<br><code>claude-opus-5-fast</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Claude Opus 5.5<br><code>claude-opus-5-5</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 推理、函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Sonnet 4<br><code>claude-sonnet-4</code> | anthropic | <span title="1,000,000">1M</span> | <span title="64,000">64K</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Claude Sonnet 4.5<br><code>claude-sonnet-4-5</code> | anthropic | <span title="1,000,000">1M</span> | <span title="64,000">64K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Sonnet 4.6<br><code>claude-sonnet-4-6</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Sonnet 5<br><code>claude-sonnet-5</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Claude Sonnet 5.5<br><code>claude-sonnet-5-5</code> | anthropic | <span title="1,000,000">1M</span> | <span title="128,000">128K</span> | 推理、函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Baidu: ERNIE 4.5 VL 424B A47B <br><code>ernie-4-5-vl-424b-a47b</code> | baidu | <span title="123,000">123K</span> | - | 推理、识图 | 文本、图片 | 文本 |
| ERNIE 4.5 Turbo VL<br><code>ernie-4-5-turbo-vl</code> | baidu | <span title="32,768">32K</span> | - | 函数调用、识图 | 文本、图片 | - |
| ERNIE 4.5 VL A3B<br><code>ernie-4-5-vl-a3b</code> | baidu | <span title="32,768">32K</span> | - | 推理、识图 | 文本、图片 | - |
| Inkling<br><code>inkling</code> | bailing | <span title="1,048,576">1.05M</span> | <span title="256,000">256K</span> | 函数调用、推理、识图、语音识别、结构化输出、文件输入 | 文本、图片、音频 | 文本 |
| Inkling Small<br><code>inkling-small</code> | bailing | <span title="1,048,576">1.05M</span> | <span title="1,000,000">1M</span> | 函数调用、推理、识图、语音识别、文件输入 | 文本、图片、音频 | 文本 |
| Doubao 1.5 Thinking Vision Pro<br><code>doubao-1-5-thinking-vision-pro</code> | bytedance | <span title="131,072">128K</span> | <span title="16,384">16K</span> | 推理、函数调用、识图 | 文本、图片 | 文本 |
| Doubao 1.5 UI-TARS<br><code>doubao-1-5-ui-tars</code> | bytedance | - | - | 电脑操作、识图、函数调用 | 文本、图片 | 文本 |
| Doubao 1.5 Vision Lite<br><code>doubao-1-5-vision-lite</code> | bytedance | - | - | 识图、函数调用 | 文本、图片 | 文本 |
| Doubao 1.5 Vision Pro<br><code>doubao-1-5-vision-pro</code> | bytedance | <span title="32,768">32K</span> | <span title="12,288">12K</span> | 识图、函数调用 | 文本、图片 | 文本 |
| Doubao 1.5 Vision Pro 32k<br><code>doubao-1-5-vision-pro-32k</code> | bytedance | <span title="32,768">32K</span> | <span title="12,288">12K</span> | 识图、函数调用 | 文本、图片 | 文本 |
| Doubao Seed 1.6<br><code>doubao-seed-1-6</code> | bytedance | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 推理、函数调用、识图、视频理解、文件输入、结构化输出 | 文本、图片、视频 | 文本 |
| Doubao Seed 1.6 Flash<br><code>doubao-seed-1-6-flash</code> | bytedance | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 推理、函数调用、识图、视频理解、文件输入、结构化输出 | 文本、图片、视频 | 文本 |
| Doubao Seed 1.6 Lite<br><code>doubao-seed-1-6-lite</code> | bytedance | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 推理、函数调用、识图、视频理解、文件输入、结构化输出 | 文本、图片、视频 | 文本 |
| Doubao Seed 1.6 Vision<br><code>doubao-seed-1-6-vision</code> | bytedance | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 推理、函数调用、识图、视频理解、文件输入、结构化输出、电脑操作 | 文本、图片、视频 | 文本 |
| Doubao Seed 2.0 Code<br><code>doubao-seed-2-0-code-preview</code> | bytedance | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 推理、函数调用、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Doubao Seed 2.0 Lite<br><code>doubao-seed-2-0-lite</code> | bytedance | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 推理、函数调用、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Doubao Seed 2.0 Mini<br><code>doubao-seed-2-0-mini</code> | bytedance | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 推理、函数调用、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Doubao Seed 2.0 Pro<br><code>doubao-seed-2-0-pro</code> | bytedance | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 推理、函数调用、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Doubao Seed 2.1 Pro<br><code>doubao-seed-2-1-pro</code> | bytedance | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 推理、函数调用、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Doubao Seed 2.1 Turbo<br><code>doubao-seed-2-1-turbo</code> | bytedance | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 推理、函数调用、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Doubao Seed Character<br><code>doubao-seed-character</code> | bytedance | <span title="131,072">128K</span> | <span title="32,768">32K</span> | 推理、函数调用、识图、视频理解、文件输入、结构化输出 | 文本、图片、视频 | 文本 |
| Doubao Seed Code<br><code>doubao-seed-code-preview</code> | bytedance | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 推理、函数调用、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Doubao Seed Evolving<br><code>doubao-seed-evolving</code> | bytedance | <span title="1,024,000">1.02M</span> | <span title="262,144">256K</span> | 推理、函数调用、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Seed 1.6<br><code>seed-1-6</code> | bytedance | <span title="262,144">256K</span> | <span title="32,000">32K</span> | 函数调用、推理、识图、视频理解、结构化输出 | 文本、图片、视频 | 文本 |
| Seed 1.8<br><code>seed-1-8</code> | bytedance | <span title="256,000">256K</span> | <span title="64,000">64K</span> | 函数调用、推理、识图 | 文本、图片 | 文本 |
| Aya Vision 32B<br><code>c4ai-aya-vision-32b</code> | cohere | <span title="16,384">16K</span> | <span title="4,096">4K</span> | 函数调用、识图 | 文本、图片 | 文本 |
| Aya Vision 8B<br><code>c4ai-aya-vision-8b</code> | cohere | <span title="16,384">16K</span> | <span title="4,096">4K</span> | 函数调用、识图 | 文本、图片 | 文本 |
| Command A Vision<br><code>command-a-vision-07-2025</code> | cohere | <span title="131,072">128K</span> | <span title="8,192">8K</span> | 函数调用、识图 | 文本、图片 | 文本 |
| Command A+<br><code>command-a-plus-05-2026</code> | cohere | <span title="131,072">128K</span> | <span title="65,536">64K</span> | 函数调用、推理、识图 | 文本、图片 | 文本 |
| DeepSeek V4 Flash Vision Exp<br><code>deepseek-v4-flash-vision-exp</code> | deepseek | <span title="1,048,576">1.05M</span> | <span title="393,216">384K</span> | 函数调用、识图、推理、结构化输出 | 文本、图片 | 文本 |
| DeepSeek V4.1 Flash<br><code>deepseek-flash</code> | deepseek | <span title="1,000,000">1M</span> | <span title="393,216">384K</span> | 函数调用、识图、推理、结构化输出 | 文本、图片 | 文本 |
| DeepSeek V4.1 Flash Beta<br><code>deepseek-v4-1-flash-beta</code> | deepseek | <span title="1,000,000">1M</span> | <span title="384,000">384K</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| DeepSeek: DeepSeek V4.1 Flash<br><code>deepseek-v4-1-flash</code> | deepseek | <span title="1,048,576">1.05M</span> | - | 函数调用、推理、识图、结构化输出 | 文本、图片 | 文本 |
| Gemini 2.5 Computer Use Preview 10-2025<br><code>gemini-2-5-computer-use-preview-10-2025</code> | google | <span title="131,072">128K</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Gemini 2.5 Flash<br><code>gemini-2-5-flash</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 2.5 Flash-Lite<br><code>gemini-2-5-flash-lite</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 2.5 Pro<br><code>gemini-2-5-pro</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 3 Flash<br><code>gemini-3-flash</code> | google | <span title="1,000,000">1M</span> | <span title="65,000">65K</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Gemini 3 Flash Preview<br><code>gemini-3-flash-preview</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 3.1 Flash Lite<br><code>gemini-3-1-flash-lite</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 3.1 Flash Lite Preview<br><code>gemini-3-1-flash-lite-preview</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 3.1 Pro Preview<br><code>gemini-3-1-pro-preview</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 3.1 Pro Preview Custom Tools<br><code>gemini-3-1-pro-preview-customtools</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 3.5 Flash<br><code>gemini-3-5-flash</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 3.5 Flash Lite<br><code>gemini-3-5-flash-lite</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 3.6 Flash<br><code>gemini-3-6-flash</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 3.7 Flash<br><code>gemini-3-7-flash</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 3.8 Flash<br><code>gemini-3-8-flash</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini 4 Argon<br><code>gemini-4-argon</code> | google | <span title="1,048,576">1.05M</span> | <span title="1,048,576">1.05M</span> | 推理、函数调用、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini Flash Latest<br><code>gemini-flash-latest</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemini Flash-Lite Latest<br><code>gemini-flash-lite-latest</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Gemma 3 12B IT<br><code>gemma-3-12b-it</code> | google | <span title="131,072">128K</span> | <span title="16,384">16K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Gemma 3 4B IT<br><code>gemma-3-4b-it</code> | google | <span title="131,072">128K</span> | <span title="16,384">16K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Gemma 3n E2b It<br><code>gemma-3n-e2b-it</code> | google | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Gemma 3n E4b It<br><code>gemma-3n-e4b-it</code> | google | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Gemma 4 26B A4B IT<br><code>gemma-4-26b-a4b-it</code> | google | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Gemma-4-31B-IT<br><code>gemma-4-31b-it</code> | google | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Google Gemini Pro Latest<br><code>gemini-pro-latest</code> | google | <span title="1,048,576">1.05M</span> | - | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Google Gemma 3 27B Instruct<br><code>gemma-3-27b-it</code> | google | <span title="202,752">198K</span> | <span title="8,192">8K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Google: Gemini 2.5 Pro Preview 05-06<br><code>gemini-2-5-pro-preview-05-06</code> | google | <span title="1,048,576">1.05M</span> | - | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Google: Gemini 2.5 Pro Preview 06-05<br><code>gemini-2-5-pro-preview</code> | google | <span title="1,048,576">1.05M</span> | - | 函数调用、推理、识图、语音识别、结构化输出、文件输入 | 文本、图片、音频 | 文本 |
| Llama 3.2 11b Vision Instruct<br><code>llama-3-2-11b-vision-instruct</code> | meta | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Llama 4 Maverick 17b 128e Instruct<br><code>llama-4-maverick-17b-128e-instruct</code> | meta | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Llama 4 Maverick 17B 128E Instruct<br><code>llama-4-maverick-17b-128e-instruct-maas</code> | meta | <span title="524,288">512K</span> | <span title="8,192">8K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Llama 4 Maverick 17B Instruct (US)<br><code>llama4-maverick-17b-instruct</code> | meta | <span title="1,000,000">1M</span> | <span title="16,384">16K</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Llama 4 Scout 17B Instruct (US)<br><code>llama4-scout-17b-instruct</code> | meta | <span title="3,500,000">3.5M</span> | <span title="16,384">16K</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Llama Guard 4 12B<br><code>llama-guard-4-12b</code> | meta | <span title="163,840">160K</span> | <span title="16,384">16K</span> | 识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Llama-3.2-90B-Vision-Instruct<br><code>llama-3-2-90b-vision-instruct</code> | meta | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Llama-4-Maverick-17B-128E-Instruct-FP8<br><code>llama-4-maverick</code> | meta | <span title="1,048,576">1.05M</span> | <span title="4,096">4K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Llama-4-Scout-17B-16E-Instruct-FP8<br><code>llama-4-scout</code> | meta | <span title="1,310,720">1.31M</span> | <span title="4,096">4K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Muse Spark 1.3<br><code>muse-spark-1-3</code> | meta | <span title="1,048,576">1.05M</span> | <span title="1,048,576">1.05M</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Muse Spark Open 816B A42B<br><code>muse-spark-open-816b-a42b</code> | meta | <span title="1,048,576">1.05M</span> | - | 函数调用、推理、识图、语音识别、视频理解、文件输入 | 文本、图片、音频、视频 | 文本 |
| Muse Spark Open 816B A42B NVFP4<br><code>muse-spark-open-816b-a42b-nvfp4</code> | meta | <span title="1,048,576">1.05M</span> | - | 函数调用、推理、识图、语音识别、视频理解、文件输入 | 文本、图片、音频、视频 | 文本 |
| MiniMax-M3<br><code>minimax-m3</code> | minimax | <span title="1,048,576">1.05M</span> | <span title="524,288">512K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| MiniMax-M3.1-Flash<br><code>minimax-m3-1-flash</code> | minimax | <span title="1,000,000">1M</span> | <span title="524,288">512K</span> | 推理、函数调用、识图、视频理解 | 文本、图片、视频 | 文本 |
| MiniMax: MiniMax-01<br><code>minimax-01</code> | minimax | <span title="1,000,192">1M</span> | - | 识图 | 文本、图片 | 文本 |
| Devstral Small<br><code>devstral-small</code> | mistral | <span title="256,000">256K</span> | <span title="256,000">256K</span> | 函数调用、识图 | 文本、图片 | 文本 |
| Devstral Small 2<br><code>devstral-small-2</code> | mistral | <span title="256,000">256K</span> | <span title="256,000">256K</span> | 函数调用、识图 | 文本、图片 | 文本 |
| Magistral Small 2506<br><code>magistral-small</code> | mistral | <span title="128,000">128K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出 | 文本、图片 | 文本 |
| Ministral 14B<br><code>ministral-14b</code> | mistral | <span title="262,144">256K</span> | <span title="256,000">256K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Ministral 3 14B Instruct 2512<br><code>ministral-14b-instruct</code> | mistral | <span title="262,144">256K</span> | <span title="16,384">16K</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Ministral 3 3B<br><code>ministral-3-3b-instruct</code> | mistral | <span title="256,000">256K</span> | <span title="8,192">8K</span> | 函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| Ministral 3B (latest)<br><code>ministral-3b</code> | mistral | <span title="131,072">128K</span> | <span title="128,000">128K</span> | 函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| Ministral 8B (latest)<br><code>ministral-8b</code> | mistral | <span title="262,144">256K</span> | <span title="128,000">128K</span> | 函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| Mistral Large (latest)<br><code>mistral-large-latest</code> | mistral | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Mistral Large 3<br><code>mistral-large</code> | mistral | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Mistral Large 3<br><code>mistral-large-3</code> | mistral | <span title="256,000">256K</span> | <span title="256,000">256K</span> | 识图、文件输入 | 文本、图片 | 文本 |
| Mistral Large 3 675B Instruct 2512<br><code>mistral-large-3-675b-instruct</code> | mistral | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Mistral Medium (latest)<br><code>mistral-medium-latest</code> | mistral | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Mistral Medium 3<br><code>mistral-medium-3-instruct</code> | mistral | <span title="131,072">128K</span> | <span title="32,768">32K</span> | 识图、文件输入 | 文本、图片 | 文本 |
| Mistral Medium 3.1<br><code>mistral-medium</code> | mistral | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Mistral Medium 3.5<br><code>mistral-medium-3-5-128b</code> | mistral | <span title="262,144">256K</span> | <span title="32,768">32K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Mistral Medium Latest<br><code>mistral-medium-3-5</code> | mistral | <span title="262,144">256K</span> | <span title="256,000">256K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Mistral Nemo<br><code>mistral-nemo</code> | mistral | <span title="131,072">128K</span> | <span title="128,000">128K</span> | 函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| Mistral Small (latest)<br><code>mistral-small</code> | mistral | <span title="262,144">256K</span> | <span title="256,000">256K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Mistral Small (latest)<br><code>mistral-small-latest</code> | mistral | <span title="256,000">256K</span> | <span title="256,000">256K</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| mistral-small-4-119b-2603<br><code>mistral-small-4-119b</code> | mistral | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Mistral: Mistral Medium 3<br><code>mistral-medium-3</code> | mistral | <span title="131,072">128K</span> | - | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Mistral: Mistral Medium 3.1<br><code>mistral-medium-3-1</code> | mistral | <span title="131,072">128K</span> | - | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Mistral: Mistral Small 3.1 24B<br><code>mistral-small-3-1-24b-instruct</code> | mistral | <span title="128,000">128K</span> | - | 识图 | 文本、图片 | 文本 |
| Mistral: Mistral Small 3.2 24B<br><code>mistral-small-3-2-24b-instruct</code> | mistral | <span title="131,072">128K</span> | - | 函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| Pixtral 12B<br><code>pixtral-12b</code> | mistral | <span title="128,000">128K</span> | <span title="128,000">128K</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Pixtral Large (25.02) (EU)<br><code>pixtral-large</code> | mistral | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Pixtral Large (latest)<br><code>pixtral-large-latest</code> | mistral | <span title="128,000">128K</span> | <span title="128,000">128K</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Voxtral Mini 3B 2507<br><code>voxtral-mini-3b</code> | mistral | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、语音识别、结构化输出 | 文本、音频 | 文本 |
| Voxtral Small (latest)<br><code>voxtral-small-latest</code> | mistral | <span title="32,000">32K</span> | <span title="32,000">32K</span> | 函数调用、语音识别、文件输入 | 文本、音频 | 文本 |
| Voxtral Small 24B 2507<br><code>voxtral-small-24b</code> | mistral | <span title="32,768">32K</span> | <span title="8,192">8K</span> | 函数调用、语音识别、结构化输出、文件输入 | 文本、音频 | 文本 |
| Kimi K2.7 Code<br><code>kimi-k2-7-code</code> | moonshot | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Kimi K2.7 Code High Speed<br><code>kimi-k2-7-code-highspeed</code> | moonshot | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Kimi K3<br><code>kimi-k3</code> | moonshot | <span title="1,048,576">1.05M</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Kimi K3 Fast<br><code>kimi-k3-fast</code> | moonshot | <span title="1,000,000">1M</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Kimi K3.1 Pro<br><code>kimi-k3-1-pro</code> | moonshot | <span title="1,048,576">1.05M</span> | <span title="1,048,576">1.05M</span> | 推理、函数调用、识图、视频理解、结构化输出 | 文本、图片、视频 | 文本 |
| Kimi K3.1 Pro Highspeed<br><code>kimi-k3-1-pro-highspeed</code> | moonshot | <span title="1,048,576">1.05M</span> | <span title="1,048,576">1.05M</span> | 推理、函数调用、识图、视频理解、结构化输出 | 文本、图片、视频 | 文本 |
| Moonshot Kimi K2.5<br><code>kimi-k2-5</code> | moonshot | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Moonshot Kimi K2.6<br><code>kimi-k2-6</code> | moonshot | <span title="262,144">256K</span> | <span title="262,144">256K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| MoonshotAI Kimi Latest<br><code>kimi-latest</code> | moonshot | <span title="1,048,576">1.05M</span> | - | 函数调用、推理、识图、视频理解、结构化输出 | 文本、图片、视频 | 文本 |
| Active Speaker Detection<br><code>active-speaker-detection</code> | nvidia | - | <span title="4,096">4K</span> | 视频理解、文件输入 | 视频 | 文本 |
| bevformer<br><code>bevformer</code> | nvidia | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 视频理解、文件输入 | 视频 | 文本 |
| Cosmos Reason2 8B<br><code>cosmos-reason2-8b</code> | nvidia | <span title="131,072">128K</span> | <span title="16,384">16K</span> | 函数调用、推理、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| Llama 3.1 Nemotron Nano VL 8B v1<br><code>llama-3-1-nemotron-nano-vl-8b-v1</code> | nvidia | <span title="32,768">32K</span> | <span title="16,384">16K</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Muse Glimmer 30B<br><code>muse-glimmer-30b</code> | nvidia | <span title="131,072">128K</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Nemotron 3 Nano Omni<br><code>nemotron-3-nano-omni-30b-a3b</code> | nvidia | <span title="256,000">256K</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Nemotron Nano 12B v2 VL<br><code>nemotron-nano-12b-v2-vl</code> | nvidia | <span title="131,072">128K</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、视频理解、文件输入 | 文本、图片、视频 | 文本 |
| nemotron-voicechat<br><code>nemotron-voicechat</code> | nvidia | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 函数调用、语音识别、文件输入 | 文本、音频 | 文本 |
| NVIDIA Nemotron Nano 12B v2 VL BF16<br><code>nemotron-nano-12b-v2</code> | nvidia | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| NVIDIA: Nemotron 3.5 Content Safety<br><code>nemotron-3-5-content-safety</code> | nvidia | <span title="131,072">128K</span> | - | 推理、识图、结构化输出 | 文本、图片 | 文本 |
| paligemma<br><code>paligemma</code> | nvidia | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 识图、文件输入 | 文本、图片 | 文本 |
| sparsedrive<br><code>sparsedrive</code> | nvidia | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 视频理解、文件输入 | 视频 | 文本 |
| streampetr<br><code>streampetr</code> | nvidia | <span title="128,000">128K</span> | <span title="8,192">8K</span> | 视频理解、文件输入 | 视频 | 文本 |
| synthetic-video-detector<br><code>synthetic-video-detector</code> | nvidia | - | <span title="4,096">4K</span> | 视频理解、文件输入 | 视频 | 文本 |
| GPT 5.1 Codex Max<br><code>gpt-5-1-codex-max</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.1 Thinking<br><code>gpt-5-1</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.2 <br><code>gpt-5-2-pro</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.3 Codex<br><code>gpt-5-3-codex</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.4<br><code>gpt-5-4</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.4 Mini<br><code>gpt-5-4-mini</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.4 Nano<br><code>gpt-5-4-nano</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.4 Pro<br><code>gpt-5-4-pro</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.5<br><code>gpt-5-5</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.5 Pro<br><code>gpt-5-5-pro</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.6 Luna<br><code>gpt-5-6-luna</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.6 Sol<br><code>gpt-5-6-sol</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT 5.6 Terra<br><code>gpt-5-6-terra</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-4 Turbo<br><code>gpt-4-turbo</code> | openai | <span title="128,000">128K</span> | <span title="4,096">4K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-4.1<br><code>gpt-4-1</code> | openai | <span title="1,047,576">1.05M</span> | <span title="32,768">32K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-4.1 mini<br><code>gpt-4-1-mini</code> | openai | <span title="1,047,576">1.05M</span> | <span title="32,768">32K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-4.1 nano<br><code>gpt-4-1-nano</code> | openai | <span title="1,047,576">1.05M</span> | <span title="32,768">32K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-4o<br><code>gpt-4o</code> | openai | <span title="128,000">128K</span> | <span title="16,384">16K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-4o mini<br><code>gpt-4o-mini</code> | openai | <span title="128,000">128K</span> | <span title="16,384">16K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5<br><code>gpt-5</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5 Mini<br><code>gpt-5-mini</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5 Nano<br><code>gpt-5-nano</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5 pro<br><code>gpt-5-pro</code> | openai | <span title="400,000">400K</span> | <span title="272,000">272K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5-Codex<br><code>gpt-5-codex</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5.1 Codex mini<br><code>gpt-5-1-codex-mini</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5.1-Codex<br><code>gpt-5-1-codex</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5.2<br><code>gpt-5-2</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5.2 Chat<br><code>gpt-5-2-chat-latest</code> | openai | <span title="128,000">128K</span> | <span title="16,384">16K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5.2-Codex<br><code>gpt-5-2-codex</code> | openai | <span title="400,000">400K</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5.3 Chat (latest)<br><code>gpt-5-3-chat-latest</code> | openai | <span title="128,000">128K</span> | <span title="16,384">16K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5.3 Codex Spark<br><code>gpt-5-3-codex-spark</code> | openai | <span title="128,000">128K</span> | <span title="32,000">32K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-5.6<br><code>gpt-5-6</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| GPT-6 Astra<br><code>gpt-6-astra</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 推理、函数调用、识图、结构化输出、文件检索 | 文本、图片 | 文本 |
| GPT-6 Luna<br><code>gpt-6-luna</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 推理、函数调用、识图、结构化输出、文件检索 | 文本、图片 | 文本 |
| GPT-6 Sol<br><code>gpt-6-sol</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 推理、函数调用、识图、结构化输出、文件检索 | 文本、图片 | 文本 |
| GPT-6.1 Sol<br><code>gpt-6-1-sol</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 推理、函数调用、识图、结构化输出、文件检索 | 文本、图片 | 文本 |
| GPT-6.1 Terra<br><code>gpt-6-1-terra</code> | openai | <span title="1,050,000">1.05M</span> | <span title="128,000">128K</span> | 推理、函数调用、识图、结构化输出、文件检索 | 文本、图片 | 文本 |
| o1<br><code>o1</code> | openai | <span title="200,000">200K</span> | <span title="100,000">100K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| o1-pro<br><code>o1-pro</code> | openai | <span title="200,000">200K</span> | <span title="100,000">100K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| o3<br><code>o3</code> | openai | <span title="200,000">200K</span> | <span title="100,000">100K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| o3 Pro<br><code>o3-pro</code> | openai | <span title="200,000">200K</span> | <span title="100,000">100K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| o4-mini<br><code>o4-mini</code> | openai | <span title="200,000">200K</span> | <span title="100,000">100K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| OpenAI GPT Latest<br><code>gpt-latest</code> | openai | <span title="1,050,000">1.05M</span> | - | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| OpenAI GPT Mini Latest<br><code>gpt-mini-latest</code> | openai | <span title="400,000">400K</span> | - | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| OpenAI: GPT Chat Latest<br><code>gpt-chat-latest</code> | openai | <span title="400,000">400K</span> | - | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| OpenAI: GPT-5.2 Chat<br><code>gpt-5-2-chat</code> | openai | <span title="128,000">128K</span> | - | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| OpenAI: GPT-5.6 Luna Pro<br><code>gpt-5-6-luna-pro</code> | openai | <span title="1,050,000">1.05M</span> | - | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| OpenAI: GPT-5.6 Sol Pro<br><code>gpt-5-6-sol-pro</code> | openai | <span title="1,050,000">1.05M</span> | - | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| OpenAI: GPT-5.6 Terra Pro<br><code>gpt-5-6-terra-pro</code> | openai | <span title="1,050,000">1.05M</span> | - | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| OpenAI: GPT-6 Astra Pro<br><code>gpt-6-astra-pro</code> | openai | <span title="1,050,000">1.05M</span> | - | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Sonar<br><code>sonar</code> | perplexity | <span title="128,000">128K</span> | <span title="8,000">8K</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Sonar Pro<br><code>sonar-pro</code> | perplexity | <span title="200,000">200K</span> | <span title="8,192">8K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Sonar Reasoning Pro<br><code>sonar-reasoning-pro</code> | perplexity | <span title="128,000">128K</span> | <span title="8,000">8K</span> | 推理、识图、文件输入 | 文本、图片 | 文本 |
| Reka Edge<br><code>reka-edge</code> | reka | <span title="16,384">16K</span> | - | 函数调用、识图、视频理解、结构化输出 | 文本、图片、视频 | 文本 |
| Step 3.5 Flash 2603<br><code>step-3-5-flash</code> | stepfun | <span title="262,144">256K</span> | <span title="262,114">262.11K</span> | 函数调用、推理、识图 | 文本、图片 | 文本 |
| Step 3.7 Flash<br><code>step-3-7-flash</code> | stepfun | <span title="262,144">256K</span> | <span title="256,000">256K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Kat Coder Air V2.5<br><code>kat-coder-air-v2-5</code> | streamlake | <span title="256,000">256K</span> | <span title="80,000">80K</span> | 函数调用、推理、识图 | 文本、图片 | 文本 |
| Kat Coder Pro V2.5<br><code>kat-coder-pro-v2-5</code> | streamlake | <span title="262,144">256K</span> | <span title="80,000">80K</span> | 函数调用、推理、识图、结构化输出 | 文本、图片 | 文本 |
| Fugu Ultra<br><code>fugu-ultra</code> | vercel | <span title="1,000,000">1M</span> | <span title="1,000,000">1M</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Interfaze Beta<br><code>interfaze-beta</code> | vercel | <span title="1,000,000">1M</span> | <span title="32,000">32K</span> | 推理、识图 | 文本、图片 | 文本 |
| Muse Spark 1.1<br><code>muse-spark-1-1</code> | vercel | <span title="1,048,576">1.05M</span> | <span title="1,048,576">1.05M</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Muse Spark 1.2<br><code>muse-spark-1-2</code> | vercel | <span title="1,048,576">1.05M</span> | <span title="1,048,576">1.05M</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Muse Spark 1.2 Contributor<br><code>muse-spark-1-2-contributor</code> | vercel | <span title="1,048,576">1.05M</span> | <span title="1,048,576">1.05M</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Muse Spark 1.3 Contributor<br><code>muse-spark-1-3-contributor</code> | vercel | <span title="1,048,576">1.05M</span> | <span title="1,048,576">1.05M</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| Sakana Namazu<br><code>namazu</code> | vercel | <span title="262,144">256K</span> | <span title="256,000">256K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Grok 2 Vision<br><code>grok-2-vision</code> | xai | <span title="32,768">32K</span> | - | 函数调用、识图 | 文本、图片 | - |
| Grok 4.1 Fast Non-Reasoning<br><code>grok-4-1-fast-non-reasoning</code> | xai | <span title="1,000,000">1M</span> | <span title="1,000,000">1M</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Grok 4.1 Fast Reasoning<br><code>grok-4-1-fast</code> | xai | <span title="1,000,000">1M</span> | <span title="1,000,000">1M</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Grok 4.20 (Non-Reasoning)<br><code>grok-4-20-0309-non-reasoning</code> | xai | <span title="1,000,000">1M</span> | <span title="30,000">30K</span> | 函数调用、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Grok 4.20 Beta Non-Reasoning<br><code>grok-4-20-non-reasoning-beta</code> | xai | <span title="2,000,000">2M</span> | <span title="2,000,000">2M</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Grok 4.20 Beta Reasoning<br><code>grok-4-20-reasoning-beta</code> | xai | <span title="2,000,000">2M</span> | <span title="2,000,000">2M</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Grok 4.20 Multi Agent Beta<br><code>grok-4-20-multi-agent-beta</code> | xai | <span title="2,000,000">2M</span> | <span title="2,000,000">2M</span> | 函数调用、推理、识图、文件输入 | 文本、图片 | 文本 |
| Grok 4.20 Multi-Agent<br><code>grok-4-20-multi-agent</code> | xai | <span title="2,000,000">2M</span> | <span title="2,000,000">2M</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Grok 4.20 Non-Reasoning<br><code>grok-4-20-non-reasoning</code> | xai | <span title="2,000,000">2M</span> | <span title="2,000,000">2M</span> | 函数调用、识图、文件输入 | 文本、图片 | 文本 |
| Grok 4.20 Reasoning<br><code>grok-4-20</code> | xai | <span title="2,000,000">2M</span> | <span title="2,000,000">2M</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Grok 4.3<br><code>grok-4-3</code> | xai | <span title="1,000,000">1M</span> | <span title="1,000,000">1M</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Grok 4.5<br><code>grok-4-5</code> | xai | <span title="500,000">500K</span> | <span title="500,000">500K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Grok 4.6<br><code>grok-4-6</code> | xai | <span title="500,000">500K</span> | <span title="500,000">500K</span> | 推理、函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| Grok 4.7<br><code>grok-4-7</code> | xai | <span title="500,000">500K</span> | <span title="500,000">500K</span> | 推理、函数调用、识图、结构化输出 | 文本、图片 | 文本 |
| Grok Build 0.1<br><code>grok-build-0-1</code> | xai | <span title="256,000">256K</span> | <span title="256,000">256K</span> | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| Grok Vision Beta<br><code>grok-vision-beta</code> | xai | <span title="8,192">8K</span> | - | 识图 | 文本、图片 | - |
| xAI: Grok Latest<br><code>grok-latest</code> | xai | <span title="500,000">500K</span> | - | 函数调用、推理、识图、结构化输出、文件输入 | 文本、图片 | 文本 |
| MiMo-V2-Omni<br><code>mimo-v2-omni</code> | xiaomi | <span title="262,144">256K</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、语音识别、视频理解、文件输入 | 文本、图片、音频、视频 | 文本 |
| MiMo-V2.5<br><code>mimo-v2-5</code> | xiaomi | <span title="1,050,000">1.05M</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| MiMo-V2.6-Flash<br><code>mimo-v2-6-flash</code> | xiaomi | <span title="1,048,576">1.05M</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| MiMo-V2.6-Pro<br><code>mimo-v2-6-pro</code> | xiaomi | <span title="1,048,576">1.05M</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| MiMo-V2.6-Pro-UltraSpeed<br><code>mimo-v2-6-pro-ultraspeed</code> | xiaomi | <span title="1,048,576">1.05M</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、语音识别、视频理解、结构化输出、文件输入 | 文本、图片、音频、视频 | 文本 |
| GLM 4.5V<br><code>glm-4-5v</code> | zhipu | <span title="66,000">66K</span> | <span title="16,384">16K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| GLM 5V Turbo<br><code>glm-5v-turbo</code> | zhipu | <span title="202,752">198K</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| GLM-4.1V-Thinking<br><code>glm-4-1v</code> | zhipu | <span title="65,536">64K</span> | - | 推理、识图 | 文本、图片 | - |
| GLM-4.6V<br><code>glm-4-6v</code> | zhipu | <span title="131,072">128K</span> | <span title="32,768">32K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| GLM-4V<br><code>glm-4v</code> | zhipu | <span title="8,192">8K</span> | - | 识图 | 文本、图片 | - |
| GLM-4V-Flash<br><code>glm-4v-flash</code> | zhipu | <span title="8,192">8K</span> | - | 识图 | 文本、图片 | - |
| GLM-4V-Plus<br><code>glm-4v-plus</code> | zhipu | <span title="8,192">8K</span> | - | 识图 | 文本、图片 | - |
| GLM-5.3-Flash<br><code>glm-5-3-flash</code> | zhipu | <span title="1,000,000">1M</span> | <span title="131,072">128K</span> | 函数调用、推理、识图、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本 |
| Z.ai: GLM Flash Latest<br><code>glm-flash-latest</code> | zhipu | <span title="1,310,720">1.31M</span> | - | 函数调用、推理、识图、视频理解、结构化输出 | 文本、图片、视频 | 文本 |

</div>
