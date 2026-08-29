import { defineCreator } from './types'

export default defineCreator({
  id: 'iflytek',
  name: 'iFlytek (Spark / Xunfei MaaS)',
  reasoningFamilies: [
    // Xunfei MaaS (讯飞星辰) model IDs omit hyphens and dots, e.g.
    // `xopdeepseekv32`, `xopdeepseekv4pro`, `xopglmv47flash`, `xopkimik26`,
    // `xopqwen35397b`, `xsparkx2`. Map them straight onto the canonical
    // family knob shapes (mirrors `getXunfeiMaaSModelId` in v1):
    // xopdeepseekv32 -> deepseek-v3.2 (hybrid thinking toggle).
    { pattern: '^xopdeepseekv3\\d', toggle: true },
    // xopdeepseekv4pro -> deepseek-v4-pro (effort vocabulary). Anchor to
    // `v[4-9]` so separator-less v2.x ids like `xopdeepseekv21` (v2.1) are not
    // misclassified as v4+ reasoning models.
    { pattern: '^xopdeepseekv[4-9]', effort: ['none', 'high', 'max'] },
    // xopkimik26 -> kimi-k2.6 (thinking toggle for k2.5+ / k3+).
    { pattern: '^xopkimik(?:2[5-9]\\d*|[3-9]\\d*)', toggle: true },
    // xopqwen35397b -> qwen3.5-397b, xopqwen36v35b -> qwen3.6-v35b
    // (budget + thinking toggle for qwen3.5+).
    { pattern: '^xopqwen3[5-9]\\d*', budget: { min: 0, max: 81920 } },
    { pattern: '^xopqwen3[5-9]\\d*', toggle: true },
    // xopglmv47flash -> glm-4.7-flash, xopglm45 -> glm-4.5, xopglm52 -> glm-5.2
    // (thinking toggle for glm-4.5+/5.x).
    { pattern: '^xopglmv?(?:4[5-7]|5\\d*)', toggle: true },
    // xsparkx2 -> spark-x2, xsparkx2flash -> spark-x2-flash (thinking toggle).
    // Narrow to `x2` so xsparkx1 / xsparkx3 etc. are not treated as reasoning.
    { pattern: '^xsparkx2', toggle: true }
  ]
})
