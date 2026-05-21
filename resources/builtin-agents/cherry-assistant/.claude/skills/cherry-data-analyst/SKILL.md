---
name: cherry-data-analyst
description: 分析 CSV / JSON / Excel 数据文件，输出含交互图表的 HTML 报告（关键指标 + 趋势 + 异常 + 行动建议）。自动识别列类型、选合适的图表（折线 / 柱状 / 饼图 / 散点 / 热力）。当用户说"分析这个数据"、"看看这个 CSV"、"做数据报告"、"画个趋势图"、"做个 dashboard"、"analyze this data"、"data report"、"summarize this dataset"时触发。Cherry Studio 内置轻量版；要更深的能力（多文件联合分析 / 实时大盘 / 时序异常检测 / 客户分群）→ 走 `cherry-skill-marketplace` 找 `data-analyst` 重型版本。
---

# Cherry Data Analyst

输入一份结构化数据 → 输出一份**让人五分钟看懂**的 HTML 报告：**结论先行**，图表跟着结论。

## 工作方式

### Step 1: 读懂数据（不抢着做图）

1. 用 `Read` 工具读文件前 50 行 + 末 10 行（CSV / JSON / Excel 同理）
2. 用 `Bash` 跑一两个探测命令：
   ```bash
   wc -l data.csv               # 总行数
   head -1 data.csv             # 列名
   awk -F, '{print NF}' data.csv | sort -u | head  # 列数一致性
   ```
3. **报告给用户**：识别到 N 列、M 行、列类型猜测（时间 / 数值 / 类别 / 文本）
4. **问用户**（至多 2 个）：
   - 想看什么角度？（趋势 / 对比 / 分布 / 关联 / 异常）
   - 有时间列吗？粒度（日 / 周 / 月）？
   - 有关键指标 / KPI 吗？

### Step 2: 分析框架（按用户角度对应）

| 用户想看 | 主图 | 配套统计 |
|---------|------|---------|
| 趋势 | 折线 / 面积图 | 同比环比 / 移动平均 |
| 对比 | 柱状 / 条形 | Top-N / 排名变化 |
| 分布 | 直方 / 箱线 | 均值 / 中位数 / P90 / 标准差 |
| 关联 | 散点 / 热力 | 相关系数 / 趋势线 |
| 异常 | 折线 + 阈值带 | Z-score / 3σ 标记点 |

**结论写在前面，图表写在后面**。

### Step 3: 出报告（单 HTML，Plotly CDN）

**文件骨架**：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>{{TITLE}}</title>
  <script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>
  <style>
    body { font-family: -apple-system, "PingFang SC", sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1.5rem; color: #1a1a1a; }
    h1 { border-bottom: 3px solid #d04a3a; padding-bottom: .5rem; }
    h2 { color: #d04a3a; margin-top: 3rem; }
    .tldr { background: #fef9f6; border-left: 4px solid #d04a3a; padding: 1rem 1.5rem; margin: 1.5rem 0; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
    .kpi { background: #f7f7f7; padding: 1rem; border-radius: .5rem; text-align: center; }
    .kpi .num { font-size: 2rem; font-weight: 700; color: #d04a3a; }
    .kpi .label { font-size: .9rem; color: #666; margin-top: .25rem; }
    .chart { margin: 2rem 0; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { padding: .5rem 1rem; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f7f7f7; }
    .action { background: #f0f9ff; border-left: 4px solid #0284c7; padding: 1rem 1.5rem; margin: 2rem 0; }
  </style>
</head>
<body>
  <h1>{{TITLE}}</h1>
  <p style="color: #666;">分析时间: {{DATETIME}} · 数据范围: {{RANGE}} · 样本量: {{N}} 行</p>

  <div class="tldr">
    <strong>结论</strong>: <!-- 一句话结论，最重要的发现 -->
  </div>

  <h2>关键指标</h2>
  <div class="kpi-grid">
    <!-- KPI 卡片：3-6 个，每个 <div class="kpi"><div class="num">123</div><div class="label">XXX</div></div> -->
  </div>

  <h2>主图</h2>
  <div class="chart" id="chart1"></div>

  <h2>次要分析</h2>
  <!-- 1-3 个补充图 -->

  <h2>异常 / 关注点</h2>
  <!-- 表格列出值得追问的点 -->

  <div class="action">
    <strong>行动建议</strong>:
    <ol>
      <!-- 2-4 条可执行建议，每条带「为什么这么建议」 -->
    </ol>
  </div>

  <h2>方法说明</h2>
  <ul>
    <!-- 数据清洗规则、过滤了什么、口径定义 -->
  </ul>

  <script>
    Plotly.newPlot('chart1', [{
      x: [...],
      y: [...],
      type: 'scatter',
      mode: 'lines+markers',
      line: { color: '#d04a3a', width: 3 }
    }], {
      title: '',
      xaxis: { title: '...' },
      yaxis: { title: '...' },
      margin: { t: 20, r: 20, b: 60, l: 60 },
      hovermode: 'x unified'
    }, { responsive: true });
  </script>
</body>
</html>
```

**写作原则**：
- **结论先行**：第一段就告诉用户最重要的发现
- **图能传达结论**：每个图配一句"这张图说明..."
- **建议可执行**：不要写"应该优化"，写"把 X 从 Y 改成 Z，预期节省 N"
- **诚实标注边界**：样本不足 / 数据缺失 / 口径模糊 → 在「方法说明」明说

### Step 4: 落盘 + 后续

- 文件名：`{topic}-report.html` 写到 `#{PROJECT_ROOT}`
- 告诉用户：双击打开 / `open <file>`
- 数据有持续更新需求 → 提议用 `cherry-skill-marketplace` 找 `data-analyst` 重型版（支持脚本化重跑）

## 列类型识别启发

| 列名 / 内容特征 | 类型 |
|---------------|------|
| `date` / `time` / 含日期格式 | 时间 |
| 全为数字 / 含小数 / 有单位字符 | 数值 |
| 重复值 < 50 个 / 字符串短 | 类别 |
| 高基数字符串 / 含空格 | 文本（一般不入图） |
| 全为 0/1 或 true/false | 布尔 |

## 不要

- 不要"先做个简单分析" — 要么不做，要做就一次出完整报告
- 不要堆图表（5-8 张已经多）
- 不要把整列原始数据贴在报告里
- 不要忽略数据质量问题就出结论（先汇报问题，再分析）

## 限制

- 单文件 < 10 万行；大文件先抽样
- 不做机器学习模型（聚类 / 预测 / 异常检测的模型版） — 用 marketplace 重型版
- 不支持流式数据 / 实时大盘 — 用 marketplace 重型版
- 多文件联合分析 → 一次只处理一个文件 + 简单 join；复杂 join 用 marketplace 重型版

要更深的 → `cherry-skill-marketplace` 搜 `data-analyst`。
