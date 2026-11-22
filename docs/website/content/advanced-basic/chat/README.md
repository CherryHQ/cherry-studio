---
description: 多模型、分支、长对话与产物
icon: comments
---

# 对话进阶

【对话】适合边交流边整理思路。除了单模型问答，还可以并排比较多个模型、从任意消息创建分支、管理长对话上下文，并把回复中的文件、图片、代码和引用作为产物继续使用。

{% hint style="info" %}
如果任务需要连续读写本地文件、调用多种工具或长时间运行，改用【工作】中的智能体。对话更适合讨论、比较和定稿，智能体更适合执行。
{% endhint %}

<figure><img src="../../assets/5c0f5f563432facacf7942d6.webp" alt="对话进阶中从完整问题到比较、分支和产物的选择流程图"><figcaption><p>问题和输出要求先写完整；只有需要交叉验证时再增加模型比较或消息分支。</p></figcaption></figure>

## 按目标选择能力

| 目标 | 推荐做法 |
| ------------- | --------------------- |
| 比较不同模型的观点 | 在输入区选择多个模型后发送同一个问题 |
| 保留原讨论并探索另一条思路 | 从关键消息创建分支 |
| 继续很长的讨论 | 查看上下文用量，必要时总结后新开话题 |
| 让下一条问题稍后发送 | 使用消息队列，不必打断当前回复 |
| 继续处理回复中的文件或代码 | 打开产物预览，再下载、复制或在新任务中继续 |

<figure><img src="../../assets/290e0288048d57cd868cb443.webp" alt="对话中的模型选择器和多个模型入口"><figcaption><p>模型选择器可以为同一个问题选择一个或多个模型。</p></figcaption></figure>

## 比较参考价格

在选择器中悬停或聚焦模型行以打开详情卡片。模型行聚焦且卡片打开时，可用 Page Down / Page Up 滚动长价格列表。参考价格展示配置/目录中的每百万 token 输入、输出和缓存费率，以及已知的 token 阶梯和每图/像素或每分钟费率。零表示已知的零费率，不可用不等于免费。币种明确展示，不猜测未指定的非 token 币种。

普通选择器在存在计费规则时，按所示参考时间应用现有服务商计费规则。重新打开卡片可刷新时间。缺少服务商上下文的卡片会标明费率未调整，自定义模型价格单独标注。这些是估算，并非服务商实时报价或最终账单；请求时间、token 阶梯、缓存使用和其他费用可能改变实际支出。请在现有模型/服务商计费设置中编辑费率，而非选择器。

## 推荐顺序

{% stepper %}
{% step %}
### 1. 先把问题写完整

说明目标、材料、限制和希望的输出方式。多个模型只会放大原问题的差异，不会自动补齐缺少的信息。
{% endstep %}

{% step %}
### 2. 再决定是否需要比较

需要不同视角时再选多个模型。日常问答保持单模型，界面更清楚，用量也更容易控制。
{% endstep %}

{% step %}
### 3. 把有效结论沉淀下来

可复用的资料存入笔记或知识库；需要继续执行的工作交给智能体，并附上已经确认的结论。
{% endstep %}
{% endstepper %}

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>多模型对比与消息分支</strong></td><td>比较答案，同时保留探索路径</td><td><a href="model-compare-branches.md">model-compare-branches.md</a></td></tr><tr><td><strong>长对话、上下文与排队消息</strong></td><td>让长对话保持清楚、可控</td><td><a href="context-queue.md">context-queue.md</a></td></tr><tr><td><strong>产物、引用与导出</strong></td><td>检查并带走真正有用的结果</td><td><a href="artifacts-export.md">artifacts-export.md</a></td></tr></tbody></table>
