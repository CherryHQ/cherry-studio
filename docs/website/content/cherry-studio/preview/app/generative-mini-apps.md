---
description: 制作、安装和使用可调用 Cherry Studio AI 能力的自定义小程序
icon: wand-magic-sparkles
---

# 生成式小程序

生成式小程序是运行在 Cherry Studio【小程序】中的本地 Web 应用。它的界面和业务流程由你自定义，并可通过 `window.cherry` 调用 Cherry Studio 已配置的 AI 模型，把一个通用模型变成写作助手、信息提取器、学习工具或专用业务应用。

它与普通网站型小程序的区别不在外观，而在能力来源：网站型小程序只是打开一个 URL；生成式小程序需要打包为 `.miniapp`，安装并获得授权后，才能调用 Cherry 的 AI、沙盒数据、文件、通知、网络和剪贴板能力。

{% hint style="info" %}
Cherry Studio 提供运行环境、授权机制和 AI 接口。你可以自己编写小程序，也可以让 AI 编程工具先生成 HTML、CSS 和 JavaScript，再按本页说明打包安装。
{% endhint %}

## 目标与前置条件

完成本页后，你可以：

* 安装并使用别人提供的生成式小程序；
* 从一个简单需求制作自己的 `.miniapp` 包；
* 让小程序调用 Cherry Studio 的【默认模型】或【快速模型】；
* 检查权限、活动日志、存储、更新和卸载状态。

使用现成小程序只需准备可信的 `.miniapp` 文件或安装网址。自己制作时，还需要能编辑网页文件和创建 ZIP 压缩包；如果要测试 AI 功能，请先在 Cherry Studio 中配置一个可用的对话模型。

## 术语

| 术语 | 界面名称 | 本页含义 |
| ------ | ------------- | ----------------------------------------- |
| 生成式小程序 | 【生成式小程序】 | 可自定义界面与流程，并调用 Cherry Studio AI 能力的小程序 |
| 本地小程序 | 【本地小程序】 | 以 `.miniapp` 包安装、在独立沙盒中运行的小程序类型 |
| 网站型小程序 | 【网站】 | 通过 URL 打开的网页，不具备 `window.cherry` 能力 |
| 权限 | 【权限】 | 小程序安装时申请、由用户审阅的能力范围 |
| 模型槽位 | 【默认模型】、【快速模型】 | 由用户为该小程序选择的两个模型位置，小程序看不到服务商、模型名称和 API Key |

## 操作路径

使用现成小程序：`【启动台】→【生成式小程序】→【本地小程序】→选择文件或输入安装网址→审阅权限→【安装】`

也可以从小程序页进入：`【启动台】→【小程序】→右上角【添加小程序】→【本地小程序】`

管理已安装小程序：`【小程序】→右键目标小程序→【查看详情】`

## 操作步骤

### 安装并第一次使用

{% stepper %}
{% step %}
### 打开安装入口

在【启动台】点击【生成式小程序】，或进入【小程序】后点击右上角的【添加小程序】。在弹出的面板中切换到【本地小程序】。
{% endstep %}

{% step %}
### 选择安装来源

把一个 `.miniapp` 包拖入安装区，或点击【选择文件…】。如果开发者提供了 HTTPS 安装网址，也可以粘贴网址后点击【加载】。
{% endstep %}

{% step %}
### 审阅权限

安装确认页会显示小程序名称、版本、说明和全部权限。必需权限不能取消；可选权限默认勾选，你可以在安装前取消，也可以安装后再调整。

只有小程序用途与权限相符、来源可信时才继续。需要 AI 的小程序通常会显示【AI 能力】→【对话】。
{% endstep %}

{% step %}
### 安装并打开

点击【安装】。安装完成后，小程序会出现在【小程序】网格中；点击图标即可运行。
{% endstep %}
{% endstepper %}

### 为小程序选择 AI 模型

