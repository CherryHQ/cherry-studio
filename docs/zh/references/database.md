# 数据库参考文档

本文档介绍 Cherry Studio 的数据库结构，包括设置字段和翻译语言表。

---

## 设置字段 (settings)

此部分包含设置相关字段的数据类型说明。

### 翻译相关字段

| 字段名                         | 类型                           | 说明         |
| ------------------------------ | ------------------------------ | ------------ |
| `translate:target:language`    | `LanguageCode`                 | 翻译目标语言 |
| `translate:source:language`    | `LanguageCode`                 | 翻译源语言   |
| `translate:bidirectional:pair` | `[LanguageCode, LanguageCode]` | 双向翻译对   |

---

## 翻译语言表 (translate_languages)

`translate_languages` 记录用户自定义的的语言类型（`Language`）。

### 字段说明

| 字段名     | 类型   | 是否主键 | 索引 | 说明                                                                     |
| ---------- | ------ | -------- | ---- | ------------------------------------------------------------------------ |
| `id`       | string | ✅ 是    | ✅   | 唯一标识符，主键                                                         |
| `langCode` | string | ❌ 否    | ✅   | 语言代码（如：`zh-cn`, `en-us`, `ja-jp` 等，均为小写），支持普通索引查询 |
| `value`    | string | ❌ 否    | ❌   | 语言的名称，用户输入                                                     |
| `emoji`    | string | ❌ 否    | ❌   | 语言的emoji，用户输入                                                    |

> `langCode` 虽非主键，但在业务层应当避免重复插入相同语言代码。
