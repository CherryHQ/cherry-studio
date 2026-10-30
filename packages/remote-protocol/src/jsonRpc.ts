import * as z from 'zod'

const rpcId = z.union([z.string().max(256), z.number().finite(), z.null()])
const envelope = {
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1).max(128),
  params: z.union([z.record(z.string(), z.json()), z.array(z.json())]).optional()
}
export const jsonRpcRequestSchema = z.strictObject({ ...envelope, id: rpcId })
export const jsonRpcNotificationSchema = z.strictObject(envelope)
export const jsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional()
})
export const jsonRpcResponseSchema = z.union([
  z.strictObject({ jsonrpc: z.literal('2.0'), id: rpcId, result: z.json() }),
  z.strictObject({ jsonrpc: z.literal('2.0'), id: rpcId, error: jsonRpcErrorSchema })
])
export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>
export type JsonRpcNotification = z.infer<typeof jsonRpcNotificationSchema>
export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>
export type JsonRpcError = z.infer<typeof jsonRpcErrorSchema>
