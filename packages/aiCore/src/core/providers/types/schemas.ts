/**
 * Provider ID Schema
 */

import * as z from 'zod'

/**
 * Provider ID Schema
 * 通过 module augmentation 扩展的类型安全 ID
 */
export const providerIdSchema = z.string().min(1)

/**
 * Provider ID 类型 - 基于 zod schema 推导
 */
export type ProviderId = z.infer<typeof providerIdSchema>