1. 在【小程序】网格中右键目标小程序，选择【查看详情】。
2. 切换到【设置】，找到【AI 模型】。
3. 根据小程序用途设置【默认模型】和【快速模型】。留空时分别跟随 Cherry Studio 的全局默认模型和全局快速模型。
4. 重新打开小程序并触发一次 AI 操作。如果没有可用模型，小程序应提示 AI 暂不可用。

【默认模型】适合长文生成、复杂分析等主要任务；【快速模型】适合标题建议、短句改写、标签提取等低延迟任务。最终使用哪个槽位由小程序设计决定。

### 制作一个最小版本

生成式小程序本质上是一个静态网页项目。最小目录只需要两个文件：

```
my-writer/
├── manifest.json
└── index.html
```

先创建 `manifest.json`，声明应用信息和 `ai.chat` 权限：

```json
{
  "id": "com.example.my-writer",
  "name": { "zh": "灵感改写", "en": "Rewrite Helper" },
  "description": "输入一段文字，调用 Cherry Studio 的 AI 模型进行改写。",
  "version": "1.0.0",
  "entry": "index.html",
  "permissions": ["ai.chat"]
}
```

`id` 建议使用自己控制的反向域名格式，只能包含小写字母、数字、点和连字符。`com.cherrystudio.*` 是官方保留范围，不要使用。

再在 `index.html` 中通过全局对象 `cherry` 调用 AI。下面的例子会先确认【默认模型】可用，再把流式文本逐段显示出来：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/__cherry/theme.css" />
    <title>灵感改写</title>
  </head>
  <body>
    <textarea id="source" placeholder="输入要改写的文字"></textarea>
    <button id="rewrite">开始改写</button>
    <pre id="result"></pre>

    <script>
      const button = document.querySelector('#rewrite')
      const source = document.querySelector('#source')
      const result = document.querySelector('#result')

      button.addEventListener('click', async () => {
        const capability = await cherry.ai.getCapabilities({ model: 'default' })
        if (!capability.available) {
          result.textContent = '请先在小程序详情中配置可用模型。'
          return
        }

        result.textContent = ''
        await cherry.ai.chat(
          {
            model: 'default',
            reasoning: 'off',
            messages: [
              { role: 'system', content: '你是中文编辑，保持原意并让表达更清楚。' },
              { role: 'user', content: source.value }
            ]
          },
          {
            callId: `rewrite-${Date.now()}`,
            onChunk: (text) => {
              result.textContent += text
            }
          }
        )
      })
    </script>
  </body>
