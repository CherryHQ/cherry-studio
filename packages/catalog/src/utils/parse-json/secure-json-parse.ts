// https://github.com/vercel/ai/blob/32d8dbbebdb7831467c702094cc903cf93ee15ef/packages/provider-utils/src/secure-json-parse.ts
// Licensed under BSD-3-Clause (this file only)
// Code adapted from https://github.com/fastify/secure-json-parse/blob/783fcb1b5434709466759847cec974381939673a/index.js
//
// Copyright (c) Vercel, Inc. (https://vercel.com)
// Copyright (c) 2019 The Fastify Team
// Copyright (c) 2019, Sideway Inc, and project contributors
// All rights reserved.
//
// The complete list of contributors can be found at:
// - https://github.com/hapijs/bourne/graphs/contributors
// - https://github.com/fastify/secure-json-parse/graphs/contributors
// - https://github.com/vercel/ai/commits/main/packages/provider-utils/src/secure-parse-json.ts
//
// Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

const suspectProtoRx = /"__proto__"\s*:/
const suspectConstructorRx = /"constructor"\s*:/

function _parse(text: string) {
  // Parse normally
  const obj = JSON.parse(text)

  // Ignore null and non-objects
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (suspectProtoRx.test(text) === false && suspectConstructorRx.test(text) === false) {
    return obj
  }

  // Scan result for proto keys
  return filter(obj)
}

function filter(obj: any) {
  let next = [obj]

  while (next.length) {
    const nodes = next
    next = []

    for (const node of nodes) {
      if (Object.prototype.hasOwnProperty.call(node, '__proto__')) {
        throw new SyntaxError('Object contains forbidden prototype property')
      }

      if (
        Object.prototype.hasOwnProperty.call(node, 'constructor') &&
        Object.prototype.hasOwnProperty.call(node.constructor, 'prototype')
      ) {
        throw new SyntaxError('Object contains forbidden prototype property')
      }

      for (const key in node) {
        const value = node[key]
        if (value && typeof value === 'object') {
          next.push(value)
        }
      }
    }
  }
  return obj
}

export function secureJsonParse(text: string) {
  const { stackTraceLimit } = Error
  try {
    // Performance optimization, see https://github.com/fastify/secure-json-parse/pull/90
    Error.stackTraceLimit = 0
  } catch (e) {
    // Fallback in case Error is immutable (v8 readonly)
    return _parse(text)
  }

  try {
    return _parse(text)
  } finally {
    Error.stackTraceLimit = stackTraceLimit
  }
}
