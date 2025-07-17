// // 可能会废弃，在流上做delay还是有问题

// import { definePlugin } from '@cherrystudio/ai-core'

// const chunkingRegex = /([\u4E00-\u9FFF])|\S+\s+/
// const delayInMs = 50

// export default definePlugin({
//   name: 'reasoningPlugin',

//   transformStream: () => () => {
//     // === smoothing 状态 ===
//     let buffer = ''

//     // === 时间跟踪状态 ===
//     let thinkingStartTime = performance.now()
//     let hasStartedThinking = false
//     let accumulatedThinkingContent = ''

//     // === 日志计数器 ===
//     let chunkCount = 0
//     let delayCount = 0

//     const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

//     // 收集所有当前可匹配的chunks
//     const collectMatches = (inputBuffer: string) => {
//       const matches: string[] = []
//       let tempBuffer = inputBuffer
//       let match

//       // 重置regex状态
//       chunkingRegex.lastIndex = 0

//       while ((match = chunkingRegex.exec(tempBuffer)) !== null) {
//         matches.push(match[0])
//         tempBuffer = tempBuffer.slice(match.index + match[0].length)
//         // 重置regex以从头开始匹配剩余内容
//         chunkingRegex.lastIndex = 0
//       }

//       return {
//         matches,
//         remaining: tempBuffer
//       }
//     }

//     return new TransformStream({
//       async transform(chunk, controller) {
//         if (chunk.type !== 'reasoning') {
//           // === 处理 reasoning 结束  ===
//           if (hasStartedThinking && accumulatedThinkingContent) {
//             console.log(
//               `[ReasoningPlugin] Ending reasoning. Final stats: chunks=${chunkCount}, delays=${delayCount}, efficiency=${(chunkCount / Math.max(delayCount, 1)).toFixed(2)}x`
//             )

//             // 先输出剩余的 buffer
//             if (buffer.length > 0) {
//               console.log(`[ReasoningPlugin] Flushing remaining buffer: "${buffer}"`)
//               controller.enqueue({
//                 type: 'reasoning',
//                 textDelta: buffer,
//                 thinking_millsec: performance.now() - thinkingStartTime
//               })
//               buffer = ''
//             }

//             // 生成 reasoning-signature
//             controller.enqueue({
//               type: 'reasoning-signature',
//               text: accumulatedThinkingContent,
//               thinking_millsec: performance.now() - thinkingStartTime
//             })

//             // 重置状态
//             accumulatedThinkingContent = ''
//             hasStartedThinking = false
//             thinkingStartTime = 0
//             chunkCount = 0
//             delayCount = 0
//           }

//           controller.enqueue(chunk)
//           return
//         }

//         // === 处理 reasoning 类型 ===

//         // 1. 时间跟踪逻辑
//         if (!hasStartedThinking) {
//           hasStartedThinking = true
//           thinkingStartTime = performance.now()
//           console.log(`[ReasoningPlugin] Starting reasoning session`)
//         }
//         accumulatedThinkingContent += chunk.textDelta

//         // 2. 动态Smooth处理逻辑
//         const beforeBuffer = buffer
//         buffer += chunk.textDelta

//         console.log(`[ReasoningPlugin] Received chunk: "${chunk.textDelta}", buffer: "${beforeBuffer}" → "${buffer}"`)

//         // 收集所有当前可以匹配的chunks
//         const { matches, remaining } = collectMatches(buffer)

//         if (matches.length > 0) {
//           console.log(
//             `[ReasoningPlugin] Collected ${matches.length} matches: [${matches.map((m) => `"${m}"`).join(', ')}], remaining: "${remaining}"`
//           )

//           // 批量输出所有匹配的chunks
//           for (const matchText of matches) {
//             controller.enqueue({
//               type: 'reasoning',
//               textDelta: matchText,
//               thinking_millsec: performance.now() - thinkingStartTime
//             })
//             chunkCount++
//           }

//           // 更新buffer为剩余内容
//           buffer = remaining

//           // 只等待一次，而不是每个chunk都等待
//           delayCount++
//           console.log(
//             `[ReasoningPlugin] Delaying ${delayInMs}ms (delay #${delayCount}, efficiency: ${(chunkCount / delayCount).toFixed(2)} chunks/delay)`
//           )
//           const delayStart = performance.now()
//           await delay(delayInMs)
//           const actualDelay = performance.now() - delayStart
//           console.log(`[ReasoningPlugin] Delay completed: expected=${delayInMs}ms, actual=${actualDelay.toFixed(1)}ms`)
//         } else {
//           console.log(`[ReasoningPlugin] No matches found, keeping in buffer: "${buffer}"`)
//         }
//         // 如果没有匹配，保留在buffer中等待下次数据
//       },

//       // === flush 处理剩余 buffer ===
//       flush(controller) {
//         if (buffer.length > 0) {
//           console.log(`[ReasoningPlugin] Final flush: "${buffer}"`)
//           controller.enqueue({
//             type: 'reasoning',
//             textDelta: buffer,
//             thinking_millsec: hasStartedThinking ? performance.now() - thinkingStartTime : 0
//           })
//         }
//       }
//     })
//   }
// })
