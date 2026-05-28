---
name: cherry-web-ppt
description: 生成单文件 HTML 网页 PPT — 左右滑动翻页 + 封面 / 章节 / 数据 / 正文 / 引用模板。一次写出可直接用浏览器打开的演示文稿。当用户说"做个 PPT"、"做演示文稿"、"做分享文档"、"生成幻灯片"、"做个 keynote"、"create a deck"、"make slides"、"design a presentation"、"做个发布会页"时触发。Cherry Studio 内置轻量版；要更精致的「电子杂志」/「电子墨水」风格 → 走 `cherry-skill-marketplace` 找 `magazine-web-ppt`。
---

# Cherry Web PPT

输出**一个 HTML 文件**，浏览器打开就是 PPT，支持键盘 ← → 翻页、移动端左右滑动、自动响应式。**不依赖任何后端 / CDN，可离线打开。**

## 工作方式

### Step 1: 三问

| 问 | 默认 |
|----|------|
| 主题 + 主要受众？ | 必填 |
| 大致几页？多少分钟讲？ | 默认 8-12 页 |
| 风格倾向？ | 默认「极简专业」(白底 + 单一品牌色) |

风格可选：极简专业 / 杂志风（衬线 + 大图） / 暗黑科技 / 暖色生活 / 极客极简（等宽字体）。

### Step 2: 大纲先行

按 7 段法或 3 幕法给大纲，让用户确认或调整：

**7 段法**（适合产品发布 / 项目汇报）：
1. 开场（封面 + 一句话主张）
2. 现状（问题 / 痛点 / 数据）
3. 转折（变化 / 机会）
4. 方案（我们的解）
5. 证据（demo / 案例 / 数据）
6. 路线图（未来 12 个月）
7. 收尾（CTA + Q&A）

**3 幕法**（适合演讲 / 分享）：
1. 是什么（设定）
2. 为什么（冲突）
3. 怎么办（解决 + 启示）

### Step 3: 出 HTML

**目标**：一个文件、可离线打开、无依赖。

**核心模板**（往这个骨架里塞内容，**不要每次现写 CSS**）：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{{TITLE}}</title>
  <style>
    :root {
      --brand: #d04a3a;             /* 品牌色，按风格换 */
      --bg: #ffffff;
      --fg: #1a1a1a;
      --muted: #888;
      --serif: "Source Han Serif", Georgia, serif;
      --sans: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--fg); font-family: var(--sans); }
    .deck { display: flex; height: 100vh; transition: transform .4s cubic-bezier(.2,.8,.2,1); }
    .slide { flex: 0 0 100vw; height: 100vh; padding: 8vh 10vw; display: flex; flex-direction: column; justify-content: center; }
    .slide h1 { font-family: var(--serif); font-size: clamp(2.5rem, 6vw, 5rem); line-height: 1.15; margin-bottom: 1rem; }
    .slide h2 { font-size: clamp(1.5rem, 3vw, 2.5rem); margin-bottom: 1.5rem; color: var(--brand); }
    .slide p { font-size: clamp(1rem, 1.5vw, 1.3rem); line-height: 1.7; max-width: 70ch; color: #333; }
    .slide ul { font-size: clamp(1rem, 1.4vw, 1.2rem); line-height: 2; max-width: 70ch; }
    .cover { background: var(--brand); color: #fff; }
    .cover h1 { color: #fff; }
    .cover .meta { margin-top: 2rem; opacity: .8; font-family: var(--serif); }
    .chapter { background: var(--fg); color: var(--bg); justify-content: center; align-items: center; text-align: center; }
    .chapter h1 { font-size: clamp(4rem, 10vw, 8rem); }
    .stat { text-align: center; }
    .stat .num { font-family: var(--serif); font-size: clamp(5rem, 14vw, 12rem); color: var(--brand); line-height: 1; }
    .stat .label { font-size: 1.2rem; color: var(--muted); margin-top: 1rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center; }
    .progress { position: fixed; bottom: 2vh; left: 0; right: 0; text-align: center; font-size: .8rem; color: var(--muted); }
    .nav-hint { position: fixed; top: 2vh; right: 2vh; font-size: .8rem; color: var(--muted); }
  </style>
</head>
<body>
  <div class="deck" id="deck">
    <!-- SLIDES_GO_HERE -->
  </div>
  <div class="progress" id="progress"></div>
  <div class="nav-hint">← → 翻页</div>
  <script>
    const deck = document.getElementById('deck');
    const progress = document.getElementById('progress');
    let idx = 0;
    const total = deck.children.length;
    function go(n) {
      idx = Math.max(0, Math.min(total - 1, n));
      deck.style.transform = `translateX(-${idx * 100}vw)`;
      progress.textContent = `${idx + 1} / ${total}`;
    }
    document.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === ' ') go(idx + 1);
      if (e.key === 'ArrowLeft') go(idx - 1);
    });
    let touchX = 0;
    document.addEventListener('touchstart', e => touchX = e.touches[0].clientX);
    document.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1));
    });
    go(0);
  </script>