</html>
```

`window.cherry` 和 `cherry` 指向同一套宿主接口，不需要引入 SDK。小程序只能发送文本消息，目前不支持图片输入或工具调用。它只指定使用 `default` 或 `quick` 槽位，不会拿到模型名称、服务商信息或 API Key。

### 打包并测试

1. 确认 `manifest.json` 位于项目根目录，入口文件与 `entry` 一致。
2. 在项目目录内执行压缩；macOS 或 Linux 可使用：

```bash
zip -r ../my-writer.miniapp . -x '.*' -x '__MACOSX/*'
```

Windows PowerShell 可先生成 ZIP，再改为 `.miniapp` 扩展名：

```powershell
Compress-Archive -Path .\* -DestinationPath ..\my-writer.zip
Rename-Item ..\my-writer.zip my-writer.miniapp
```

3. 在 Cherry Studio 的【本地小程序】安装区选择生成的 `my-writer.miniapp`。
4. 确认安装页只申请预期权限，安装后打开并测试输入、AI 输出、异常提示和重新进入后的状态。
5. 需要调试时，打开小程序工具栏中的【开发者工具】，查看页面错误和被沙盒阻止的请求。

{% hint style="warning" %}
不要从外层目录压缩整个项目文件夹，确保压缩包根目录能直接看到 `manifest.json`。Cherry Studio 也能识别只有一层目录包裹的压缩包，但清晰的根目录结构更容易排错。
{% endhint %}

## 预期结果

安装完成后，你应能在【小程序】网格中看到新图标。打开后，输入文字并点击按钮，结果区会持续出现模型返回的文本。右键小程序进入【查看详情】，可以看到它申请的【AI 能力】权限、所用模型槽位和最近的调用记录。

如果安装成功但 AI 不可用，先检查【查看详情】→【设置】中的模型，再检查【权限】中是否允许【AI 能力】→【对话】。

## 关键截图

<figure><img src="../../../assets/e5eba0b497cc060dda3fe81c.webp" alt="启动台中的生成式小程序入口"><figcaption><p>启动台中的【生成式小程序】入口。</p></figcaption></figure>

1. 点击【生成式小程序】打开【添加小程序】面板。

<figure><img src="../../../assets/68bb09ec12fa8bbc76f5056c.webp" alt="本地小程序安装面板中的文件和网址安装入口"><figcaption><p>本地小程序支持从文件或网址安装。</p></figcaption></figure>

1. 拖入 `.miniapp` 包或点击【选择文件…】。
2. 也可以填写开发者提供的 HTTPS 安装网址。

<figure><img src="../../../assets/de4dd1594767eab1bc306a63.webp" alt="本地小程序详情中的权限页"><figcaption><p>【权限】页列出小程序获准调用的宿主能力。</p></figcaption></figure>

1. 核对【AI 能力】以及网络、剪贴板、文件、数据和通知等授权是否符合小程序用途。

<figure><img src="../../../assets/c6d6fce45e39a96b639f24ee.webp" alt="本地小程序详情中的默认模型和快速模型设置"><figcaption><p>在小程序详情中管理 AI 模型槽位。</p></figcaption></figure>

1. 【默认模型】处理小程序的主要 AI 请求，留空时跟随全局默认模型。
2. 【快速模型】处理小程序指定的低延迟请求，留空时跟随全局快速模型。

{% hint style="info" %}
小程序的实际界面和输出由小程序本身决定；上图使用官方能力测试示例说明安装后的权限与模型管理位置。
{% endhint %}

## 配置说明

| 配置项 | 产品默认值 | 建议起点 | 作用 | 适用场景 | 注意事项 |
| ----- | --------------------- | ------------------------ | ----------------------- | -------------- | ----------------------- |
| 安装来源 | — | 首次测试使用本地 `.miniapp` 文件 | 决定从本地包还是 HTTPS 网址安装 | 自用测试、团队分发 | 第三方小程序先核对发布者、源码和权限 |
| AI 权限 | 由小程序声明；可选权限安装时默认勾选 | 只授予完成功能必需的权限 | 允许调用 `cherry.ai.chat()` | 所有 AI 功能 | 必需权限不能单独撤销；不再信任时应卸载 |
| 默认模型 | 跟随全局默认模型 | 使用你已验证可用的对话模型 | 处理主要生成与分析任务 | 长文、复杂指令、结构化输出 | 调用会计入对应模型服务的用量 |
| 快速模型 | 跟随全局快速模型 | 为短任务选择响应更快的模型 | 处理低延迟任务 | 改标题、补全、分类、提取标签 | 小程序必须明确选择 `quick` 才会使用 |
| 推理模式 | 小程序不传时为关闭 | 普通改写先关闭 | 允许支持推理的模型先进行推理 | 复杂分析、规划 | 不支持切换的模型会忽略此项 |
| 主题样式 | 跟随 Cherry Studio 明暗主题 | 引用 `/__cherry/theme.css` | 使用宿主提供的颜色变量 | 所有自定义界面 | 外部 CDN 资源会被沙盒阻止，应打包到应用内 |

### 还能调用哪些能力

| 能力 | 用途 | 声明方式 |
| --------------------- | ----------------------- | ---------------------------------- |
| `cherry.storage` | 保存字符串形式的设置和状态 | `storage.*` 或具体方法 |
| `cherry.file` | 在小程序自己的沙盒中保存、读取和导出文件 | `file.*` 或具体方法 |
| `cherry.notification` | 通过 Cherry Studio 发送系统通知 | `notification.show` |
| `cherry.network` | 访问清单中声明的 HTTPS 域名 | `network.fetch`，并填写 `network` 域名列表 |
| `cherry.clipboard` | 在小程序可见且获得键盘焦点时读写纯文本 | `clipboard.read`、`clipboard.write` |
| `cherry.app` | 读取应用版本、语言和当前权限 | 无需声明 |

本地小程序不能直接使用 `localStorage`、浏览器 `fetch`、Cookie、弹窗或外部 CDN。需要保存状态时使用 `cherry.storage`，需要联网时使用 `cherry.network.fetch` 并在清单中声明允许的域名。

## 用户案例

| 场景 | 输入 | 小程序怎么做 | 完成标志 |
| ------- | ----------- | ------------------------- | -------------- |
| 写作与改写 | 草稿、语气和字数要求 | 用【默认模型】生成正文，用【快速模型】给出标题备选 | 能保留原意并快速切换不同表达 |
| 会议纪要整理 | 粘贴的会议记录 | 提取结论、负责人和截止时间，按固定版式输出 | 每项行动都有负责人和时间字段 |
| 多语言翻译 | 原文、目标语言和术语表 | 在系统消息中固定术语和输出格式，流式显示译文 | 专有名词一致，段落结构保留 |
| 结构化信息提取 | 合同、简历或反馈文本 | 要求模型按固定字段返回结果，再由页面校验缺失项 | 必填字段完整，异常内容被标出 |
| 学习练习 | 笔记、题型和难度 | 生成题目、提示与讲解，并用沙盒数据保存进度 | 重新打开后仍能继续上次练习 |
| 垂直工作流 | 团队模板和业务规则 | 把输入、AI 处理、人工确认和导出组合在一个界面 | 重复任务能按同一流程稳定完成 |

{% hint style="warning" %}
生成式小程序的结果仍由所选模型生成。医疗、法律、财务等高风险用途，以及会影响正式业务的数据，必须由具备相应资格的人复核。
{% endhint %}

## 常见问题

<details>

<summary>为什么我填写了一个网页 URL，却不能调用 Cherry AI？</summary>

【网站】只负责打开网页，不会向网页注入 `window.cherry`。请把应用制作成 `.miniapp` 包，并从【本地小程序】安装。

</details>

<details>

<summary>小程序能看到我的 API Key 或模型服务商吗？</summary>

不能。小程序只请求【默认模型】或【快速模型】槽位。Cherry Studio 代为执行调用，不会把模型名称、服务商信息或 API Key 暴露给小程序。

</details>

<details>

<summary>为什么安装后提示 AI 不可用？</summary>

先打开【查看详情】→【设置】，确认对应模型槽位有可用模型；再到【权限】确认【AI 能力】→【对话】已授权。若权限属于必需权限但你不再信任该应用，请直接卸载。

</details>

<details>

<summary>怎样确认小程序调用了哪些能力？</summary>

打开【查看详情】→【活动日志】。这里会记录 AI、网络、剪贴板、文件导出等对外调用及被拒绝的调用，但不会记录提示词、模型回复、剪贴板内容或文件内容。

</details>

<details>

<summary>更新、回滚和清除数据有什么区别？</summary>

更新会保留沙盒数据，并在新增权限时再次请求确认；更新后可回滚到上一个版本。清除数据会删除该小程序保存的数据和文件，但保留应用；卸载会同时删除应用、授权和数据。

</details>

## 参考资料

* [Cherry Studio MiniApps 开发文档与社区列表](https://github.com/CherryHQ/cherry-studio-miniapps/blob/main/README.zh-CN.md)
* [MiniApp 官方参考文档](https://github.com/CherryHQ/cherry-studio/tree/main/docs/references/mini-app)
* [清单格式](https://github.com/CherryHQ/cherry-studio/blob/main/docs/references/mini-app/manifest.md)
* [能力接口](https://github.com/CherryHQ/cherry-studio/blob/main/docs/references/mini-app/capabilities.md)
* [打包、更新与卸载](https://github.com/CherryHQ/cherry-studio/blob/main/docs/references/mini-app/packaging.md)
