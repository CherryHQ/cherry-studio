---
rich: true
icon: cherries
---

# Cherry Studio 使用文档

<a id="xiang-mu-jian-jie"></a>

Cherry Studio 使用文档：按你要完成的事找到教程。

<div data-cards>
<div data-card>

[**第一次使用**](getting-started/quick-start.md)

从安装、连接模型到发出第一条消息。

</div>
<div data-card>

[**完成一个任务**](#日常使用)

查找对话、知识库、绘画与翻译教程。

</div>
<div data-card>

[**遇到问题**](question-contact/questions.md)

先按现象排查。

</div>
</div>

## 开始使用

[下载与安装](cherry-studio/installation/README.md) · [快速开始](getting-started/quick-start.md) · [升级与降级](cherry-studio/installation/upgrade-downgrade.md)

## 日常使用

[对话与助手](cherrystudio/preview/chat.md) · [用自己的资料问答](knowledge-base/knowledge-base.md) · [生成与编辑图片](advanced-basic/knowledge-content/painting-workflow.md) · [翻译文件与长文](advanced-basic/knowledge-content/translation-workflow.md) · [更多任务案例](advanced-basic/cases/README.md)

<a id="agent-yu-zi-dong-hua"></a>
<a id="agent-与自动化"></a>

## 智能体与自动化

[创建智能体](advanced-basic/agent-workspace/create-agent.md) · [处理任务与文件](advanced-basic/agent-workspace/workspaces-tasks-files.md) · [技能与 MCP](advanced-basic/extensions/README.md) · [频道与定时任务](advanced-basic/automation/README.md)

## 配置与数据

[连接模型服务](pre-basic/providers/README.md) · [软件设置](pre-basic/settings/README.md) · [备份与数据管理](pre-basic/data-settings/README.md)

## 故障排查

[常见问题](question-contact/questions.md) · [知识库排错](knowledge-base/troubleshooting.md) · [MCP 排错](advanced-basic/extensions/mcp/troubleshooting.md) · [反馈问题](question-contact/suggestions.md)

## 开发者与贡献

[API 网关与诊断工具](advanced-basic/developer-tools/README.md) · [贡献代码](contribution/code.md) · [贡献文档](contribution/docs.md)

***

<figure><img src="assets/fc946e1426d78466ee005eba.webp" alt=""><figcaption></figcaption></figure>

关注我们的社交账号：[推特(X)](https://x.com/CherryStudioHQ)、[小红书](https://www.xiaohongshu.com/user/profile/662b6853000000000b031d9a)、[微博](https://weibo.com/u/7975656228)、[哔哩哔哩](https://space.bilibili.com/3546657515898892)、[抖音](https://www.douyin.com/user/MS4wLjABAAAAmw9A54m5J0hHVMQY5eGrVJ-EHDoOS0hgJ6M1F9MN2Tn2V163A0xrC4_KVzfmQSxC)

加入我们的社群：[QQ 群](https://qm.qq.com/q/lo0D4qVZKi)、[Telegram](https://t.me/CherryStudioAI)、[Discord](https://discord.gg/wez8HtpxqQ)、[微信群](https://www.cherry-ai.com/#Community)

***

Cherry Studio 是一款集多模型对话、智能体、知识库管理、AI 绘画、翻译等功能于一体的全能 AI 工作台。Cherry Studio 高度自定义的设计、强大的扩展能力和友好的用户体验，使其成为专业用户和 AI 爱好者的理想选择。无论是零基础用户还是开发者，都能在 Cherry Studio 中找到适合自己的 AI 功能，提升工作效率和创造力。

<figure><img src="assets/92f4cf63702b053822a1545a.webp" alt=""><figcaption></figcaption></figure>

<figure><img src="assets/966fd71abb99ba9ad5979151.webp" alt=""><figcaption></figcaption></figure>

***

### **核心功能与特色**

#### **1. 基础对话功能**

* **一问多答**：支持同一问题通过多个模型同时生成回复，方便用户对比不同模型的表现，详见 对话界面。
* **自动分组**：每个助手的对话记录会自动分组管理，便于用户快速查找历史对话。
* **对话导出**：支持将完整对话或部分对话导出为多种格式（如 Markdown、Word 等），方便储存与分享。
* **高度自定义参数**：除了基础参数调整外，还支持用户填写自定义参数，满足个性化需求。
* **预设助手**：可在对话中的助手模块浏览和使用预设助手，涵盖翻译、编程、写作等场景，同时支持用户自定义助手。
* **多种格式渲染**：支持 Markdown 渲染、公式渲染、HTML 实时预览等功能，提升内容展示效果。

#### **2. 智能体与自动化**

* **智能体**：可在 **工作** 页面中读取文件、运行命令并完成多步任务，详见 工作。
* **技能（Skill）**：为助手或智能体加装的"专业能力包"（如做小红书图文、画流程图），开箱即用，详见 技能。
* **MCP**：通过 Model Context Protocol 接入外部工具与服务（数据库、Notion、GitHub 等），详见 [MCP 使用教程](advanced-basic/extensions/mcp/README.md)。
* **频道**：将智能体派驻到飞书 / 微信 / Telegram / Discord 等 IM 平台担任群机器人，详见 频道。
* **定时任务**：让智能体按计划自动运行（如每日新闻简报、每周汇总），详见 定时任务。

#### **3. 多种特色功能集成**

* **AI 绘画**：提供专用绘画面板，用户可通过自然语言描述生成高质量图像。
* **AI 小程序**：集成多种免费 Web 端 AI 工具，无需切换浏览器即可直接使用。
* **翻译功能**：支持专用翻译面板、对话翻译、提示词翻译等多种翻译场景。
* **笔记**：内置 Markdown 编辑器，支持与对话内容互通，便于沉淀整理。
* **文件管理**：对话、绘画和知识库中的文件统一分类管理，避免繁琐查找。
* **全局搜索**：支持快速定位历史记录和知识库内容，提升工作效率。

#### **4. 多服务商统一管理机制**

* **服务商模型聚合**：支持 OpenAI、Gemini、Anthropic、Azure 等主流服务商的模型统一调用。
* **模型自动获取**：一键获取完整模型列表，无需手动配置。
* **多秘钥轮询**：支持多个 API 秘钥轮换使用，避免速率限制问题。
* **精准头像匹配**：为每个模型自动匹配专属头像，提升辨识度。
* **自定义服务商**：支持符合 OpenAI、Gemini 、Anthropic 等规范的三方服务商接入，兼容性强。

#### **5. 高度自定义界面和布局**

* **自定义 CSS**：支持全局样式自定义，打造专属界面风格。
* **自定义对话布局**：支持列表或气泡样式布局，并可自定义消息样式（如代码片段样式）。
* **自定义头像**：支持为软件和助手设置个性化头像。
* **自定义侧边栏菜单**：用户可根据需求隐藏或排序侧边栏功能，优化使用体验。

#### **6. 本地知识库系统**

* **多种格式支持**：支持 PDF、DOCX、PPTX、XLSX、TXT、MD 等多种文件格式导入。
* **多种数据源支持**：支持本地文件、网址、站点地图甚至手动输入内容作为知识库源。
* **知识库导出**：支持将处理好的知识库导出并分享给他人使用。
* **支持搜索检查**：知识库导入后，用户可实时检索测试，查看处理结果和分段效果。

#### **7. 特色聚焦功能**

* **快捷问答**：在任何场景（如微信、浏览器）中呼出快捷助手，快速获取答案。
* **划词助手**：在任意应用选中文字后，通过浮动工具栏一键调用 AI 做翻译、解释、优化、总结等操作。
* **快捷翻译**：支持快速翻译其他场景中的词汇或文本。
* **内容总结**：对长文本内容进行快速总结，提升信息提取效率。
* **解释说明**：无需复杂提示词，一键解释说明不懂的问题。

#### **8. 数据保障**

* **多种备份方案**：支持本地备份、WebDAV 备份和定时备份，确保数据安全。
* **数据安全**：支持全本地场景使用，结合本地大模型，避免数据泄漏风险。

***

### **项目优势**

1. **小白友好**：Cherry Studio 致力于降低技术门槛，零基础用户也能快速上手，让用户专注于工作、学习或者创作。
2. **文档完善**：提供详细的使用文档和常见问题处理手册，帮助用户快速解决问题。
3. **持续迭代**：项目团队积极响应用户反馈，持续优化功能，确保项目健康发展。
4. **开源与扩展性**：支持用户通过开源代码进行定制和扩展，满足个性化需求。

***

### **适用场景**

* **知识管理与查询**：通过本地知识库功能，快速构建和查询专属知识库，适用于研究、教育等领域。
* **多模型对话与创作**：支持多模型同时对话，帮助用户快速获取信息或生成内容。
* **翻译与办公自动化**：内置翻译助手和文件处理功能，适合需要跨语言交流或文档处理的用户。
* **AI 绘画与设计**：通过自然语言描述生成图像，满足创意设计需求。

### Star History

<a href="https://star-history.dera.page/#CherryHQ/cherry-studio&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=CherryHQ/cherry-studio&amp;type=Date&amp;theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=CherryHQ/cherry-studio&amp;type=Date" />
    <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=CherryHQ/cherry-studio&amp;type=Date" />
  </picture>
</a>

## 关注我们的社交账号

<table data-view="cards"><thead><tr><th></th><th data-hidden data-card-cover data-type="files"></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><a href="https://www.xiaohongshu.com/user/profile/662b6853000000000b031d9a?xsec_token=YB_1nKvlH4r5hPYVVbbsNHF8Y6n6AKlm5-DaggPCtd2DQ%3D&#x26;xsec_source=app_share&#x26;xhsshare=CopyLink&#x26;appuid=662b6853000000000b031d9a&#x26;apptime=1738627324&#x26;share_id=ace5db41b5954fab8d98a2a7865a62bc&#x26;share_channel=copy_link">小红书</a></td><td><a href=".gitbook/assets/1.webp">1.png</a></td><td><a href="https://www.xiaohongshu.com/user/profile/662b6853000000000b031d9a?xsec_token=YB_1nKvlH4r5hPYVVbbsNHF8Y6n6AKlm5-DaggPCtd2DQ%3D&#x26;xsec_source=app_share&#x26;xhsshare=CopyLink&#x26;appuid=662b6853000000000b031d9a&#x26;apptime=1738627324&#x26;share_id=ace5db41b5954fab8d98a2a7865a62bc&#x26;share_channel=copy_link">https://www.xiaohongshu.com/user/profile/662b6853000000000b031d9a?xsec_token=YB_1nKvlH4r5hPYVVbbsNHF8Y6n6AKlm5-DaggPCtd2DQ%3D&#x26;xsec_source=app_share&#x26;xhsshare=CopyLink&#x26;appuid=662b6853000000000b031d9a&#x26;apptime=1738627324&#x26;share_id=ace5db41b5954fab8d98a2a7865a62bc&#x26;share_channel=copy_link</a></td></tr><tr><td><a href="https://b23.tv/hIfGgDW">哔哩哔哩</a></td><td><a href=".gitbook/assets/3.webp">3.png</a></td><td><a href="https://b23.tv/hIfGgDW">https://b23.tv/hIfGgDW</a></td></tr><tr><td><a href="https://weibo.com/u/7975656228">微博</a></td><td><a href=".gitbook/assets/2.webp">2.png</a></td><td><a href="https://weibo.com/u/7975656228">https://weibo.com/u/7975656228</a></td></tr><tr><td><a href="https://v.douyin.com/ifTpX4X7">抖音</a></td><td><a href=".gitbook/assets/4.webp">4.png</a></td><td><a href="https://v.douyin.com/ifTpX4X7">https://v.douyin.com/ifTpX4X7</a></td></tr><tr><td><a href="https://x.com/CherryStudioHQ?t=DYR0ulaLur-bO4Us3bG79A&#x26;s=05">推特(X)</a></td><td><a href=".gitbook/assets/5.webp">5.png</a></td><td><a href="https://x.com/CherryStudioHQ?t=DYR0ulaLur-bO4Us3bG79A&#x26;s=05">https://x.com/CherryStudioHQ?t=DYR0ulaLur-bO4Us3bG79A&#x26;s=05</a></td></tr></tbody></table>