</body>
</html>
```

**Slide 模板**（往 `<!-- SLIDES_GO_HERE -->` 处替换）：

```html
<!-- 封面 -->
<section class="slide cover">
  <h1>主标题（不超 12 个字）</h1>
  <p>副标题：一句话讲清楚要说什么</p>
  <div class="meta">演讲人 · 日期 · 场合</div>
</section>

<!-- 章节封 -->
<section class="slide chapter">
  <h1>第一章</h1>
</section>

<!-- 数据大字报 -->
<section class="slide stat">
  <div class="num">63</div>
  <div class="label">支持的 AI Provider</div>
</section>

<!-- 正文页 -->
<section class="slide">
  <h2>这一页要讲的事</h2>
  <p>开宗明义一句话。</p>
  <ul>
    <li>要点一：具体到事</li>
    <li>要点二：带数据</li>
    <li>要点三：可验证</li>
  </ul>
</section>

<!-- 左图右文 -->
<section class="slide">
  <div class="grid">
    <div>
      <h2>标题</h2>
      <p>正文</p>
    </div>
    <div>
      <img src="https://placehold.co/600x400" alt="" style="width:100%;border-radius:.5rem;">
    </div>
  </div>
</section>

<!-- 引用 / Closing -->
<section class="slide chapter">
  <h1>谢谢</h1>
</section>
```

### Step 4: 落盘 + 验证

- 文件名：`{topic}-deck.html`，写到 `#{PROJECT_ROOT}` 或用户指定路径
- 告诉用户：直接双击打开 / `open <file>` 即可
- 用 `mcp__cherry__browser` 工具打开预览给用户确认（如果可用）

## 风格变体

| 风格 | `--brand` | `--bg` / `--fg` | `--serif` 用途 |
|------|-----------|-----------------|---------------|
| 极简专业（默认） | `#d04a3a` | 白底黑字 | 标题 |
| 杂志风 | `#1a1a1a` | 米黄底深色 | 全文 |
| 暗黑科技 | `#00ff88` | 深黑荧光 | 仅数据页 |
| 暖色生活 | `#f4a261` | 米色 | 全文 |
| 极客极简 | `#0066ff` | 白底 | 仅引用 |

## 不要

- 不要堆 emoji（除非用户偏好里要）
- 不要在 PPT 里写整页文字（信息密度 → 拆页）
- 不要用 base64 嵌入大图（>100KB 用 placeholder 占位让用户后续替换）
- 不要做"会自动播放音乐"的彩蛋（用户体验糟糕）

## 限制

- 不导出 PPT/Keynote 二进制文件（要的话用 marketplace 的导出 skill）
- 复杂动画 / 视频嵌入 → 走 `magazine-web-ppt` 等更专业 skill
- 多语言并行 PPT → 自己复制改语言；本 skill 一次出一种语言

要更深的 → `cherry-skill-marketplace` 搜 `magazine-web-ppt`、`slide-deck` 等。
