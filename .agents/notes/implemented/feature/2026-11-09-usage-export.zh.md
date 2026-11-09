# Agent Note: Usage statistics export (PNG and XLSX)

Status: implemented

[English](2026-11-09-usage-export.md) | 中文

## 问题

Settings > Usage 此前分享时只能手动截图，明细只能手抄，无法提供可编辑的结构化用量报表。

## 决策

Settings > Usage 顶部的唯一 Export 菜单提供 PNG 和 XLSX。PNG 捕获当前页面内容，包括已渲染明细及已显示/总数标记，不抓取更多明细。仅捕获时显示的文字包含报告范围和时区。Usage 作用域内的捕获样式展开滚动内容并隐藏导出和分页操作。

XLSX 使用现有 `@e965/xlsx` 写入器，按每页 200 条串行读取所有匹配记录，校验 total、唯一 ID 和 cursor，完整性校验失败时不把部分结果交给保存。固定的 `Usage` sheet 包含 32 个标量列；`Metadata` 包含 11 行有序元信息，记录报告条件、视图、排序、查询、最终记录数和数值规则。未知值留空，0 保留为数值，超过 15 位的整数按文本存储，费用保留原始币种且不换汇。

操作选中时冻结现有时间范围、查询、locale、译文、供应商名称和显示设置。父页读取原有明细排序缓存键，不上移明细查询。进行中标记防止重复操作；revision 和 mounted 检查防止失效或卸载后的工作再弹出保存框或提示。PNG 要求当前聚合和明细数据就绪，最多等待 1500 ms 让图表的懒加载占位消失。图表运行时经 `ImageCaptureEvent` 提供当前 option 已 `finished` 的准备能力，等待上限为 3000 ms，option/尺寸变化及卸载会使准备失效。

## 考虑过的替代方案

- ExcelJS 可以写入 XLSX，但根项目已有 `@e965/xlsx` 和二进制保存模式，无需增加另一套写入器；file-preview 的独立依赖不构成本页引入它的理由。
- 用 jszip 手写 OOXML 会重复维护成熟写入器已有的 XML 转义、关系、单元格类型和文件兼容性职责。
- CSV 不满足可编辑 XLSX、两个工作表和明确单元格类型的交付要求。
- 只截 overview 和 heatmap 会遗漏当前页面已有的分布图和已渲染明细。
- `exportTableToExcel` 接收字符串，构建单个工作表并自行处理文件名和保存。复用它会丢失原始数值类型和独立 Metadata 工作表，或者要求修改本任务之外的共享 API。

## 后果

冻结的是查询，而非数据库事务快照。total/ID/cursor 检查和收到的数据变化通知可以检测部分并发变化，不能保证某一时刻的绝对快照。切换视图控件或热力图指标会使在途操作失效，即使随后切回原值也一样。

保存沿用非原子的既有 IPC 契约。PNG 返回 `false` 时无法区分取消与保存失败，因此显示中性的未保存提示；XLSX 返回 `null` 时静默结束。已经交给 IPC 的保存操作无法撤回。

全量 XLSX 在 renderer 内存中构建，格式上限为 1,048,575 条数据行；尚无容量压测证明实际可用内存上限。大量记录需要多次串行请求，每页都受既有 GET 恢复预算约束。不增加额外重试或隐藏截断。

## 验证

- AC1 — 追加的 renderer 测试通过真实菜单触发 PNG，验证捕获 Usage 根和不含扩展名的保存 stem，并覆盖保存成功、中性 false、保存拒绝、忙态去重、聚合/明细未就绪、周期改变后切回和卸载。 （verification: renderer）
- AC2 — 真实 `@e965/xlsx` 读取器读回实际交给保存的字节：两页合计 201 个 ID 完整、零费用为数值、两个固定 sheet 名及 11 行元信息保留，实际币种与实际渲染图表回退均匹配冻结条件。 （verification: renderer）
- AC3 — `usageExport.test.ts` 的 26 个用例全部通过，覆盖工作簿读回、数值/空值/字符串规则、分页反例和文件名；页面测试还验证第二页失败后不保存，以及取消 XLSX 保存后静默结束。 （verification: unit）
- AC4 — `Echarts.test.tsx` 的 13 个用例通过真实 ECharts 与 `@napi-rs/canvas` 验证准备完成、失效及有界失败；这些测试不能证明 Electron 截图像素结果。 （verification: unit）
- AC5 — 指定的六个 renderer 测试文件 73/73 通过，i18n 闸门跨 catalog 家族校验 102746 条翻译，15 个 renderer locale 各新增 51 个真实译文键。 （verification: renderer）
- AC6 — 构建后的真实 Electron 应用把真实 Usage 页捕获成 PNG：含周期与精确区间/时区、指标卡、热力图、非空分布图、TPS 列与 `Displayed entries: 25 of 120`，导出与 Load more 控件已隐藏；同一次运行产出的 XLSX 由真实 `@e965/xlsx` reader 读回为 `Usage` + `Metadata` 两个表、32 个列头、120 条记录与 11 行元信息。原生保存框由探针处理器替换并交回原始载荷；窄/宽窗口、浅/深主题、真实落盘与外部电子表格编辑仍未验证。 （verification: Electron）
