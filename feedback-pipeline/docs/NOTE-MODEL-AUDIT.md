### 模型 id 事故与 model= 记录回核（补记，2026-11-27 23:15）
① 空派根因：`--model bigmodel-cn/glm-5.4` → `Error: Model "bigmodel-cn/glm-5.4" not found`，rc=1，两单各约 1 秒结束，pi 未开工。
② 本机可用模型（`pi --list-models` 实测三行）：`zhipu-cn glm-5.3`、`zhipu-cn glm-5.3-flash`、`zhipu-cn glm-5.4`。
③ 命名空间依据（**已更正为跨机不一致**）：本机 `~/.pi/agent/models.json` 1335 B / mtime 2026-11-25 19:36 → provider 只有 `zhipu-cn`（`bigmodel-cn` 出现 0 次）；维护者机 cherryai002 同文件 1392 B / Nov 26 10:28 → provider `bigmodel-cn`（glm-5.3 / glm-5.4 / glm-5.3-flash）。
   → 两台机器各自只有一种 provider 命名，且互不相同；**不存在迁移，存在跨机不一致**。缺陷在派发模板写死 provider 前缀，换台必失败。
   规则：① 模板一律写 `pi --model <provider>/<id>`，`<provider>` 由 `pi --list-models` 首列当场取出并写入 brief 头部；② 文档出现具体 model 标识必须标注“以该机 --list-models 为准”；③ 任何 `Model ... not found` → 先跑 `--list-models`，不再猜。
④ 既有 model= 回核（只认 `[pi-run] model=` 原值；扫 cache/scratch、codex-tasks、candidates，深度≤3）：
   - `model=zhipu-cn/*` 11 条（含 p0b 正控、p0c-7 例外单）→ 保留
   - `model=glm-5.4` 无 provider 前缀 35 条（u2.0–u2.3 门禁小单）→ UNVERIFIED(provider)
   - `model=unknown` 5 条（含 hs-clues-u1 外部编排）→ UNVERIFIED(provider)
   - `model=bigmodel-cn/*` 成功记录 0 条；两次空派 stderr 已被重派覆盖，凭会话回执留证
⑤ 派发前五检（今后每份 brief 头五行固定写，缺一不派）：
   1) python3 自检可执行  2) 派发前被改件 sha256 原值  3) 白名单路径清单
   4) 超时实现自检 `perl -e 'alarm shift; exec @ARGV' <秒> true` rc=0（本机无 timeout）
   5) 模型 id 预检 `pi --list-models` 必须含所选 model，否则 MODEL_NOT_FOUND 不派发
⑥ R12/R13 重派 `--model zhipu-cn/glm-5.4`，23:12:14 / 23:12:17 起，live_pi=1→2，out.log 已出 DISPATCH_OK；不 kill。
⑦ 外部编排 23:12:09 `task=hs-clues-u1 dispatcher=wecom-cs-hindsight` 在 marker 清除后 1 分钟内进入，属 MAX_SLOTS=3 正常竞争，按指示不 kill；观察 30 分钟，若 live_pi 长期=3 且 R12/R13 排不上再升级。
