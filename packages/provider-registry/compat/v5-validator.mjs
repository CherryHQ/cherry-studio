/* eslint-disable */
// AUTO-GENERATED compatibility contract. Never edit or replace this file.
import { readFileSync as e } from 'node:fs'
import t from 'node:path'
import { fileURLToPath as n } from 'node:url'
function r(e) {
  let t = Object.values(e).filter((e) => typeof e == `number`)
  return Object.entries(e)
    .filter(([e, n]) => t.indexOf(+e) === -1)
    .map(([e, t]) => t)
}
function i(e, t = `|`) {
  return e.map((e) => de(e)).join(t)
}
function a(e, t) {
  return typeof t == `bigint` ? t.toString() : t
}
var o = class {
  constructor(e) {
    ;((this._getter = e), (this._value = void 0))
  }
  get value() {
    let e = this._getter
    return (e !== void 0 && ((this._value = e()), (this._getter = void 0)), this._value)
  }
}
function s(e) {
  return new o(e)
}
function c(e) {
  return e == null
}
function l(e) {
  let t = +!!e.startsWith(`^`),
    n = e.endsWith(`$`) ? e.length - 1 : e.length
  return e.slice(t, n)
}
function u(e, t) {
  let n = e / t,
    r = Math.round(n),
    i = 4 * 2 ** -52 * Math.max(Math.abs(n), 1)
  return Math.abs(n - r) < i ? 0 : n - r
}
function d(e, t, n) {
  Object.defineProperty(e, t, { value: n, writable: !0, enumerable: !0, configurable: !0 })
}
function f(e) {
  let t = Object.getOwnPropertyDescriptor(e, `shape`)
  return t?.get ? t.get.raw : t?.value
}
function p(e) {
  return f(e._zod.def) ?? e._zod.def.shape
}
function m(e, t, n) {
  Object.defineProperty(e, t, {
    get() {
      let e = n()
      return (d(this, t, e), e)
    },
    enumerable: !0,
    configurable: !0
  })
}
function ee(e, t, n) {
  t in e ? d(e, t, n) : (e[t] = n)
}
function h(e, t, n, r) {
  let i = p(t)
  for (let a of n) {
    let n = Object.getOwnPropertyDescriptor(i, a)
    n.enumerable &&
      (n.get
        ? m(e, a, () => {
            let e = t._zod.def.shape[a]
            return r ? r(e, a) : e
          })
        : ee(e, a, r ? r(n.value, a) : n.value))
  }
}
function te(e, t) {
  for (let n of Reflect.ownKeys(t)) {
    let r = Object.getOwnPropertyDescriptor(t, n)
    r.enumerable && (r.get ? m(e, n, () => t[n]) : ee(e, n, r.value))
  }
}
function g(...e) {
  let t = {}
  for (let n of e) {
    let e = Object.getOwnPropertyDescriptors(n)
    Object.assign(t, e)
  }
  return Object.defineProperties({}, t)
}
function ne(e) {
  return JSON.stringify(e)
}
function re(e) {
  return e
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, ``)
    .replace(/[\s_-]+/g, `-`)
    .replace(/^-+|-+$/g, ``)
}
const ie = `captureStackTrace` in Error ? Error.captureStackTrace : (...e) => {}
function ae(e) {
  return typeof e == `object` && !!e && !Array.isArray(e)
}
const oe = s(() => {
  if (E.jitless || (typeof navigator < `u` && navigator?.userAgent?.includes(`Cloudflare`))) return !1
  try {
    return (Function(``), !0)
  } catch {
    return !1
  }
})
function se(e) {
  if (ae(e) === !1) return !1
  let t = e.constructor
  if (t === void 0 || typeof t != `function`) return !0
  let n = t.prototype
  return ae(n) !== !1 && Object.prototype.hasOwnProperty.call(n, `isPrototypeOf`) !== !1
}
function ce(e) {
  return se(e)
    ? { ...e }
    : Array.isArray(e)
      ? [...e]
      : e instanceof Map
        ? new Map(e)
        : e instanceof Set
          ? new Set(e)
          : e
}
const le = new Set([`string`, `number`, `symbol`])
function ue(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
}
function _(e, t, n) {
  let r = new e._zod.constr(t ?? e._zod.def)
  return ((!t || n?.parent) && (r._zod.parent = e), r)
}
function v(e) {
  let t = e
  if (!t) return {}
  if (typeof t == `string`) return { error: () => t }
  if (t?.message !== void 0) {
    if (t?.error !== void 0) throw Error('Cannot specify both `message` and `error` params')
    t.error = t.message
  }
  return (delete t.message, typeof t.error == `string` ? { ...t, error: () => t.error } : t)
}
function de(e) {
  return typeof e == `bigint` ? e.toString() + `n` : typeof e == `string` ? `"${e}"` : `${e}`
}
function fe(e) {
  return Object.keys(e).filter((t) => e[t]._zod.optin !== void 0 && e[t]._zod.optout === `optional`)
}
const pe = {
    safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
    int32: [-2147483648, 2147483647],
    uint32: [0, 4294967295],
    float32: [-34028234663852886e22, 34028234663852886e22],
    float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
  },
  me = {
    int64: [BigInt(`-9223372036854775808`), BigInt(`9223372036854775807`)],
    uint64: [BigInt(0), BigInt(`18446744073709551615`)]
  }
function he(e, t) {
  let n = e._zod.def,
    r = n.checks
  if (r && r.length > 0) throw Error(`.pick() cannot be used on object schemas containing refinements`)
  let i = {}
  return (h(i, e, ge(e, t)), _(e, g(n, { shape: i, checks: [] })))
}
function ge(e, t) {
  let n = p(e),
    r = []
  for (let e of Reflect.ownKeys(t)) {
    if (!Object.getOwnPropertyDescriptor(n, e)?.enumerable) throw Error(`Unrecognized key: "${String(e)}"`)
    t[e] && r.push(e)
  }
  return r
}
function _e(e, t) {
  let n = e._zod.def,
    r = n.checks
  if (r && r.length > 0) throw Error(`.omit() cannot be used on object schemas containing refinements`)
  let i = new Set(ge(e, t)),
    a = {}
  return (
    h(
      a,
      e,
      Reflect.ownKeys(p(e)).filter((e) => !i.has(e))
    ),
    _(e, g(n, { shape: a, checks: [] }))
  )
}
function ve(e, t) {
  if (!se(t)) throw Error(`Invalid input to extend: expected a plain object`)
  let n = e._zod.def.checks
  if (n && n.length > 0) {
    let n = p(e)
    for (let e of Reflect.ownKeys(t))
      if (Object.getOwnPropertyDescriptor(n, e) !== void 0)
        throw Error('Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.')
  }
  return _(e, g(e._zod.def, { shape: ye(e, t) }))
}
function ye(e, t) {
  let n = {}
  return (h(n, e, Reflect.ownKeys(p(e))), te(n, t), n)
}
function be(e, t) {
  if (!se(t)) throw Error(`Invalid input to safeExtend: expected a plain object`)
  return _(e, g(e._zod.def, { shape: ye(e, t) }))
}
function xe(e, t) {
  if (!t?._zod?.def)
    throw Error('Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.')
  if (e._zod.def.checks?.length)
    throw Error(`.merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.`)
  let n = {}
  return (
    h(n, e, Reflect.ownKeys(p(e))),
    h(n, t, Reflect.ownKeys(p(t))),
    _(
      e,
      g(e._zod.def, {
        shape: n,
        get catchall() {
          return t._zod.def.catchall
        },
        checks: t._zod.def.checks ?? []
      })
    )
  )
}
function Se(e, t, n, r = `partial`) {
  let i = t._zod.def.checks
  if (i && i.length > 0) throw Error(`.${r}() cannot be used on object schemas containing refinements`)
  let a = n ? new Set(ge(t, n)) : void 0,
    o = {}
  return (
    h(o, t, Reflect.ownKeys(p(t)), e && ((t, n) => (a && !a.has(n) ? t : new e({ type: `optional`, innerType: t })))),
    _(t, g(t._zod.def, { shape: o, checks: [] }))
  )
}
function Ce(e, t, n) {
  let r = n ? new Set(ge(t, n)) : void 0,
    i = {}
  return (
    h(i, t, Reflect.ownKeys(p(t)), (t, n) => (r && !r.has(n) ? t : new e({ type: `nonoptional`, innerType: t }))),
    _(t, g(t._zod.def, { shape: i }))
  )
}
function y(e, t = 0) {
  if (e.aborted === !0) return !0
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0
  return !1
}
function we(e, t = 0) {
  if (e.aborted === !0) return !0
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0
  return !1
}
function b(e, t) {
  return t.map((t) => {
    var n
    return ((n = t).path ?? (n.path = []), t.path.unshift(e), t)
  })
}
function Te(e) {
  return typeof e == `string` ? e : e?.message
}
function Ee(e) {
  let t = []
  for (let n of e ?? []) {
    let e = n._zod.def
    if (!/_(length|size)$|_equals$/.test(e.check)) break
    let r = e.maximum ?? e.length ?? e.size
    r >= 0 && t.push([r, n])
  }
  return t
}
function De(e, t, n) {
  var r
  for (let i = t; i < e.length; i++) (r = e[i]).schema ?? (r.schema = n)
}
function x(e, t, n) {
  var r
  let i = e.inst?._zod?.traits
  i?.has(`$ZodType`) && (i.has(`$ZodCheck`) ? ((r = e).schema ?? (r.schema = e.inst)) : (e.schema = e.inst))
  let a = e.schema === e.inst ? void 0 : e.schema?._zod.def?.error,
    o = e.message
      ? e.message
      : (Te(e.inst?._zod.def?.error?.(e)) ??
        Te(a?.(e)) ??
        Te(t?.error?.(e)) ??
        Te(n.customError?.(e)) ??
        Te(n.localeError?.(e)) ??
        `Invalid input`),
    s = {}
  for (let t of Object.keys(e))
    t !== `inst` && t !== `schema` && t !== `continue` && t !== `input` && t !== `__proto__` && (s[t] = e[t])
  return ((s.path ??= []), (s.message = o), t?.reportInput && (s.input = e.input), s)
}
const Oe = /[\uD800-\uDBFF]/
function ke(e) {
  let t = e.length
  if (!Oe.test(e)) return t
  let n = t
  for (let r = 0; r < t - 1; r++)
    (e.charCodeAt(r) & 64512) == 55296 && (e.charCodeAt(r + 1) & 64512) == 56320 && (n--, r++)
  return n
}
function Ae(e) {
  return Array.isArray(e) ? `array` : typeof e == `string` ? `string` : `unknown`
}
function je(e) {
  let t = typeof e
  switch (t) {
    case `number`:
      return Number.isNaN(e) ? `nan` : `number`
    case `object`: {
      if (e === null) return `null`
      if (Array.isArray(e)) return `array`
      let t = e
      if (t && Object.getPrototypeOf(t) !== Object.prototype && `constructor` in t && t.constructor)
        return t.constructor.name
    }
  }
  return t
}
function Me(...e) {
  let [t, n, r] = e
  return typeof t == `string` ? { message: t, code: `custom`, input: n, inst: r } : { ...t }
}
function Ne(e, t) {
  for (let n in t) {
    let r = Object.getOwnPropertyDescriptor(t, n)
    r.get ? Object.defineProperty(e, n, { ...r, enumerable: !1 }) : Ie(e, n, r.value)
  }
}
function S(e, t, n, r = !0) {
  return (Object.defineProperty(e, t, { configurable: !0, writable: !0, enumerable: r, value: n }), n)
}
function Pe(e, t, n) {
  return S(e, t, n, !1)
}
function Fe(e, t) {
  for (let n in e) {
    let r = e[n]
    Object.defineProperty(t, n, {
      configurable: !0,
      enumerable: !0,
      get() {
        return S(this, n, r(this))
      },
      set(e) {
        S(this, n, e)
      }
    })
  }
  return t
}
function Ie(e, t, n) {
  Object.defineProperty(e, t, {
    configurable: !0,
    get() {
      return this == null ? n : S(this, t, n.bind(this))
    },
    set(e) {
      S(this, t, e)
    }
  })
}
function Le(e, t) {
  let n = Object.getPrototypeOf(e)
  return t in n ? void 0 : n
}
let Re,
  ze = !1
const Be = {
  configurable: !0,
  get() {
    ze = !0
  }
}
function C(e, t, n) {
  let r = Object.getPrototypeOf(e._zod)
  if (t in r && Re !== e._zod) {
    Re = void 0
    return
  }
  ;((Re = e._zod),
    Object.defineProperty(r, t, {
      configurable: !0,
      get() {
        Object.defineProperty(this, t, Be)
        let e = ze
        ze = !1
        try {
          let r = n(this)
          return (
            ze ? delete this[t] : Object.defineProperty(this, t, { configurable: !0, writable: !0, value: r }),
            (ze ||= e),
            r
          )
        } catch (n) {
          throw (delete this[t], (ze ||= e), n)
        }
      },
      set(e) {
        Object.defineProperty(this, t, { configurable: !0, writable: !0, value: e })
      }
    }))
}
function Ve(e, t, n, r) {
  let i = Le(e, t)
  i &&
    Object.defineProperty(i, t, {
      configurable: !0,
      get() {
        let e = { configurable: !0, writable: !0, enumerable: r, value: void 0 }
        return (Object.defineProperty(this, t, e), (e.value = n(this)), Object.defineProperty(this, t, e), e.value)
      },
      set(e) {
        Object.defineProperty(this, t, { configurable: !0, writable: !0, enumerable: r, value: e })
      }
    })
}
function He(e) {
  let t = () => e
  return ((t[`~constantCatch`] = !0), t)
}
var Ue
const We = { value: void 0, enumerable: !1 }
let Ge = `captureStackTrace` in Error ? Error : null
function Ke(e) {
  let t = Ge
  if (t) {
    let n = t.stackTraceLimit
    if (typeof n == `number`) {
      try {
        t.stackTraceLimit = 0
      } catch {
        return ((Ge = null), new e())
      }
      try {
        return new e()
      } finally {
        t.stackTraceLimit = n
      }
    }
  }
  return new e()
}
function w(e, t, n, r) {
  let i = {}
  function a(e) {
    ;((this.def = e), (this.constr = d), (this.traits = new Set()))
  }
  a.prototype = i
  let o = n,
    s = o && new WeakSet()
  function c(n, r) {
    if (!n._zod) {
      We.value = new a(r)
      try {
        Object.defineProperty(n, '_zod', We)
      } finally {
        We.value = void 0
      }
    } else if (n._zod.traits.has(e)) return
    if ((n._zod.traits.add(e), t(n, r), s)) {
      let e = Object.getPrototypeOf(n),
        t = n._zod.constr.prototype,
        r = e
      for (; r && r !== t;) r = Object.getPrototypeOf(r)
      let i = r ?? e
      s.has(i) || (s.add(i), Ne(i, o))
    }
    let i = d.prototype
    for (let e in i) Object.prototype.hasOwnProperty.call(i, e) && (e in n || (n[e] = i[e].bind(n)))
  }
  let l = r?.Parent ?? Object
  class u extends l {}
  Object.defineProperty(u, 'name', { value: e })
  function d(e) {
    let t = r?.Parent ? Ke(u) : this
    c(t, e)
    let n = t._zod.deferred
    if (n) {
      for (let e of n) e()
      t._zod.deferred = void 0
    }
    let i = globalThis.__zod_globalConfig?.postProcessor
    return (i && i(t), t)
  }
  return (
    Object.defineProperty(d, 'init', { value: c }),
    Object.defineProperty(d, Symbol.hasInstance, {
      value: (t) => (r?.Parent && t instanceof r.Parent ? !0 : t?._zod?.traits?.has(e))
    }),
    Object.defineProperty(d, 'name', { value: e }),
    d
  )
}
var T = class extends Error {
    constructor() {
      super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`)
    }
  },
  qe = class extends Error {
    constructor(e) {
      ;(super(`Encountered unidirectional transform during encode: ${e}`), (this.name = `ZodEncodeError`))
    }
  }
;(Ue = globalThis).__zod_globalConfig ?? (Ue.__zod_globalConfig = {})
const E = globalThis.__zod_globalConfig
function D(e) {
  return (e && Object.assign(E, e), E)
}
function Je() {
  let e = this._zod
  return ((e.message ??= JSON.stringify(e.def, a, 2)), e.message)
}
function Ye(e) {
  this._zod.message = e
}
const Xe = { get: Je, set: Ye, enumerable: !0, configurable: !0 },
  Ze = { value: void 0, enumerable: !1 },
  Qe = new WeakSet([Object.prototype, Error.prototype]),
  $e = (e, t) => {
    ;((e.name = `$ZodError`),
      (Ze.value = t),
      Object.defineProperty(e, 'issues', Ze),
      (Ze.value = void 0),
      Object.defineProperty(e, 'message', Xe))
    let n = Object.getPrototypeOf(e)
    Qe.has(n) ||
      (Qe.add(n),
      Object.defineProperty(n, 'toString', {
        configurable: !0,
        enumerable: !1,
        get() {
          let e = () => this.message
          return (Object.defineProperty(this, 'toString', { value: e, configurable: !0, writable: !0 }), e)
        },
        set(e) {
          Object.defineProperty(this, 'toString', { value: e, configurable: !0, writable: !0 })
        }
      }))
  },
  et = w(`$ZodError`, $e)
w(`$ZodError`, $e, void 0, { Parent: Error })
function tt(e, t, n) {
  return (
    Object.prototype.hasOwnProperty.call(e, t) ||
      (t === `__proto__`
        ? Object.defineProperty(e, t, { value: n(), writable: !0, enumerable: !0, configurable: !0 })
        : (e[t] = n())),
    e[t]
  )
}
function nt(e, t = (e) => e.message) {
  let n = {},
    r = []
  for (let i of e.issues) i.path.length > 0 ? tt(n, i.path[0], () => []).push(t(i)) : r.push(t(i))
  return { formErrors: r, fieldErrors: n }
}
function rt(e, t = (e) => e.message) {
  let n = { _errors: [] },
    r = (e, i = []) => {
      for (let a of e.issues)
        if (a.code === `invalid_union` && a.errors.length) a.errors.map((e) => r({ issues: e }, [...i, ...a.path]))
        else if (a.code === `invalid_key`) r({ issues: a.issues }, [...i, ...a.path])
        else if (a.code === `invalid_element`) r({ issues: a.issues }, [...i, ...a.path])
        else {
          let e = [...i, ...a.path]
          if (e.length === 0) n._errors.push(t(a))
          else {
            let r = n,
              i = 0
            for (; i < e.length;) {
              let n = e[i],
                o = i === e.length - 1
              if (n === `_errors`) {
                ;(o && r._errors.push(t(a)), i++)
                continue
              }
              Object.prototype.hasOwnProperty.call(r, n) ||
                Object.defineProperty(r, n, { value: { _errors: [] }, enumerable: !0, writable: !0, configurable: !0 })
              let s = r[n]
              ;(o && s._errors.push(t(a)), (r = s), i++)
            }
          }
        }
    }
  return (r(e), n)
}
function it(e, t) {
  return { callee: t?.callee ?? e, Err: t?.Err }
}
const at = (e) => {
    let t = (n, r, i, a) => {
      let o = i ? { ...i, async: !1 } : { async: !1 },
        s = n._zod.run({ value: r, issues: [] }, o)
      if (s instanceof Promise) throw new T()
      if (s.issues.length) {
        let n = new (a?.Err ?? e)(s.issues.map((e) => x(e, o, D())))
        throw (ie(n, a?.callee ?? t), n)
      }
      return s.value
    }
    return t
  },
  ot = (e) => {
    let t = async (n, r, i, a) => {
      let o = i ? { ...i, async: !0 } : { async: !0 },
        s = n._zod.run({ value: r, issues: [] }, o)
      if ((s instanceof Promise && (s = await s), s.issues.length)) {
        let n = new (a?.Err ?? e)(s.issues.map((e) => x(e, o, D())))
        throw (ie(n, a?.callee ?? t), n)
      }
      return s.value
    }
    return t
  },
  st = (e) => (t, n, r) => {
    let i = r ? { ...r, async: !1 } : { async: !1 },
      a = t._zod.run({ value: n, issues: [] }, i)
    if (a instanceof Promise) throw new T()
    return a.issues.length ? ct(e, a.issues, i) : { success: !0, data: a.value }
  }
function ct(e, t, n) {
  let r
  return {
    success: !1,
    get error() {
      return (r || ((r = new e(t.map((e) => x(e, n, D())))), (t = void 0), (n = void 0)), r)
    },
    set error(e) {
      ;((r = e), (t = void 0), (n = void 0))
    }
  }
}
const lt = (e) => async (t, n, r) => {
    let i = r ? { ...r, async: !0 } : { async: !0 },
      a = t._zod.run({ value: n, issues: [] }, i)
    return (
      a instanceof Promise && (a = await a), a.issues.length ? ct(e, a.issues, i) : { success: !0, data: a.value }
    )
  },
  ut = Symbol.for(`zod.compile.invalid`),
  dt = Symbol.for(`zod.compile.fallback`),
  ft = (e, t, n) => {
    let r = e._zod.bag.validator
    if (r !== void 0) {
      if (r(t) !== ut) return !0
      if (r.definite === !0 && n === void 0) return !1
    }
    return pt(e, t, n)
  }
function pt(e, t, n) {
  let r = n ? { ...n, async: !1, abortEarly: !0 } : { async: !1, abortEarly: !0 },
    i = e._zod.bag.fallbackRun,
    a
  if (
    (i ? ((r[dt] = !0), (a = i({ value: t, issues: [] }, r))) : (a = e._zod.run({ value: t, issues: [] }, r)),
    a instanceof Promise)
  )
    throw new T()
  return a.issues.length === 0
}
const mt = async (e, t, n) => {
    let r = n ? { ...n, async: !0, abortEarly: !0 } : { async: !0, abortEarly: !0 },
      i = e._zod.run({ value: t, issues: [] }, r)
    return (i instanceof Promise && (i = await i), i.issues.length === 0)
  },
  ht = (e) => {
    let t = at(e),
      n = (e, r, i, a) => {
        let o = i ? { ...i, direction: `backward` } : { direction: `backward` }
        return t(e, r, o, it(n, a))
      }
    return n
  },
  gt = (e) => {
    let t = at(e),
      n = (e, r, i, a) => t(e, r, i, it(n, a))
    return n
  },
  _t = (e) => {
    let t = ot(e),
      n = async (e, r, i, a) => {
        let o = i ? { ...i, direction: `backward` } : { direction: `backward` }
        return await t(e, r, o, it(n, a))
      }
    return n
  },
  vt = (e) => {
    let t = ot(e),
      n = async (e, r, i, a) => await t(e, r, i, it(n, a))
    return n
  },
  yt = (e) => (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` }
    return st(e)(t, n, i)
  },
  bt = (e) => (t, n, r) => st(e)(t, n, r),
  xt = (e) => async (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` }
    return lt(e)(t, n, i)
  },
  St = (e) => async (t, n, r) => lt(e)(t, n, r),
  Ct = /^[cC][0-9a-z]{6,}$/,
  wt = /^[0-9a-z]+$/,
  Tt = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/,
  Et = /^[0-9a-vA-V]{20}$/,
  Dt = /^[A-Za-z0-9]{27}$/,
  Ot = /^[a-zA-Z0-9_-]{21}$/
function kt(e) {
  return RegExp(`^[a-zA-Z0-9_-]{${e}}$`)
}
const At = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/,
  jt = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  Mt = (e) =>
    e
      ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`)
      : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/,
  Nt = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/
function Pt() {
  return RegExp(
    `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`,
    `u`
  )
}
const Ft =
    /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
  It =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/,
  Lt =
    /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/,
  Rt =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
  zt = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/,
  Bt = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/,
  Vt = /^https?$/,
  Ht = /^\+[1-9]\d{6,14}$/,
  Ut = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`
function Wt(e) {
  return RegExp(`^${e}$`)
}
const Gt = Wt(Ut)
function Kt(e) {
  let t = `(?:[01]\\d|2[0-3]):[0-5]\\d`
  return typeof e.precision == `number`
    ? e.precision === -1
      ? `${t}`
      : e.precision === 0
        ? `${t}:[0-5]\\d`
        : `${t}:[0-5]\\d\\.\\d{${e.precision}}`
    : e.seconds
      ? `${t}:[0-5]\\d(?:\\.\\d+)?`
      : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`
}
function qt(e) {
  return RegExp(`^${Kt(e)}$`)
}
function Jt(e) {
  let t = [`Z`]
  e.offset && t.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`)
  let n = `${Kt({ precision: e.precision, seconds: !0 })}(?:${t.join(`|`)})`,
    r = e.local ? `${n}|${Kt({ precision: e.precision })}` : n
  return RegExp(`^${Ut}T(?:${r})$`)
}
const Yt = /^[\s\S]{0,}$/,
  Xt = /^-?\d+$/,
  Zt = /^-?\d+(?:\.\d+)?$/,
  Qt = /^(?:true|false)$/i,
  $t = /^[^A-Z]*$/,
  en = /^[^a-z]*$/,
  O = w(`$ZodCheck`, (e, t) => {
    var n
    ;((e._zod ??= {}), (e._zod.def = t), (n = e._zod).onattach ?? (n.onattach = []))
  }),
  tn = (e) => {
    let t = e.value
    return !c(t) && t.length !== void 0
  },
  nn = { number: `number`, bigint: `bigint`, object: `date` },
  rn = w(`$ZodCheckLessThan`, (e, t) => {
    O.init(e, t)
    let n = nn[typeof t.value]
    e._zod.check = (r) => {
      ;(t.inclusive ? r.value <= t.value : r.value < t.value) ||
        r.issues.push({
          origin: nn[typeof r.value] ?? n,
          code: `too_big`,
          maximum: typeof t.value == `object` ? t.value.getTime() : t.value,
          input: r.value,
          inclusive: t.inclusive,
          inst: e,
          continue: !t.abort
        })
    }
  }),
  an = w(`$ZodCheckGreaterThan`, (e, t) => {
    O.init(e, t)
    let n = nn[typeof t.value]
    e._zod.check = (r) => {
      ;(t.inclusive ? r.value >= t.value : r.value > t.value) ||
        r.issues.push({
          origin: nn[typeof r.value] ?? n,
          code: `too_small`,
          minimum: typeof t.value == `object` ? t.value.getTime() : t.value,
          input: r.value,
          inclusive: t.inclusive,
          inst: e,
          continue: !t.abort
        })
    }
  }),
  on = w(`$ZodCheckMultipleOf`, (e, t) => {
    ;(O.init(e, t),
      (e._zod.check = (n) => {
        if (typeof n.value != typeof t.value) throw Error(`Cannot mix number and bigint in multiple_of check.`)
        ;(typeof n.value == `bigint`
          ? t.value !== BigInt(0) && n.value % t.value === BigInt(0)
          : u(n.value, t.value) === 0) ||
          n.issues.push({
            origin: typeof n.value,
            code: `not_multiple_of`,
            divisor: t.value,
            input: n.value,
            inst: e,
            continue: !t.abort
          })
      }))
  }),
  sn = w(`$ZodCheckNumberFormat`, (e, t) => {
    ;(O.init(e, t), (t.format = t.format || `float64`))
    let n = t.format?.includes(`int`),
      r = n ? `int` : `number`,
      [i, a] = pe[t.format]
    e._zod.check = (o) => {
      let s = o.value
      if (n) {
        if (!Number.isInteger(s)) {
          o.issues.push({ expected: r, format: t.format, code: `invalid_type`, continue: !1, input: s, inst: e })
          return
        }
        if (!Number.isSafeInteger(s)) {
          s > 0
            ? o.issues.push({
                input: s,
                code: `too_big`,
                maximum: 2 ** 53 - 1,
                note: `Integers must be within the safe integer range.`,
                inst: e,
                origin: r,
                inclusive: !0,
                continue: !t.abort
              })
            : o.issues.push({
                input: s,
                code: `too_small`,
                minimum: -(2 ** 53 - 1),
                note: `Integers must be within the safe integer range.`,
                inst: e,
                origin: r,
                inclusive: !0,
                continue: !t.abort
              })
          return
        }
      }
      ;(s < i &&
        o.issues.push({
          origin: `number`,
          input: s,
          code: `too_small`,
          minimum: i,
          inclusive: !0,
          inst: e,
          continue: !t.abort
        }),
        s > a &&
          o.issues.push({
            origin: `number`,
            input: s,
            code: `too_big`,
            maximum: a,
            inclusive: !0,
            inst: e,
            continue: !t.abort
          }))
    }
  }),
  cn = w(`$ZodCheckMaxLength`, (e, t) => {
    var n
    ;(O.init(e, t),
      (n = e._zod.def).when ?? (n.when = tn),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length
        if ((typeof r == `string` && i > t.maximum ? ke(r) : i) <= t.maximum) return
        let a = Ae(r)
        n.issues.push({
          origin: a,
          code: `too_big`,
          maximum: t.maximum,
          inclusive: !0,
          input: r,
          inst: e,
          continue: !t.abort
        })
      }))
  }),
  ln = w(`$ZodCheckMinLength`, (e, t) => {
    var n
    ;(O.init(e, t),
      (n = e._zod.def).when ?? (n.when = tn),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length
        if ((typeof r == `string` && i >= t.minimum && i < t.minimum * 2 ? ke(r) : i) >= t.minimum) return
        let a = Ae(r)
        n.issues.push({
          origin: a,
          code: `too_small`,
          minimum: t.minimum,
          inclusive: !0,
          input: r,
          inst: e,
          continue: !t.abort
        })
      }))
  }),
  un = w(`$ZodCheckLengthEquals`, (e, t) => {
    var n
    ;(O.init(e, t),
      (n = e._zod.def).when ?? (n.when = tn),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length,
          a = typeof r == `string` && i >= t.length && i <= t.length * 2 ? ke(r) : i
        if (a === t.length) return
        let o = Ae(r),
          s = a > t.length
        n.issues.push({
          origin: o,
          ...(s ? { code: `too_big`, maximum: t.length } : { code: `too_small`, minimum: t.length }),
          inclusive: !0,
          exact: !0,
          input: n.value,
          inst: e,
          continue: !t.abort
        })
      }))
  }),
  dn = w(`$ZodCheckStringFormat`, (e, t) => {
    var n, r
    ;(O.init(e, t),
      t.pattern
        ? ((n = e._zod).check ??
          (n.check = (n) => {
            ;((t.pattern.lastIndex = 0),
              !t.pattern.test(n.value) &&
                n.issues.push({
                  origin: `string`,
                  code: `invalid_format`,
                  format: t.format,
                  input: n.value,
                  ...(t.pattern ? { pattern: t.pattern.toString() } : {}),
                  inst: e,
                  continue: !t.abort
                }))
          }))
        : ((r = e._zod).check ?? (r.check = () => {})))
  }),
  fn = w(`$ZodCheckRegex`, (e, t) => {
    ;(dn.init(e, t),
      (e._zod.check = (n) => {
        ;((t.pattern.lastIndex = 0),
          !t.pattern.test(n.value) &&
            n.issues.push({
              origin: `string`,
              code: `invalid_format`,
              format: `regex`,
              input: n.value,
              pattern: t.pattern.toString(),
              inst: e,
              continue: !t.abort
            }))
      }))
  }),
  pn = w(`$ZodCheckLowerCase`, (e, t) => {
    ;((t.pattern ??= $t), dn.init(e, t))
  }),
  mn = w(`$ZodCheckUpperCase`, (e, t) => {
    ;((t.pattern ??= en), dn.init(e, t))
  }),
  hn = w(`$ZodCheckIncludes`, (e, t) => {
    O.init(e, t)
    let n = ue(t.includes)
    ;((t.pattern = new RegExp(typeof t.position == `number` ? `^.{${t.position},}${n}` : n)),
      (e._zod.check = (n) => {
        n.value.includes(t.includes, t.position) ||
          n.issues.push({
            origin: `string`,
            code: `invalid_format`,
            format: `includes`,
            includes: t.includes,
            input: n.value,
            inst: e,
            continue: !t.abort
          })
      }))
  }),
  gn = w(`$ZodCheckStartsWith`, (e, t) => {
    O.init(e, t)
    let n = RegExp(`^${ue(t.prefix)}.*`)
    ;((t.pattern ??= n),
      (e._zod.check = (n) => {
        n.value.startsWith(t.prefix) ||
          n.issues.push({
            origin: `string`,
            code: `invalid_format`,
            format: `starts_with`,
            prefix: t.prefix,
            input: n.value,
            inst: e,
            continue: !t.abort
          })
      }))
  }),
  _n = w(`$ZodCheckEndsWith`, (e, t) => {
    O.init(e, t)
    let n = RegExp(`.*${ue(t.suffix)}$`)
    ;((t.pattern ??= n),
      (e._zod.check = (n) => {
        n.value.endsWith(t.suffix) ||
          n.issues.push({
            origin: `string`,
            code: `invalid_format`,
            format: `ends_with`,
            suffix: t.suffix,
            input: n.value,
            inst: e,
            continue: !t.abort
          })
      }))
  }),
  vn = w(`$ZodCheckOverwrite`, (e, t) => {
    ;(O.init(e, t),
      (e._zod.check = (e) => {
        e.value = t.tx(e.value)
      }))
  })
var yn = class {
  constructor(e = [], t = {}) {
    ;((this.content = []), (this.indent = 0), (this.args = e), (this.closed = t))
  }
  indented(e) {
    this.indent += 1
    try {
      e(this)
    } finally {
      --this.indent
    }
  }
  write(e) {
    if (typeof e == `function`) {
      ;(e(this, { execution: `sync` }), e(this, { execution: `async` }))
      return
    }
    let t = e
        .split(`
`)
        .filter((e) => e),
      n = Math.min(...t.map((e) => e.length - e.trimStart().length)),
      r = t.map((e) => e.slice(n)).map((e) => ` `.repeat(this.indent * 2) + e)
    for (let e of r) this.content.push(e)
  }
  compile() {
    let e = Function,
      t = this?.content ?? [``]
    return new e(
      ...Object.keys(this.closed),
      `return function (${this.args.join(`, `)}) {\n${t.join(`
`)}\n};`
    )(...Object.values(this.closed))
  }
}
const bn = { major: 4, minor: 6, patch: 6 },
  k = w(
    `$ZodType`,
    (e, t) => {
      var n
      ;((e ??= {}), (e._zod.def = t), (e._zod.bag = e._zod.bag || {}), (e._zod.version = bn))
      let r = e._zod.def.checks,
        i = e._zod.traits.has(`$ZodCheck`) ? [e, ...(r ?? [])] : r?.length ? [...r] : []
      for (let t of i) for (let n of t._zod.onattach) n(e)
      if (i.length === 0)
        ((n = e._zod).deferred ?? (n.deferred = []),
          e._zod.deferred?.push(() => {
            e._zod.run = e._zod.parse
          }))
      else {
        let t = (t, n, r) => {
            if (t.memo) return t
            let i = y(t),
              a
            for (let o of n) {
              if (o._zod.def.when) {
                if (we(t) || !o._zod.def.when(t)) continue
              } else if (i) continue
              let n = t.issues.length,
                s = o._zod.check(t)
              if (s instanceof Promise && r?.async === !1) throw new T()
              if (a || s instanceof Promise)
                a = (a ?? Promise.resolve()).then(async () => {
                  ;(await s, t.issues.length !== n && (De(t.issues, n, e), (i ||= y(t, n))))
                })
              else {
                if (t.issues.length === n) continue
                ;(De(t.issues, n, e), (i ||= y(t, n)))
              }
            }
            return a ? a.then(() => t) : t
          },
          n = (n, r, a) => {
            if (y(n)) return ((n.aborted = !0), n)
            let o = t(r, i, a)
            if (o instanceof Promise) {
              if (a.async === !1) throw new T()
              return o.then((t) => e._zod.parse(t, a))
            }
            return e._zod.parse(o, a)
          }
        e._zod.run = (r, a) => {
          if (a.skipChecks) return e._zod.parse(r, a)
          if (a.direction === `backward`) {
            let t = e._zod.parse({ value: r.value, issues: [] }, { ...a, skipChecks: !0 })
            return t instanceof Promise ? t.then((e) => n(e, r, a)) : n(t, r, a)
          }
          let o = e._zod.parse(r, a)
          if (o instanceof Promise) {
            if (a.async === !1) throw new T()
            return o.then((e) => t(e, i, a))
          }
          return t(o, i, a)
        }
      }
    },
    {
      get '~standard'() {
        return Pe(this, `~standard`, Cn(this))
      },
      set '~standard'(e) {
        S(this, `~standard`, e)
      }
    }
  ),
  xn = (e, t) => (e.issues.length ? { issues: e.issues.map((e) => x(e, t, D())) } : { value: e.value })
async function Sn(e, t) {
  let n = { async: !0 }
  return xn(await e._zod.run({ value: t, issues: [] }, n), n)
}
function Cn(e) {
  return {
    validate: (t) => {
      let n = { async: !1 }
      try {
        let r = e._zod.run({ value: t, issues: [] }, n)
        if (!(r instanceof Promise)) return xn(r, n)
      } catch {}
      return Sn(e, t)
    },
    vendor: `zod`,
    version: 1
  }
}
const wn = w(`$ZodString`, (e, t) => {
    ;(k.init(e, t),
      (e._zod.pattern = t.pattern ?? Yt),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = String(n.value)
          } catch {}
        return (
          typeof n.value == `string` ||
            n.issues.push({ expected: `string`, code: `invalid_type`, input: n.value, inst: e }),
          n
        )
      }))
  }),
  A = w(`$ZodStringFormat`, (e, t) => {
    ;(dn.init(e, t), wn.init(e, t))
  }),
  Tn = w(`$ZodGUID`, (e, t) => {
    ;((t.pattern ??= jt), A.init(e, t))
  }),
  En = w(`$ZodUUID`, (e, t) => {
    if (t.version) {
      let e = { v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7, v8: 8 }[t.version]
      if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`)
      t.pattern ??= Mt(e)
    } else t.pattern ??= Mt()
    A.init(e, t)
  }),
  Dn = w(`$ZodEmail`, (e, t) => {
    ;((t.pattern ??= Nt), A.init(e, t))
  })
function On(e) {
  try {
    return typeof URL < `u` && typeof URL.canParse == `function` ? URL.canParse(e) : (new URL(e), !0)
  } catch {
    return !1
  }
}
function kn(e, t) {
  return !(`normalize` in t) && !(`hostname` in t) && !(`protocol` in t) ? On(e) || 2 : An(e, t)
}
function An(e, t) {
  if (!t.normalize && t.protocol?.source === Vt.source && !/^https?:\/\//i.test(e)) return 1
  try {
    if (typeof URL < `u`) {
      let t = URL
      if (typeof t.parse == `function`) return t.parse(e) ?? 2
    }
    return new URL(e)
  } catch {
    return 2
  }
}
const jn = /[\t\n\r]/g
function Mn(e) {
  return e.replace(jn, ``)
}
function Nn(e, t) {
  return ((t.lastIndex = 0), t.test(e.hostname))
}
function Pn(e, t) {
  return ((t.lastIndex = 0), t.test(e.protocol.endsWith(`:`) ? e.protocol.slice(0, -1) : e.protocol))
}
const Fn = w(`$ZodURL`, (e, t) => {
    ;(A.init(e, t),
      (e._zod.check = (n) => {
        try {
          let r = n.value.trim(),
            i = kn(r, t)
          if (i === 1) {
            n.issues.push({
              code: `invalid_format`,
              format: `url`,
              note: `Invalid URL format`,
              input: n.value,
              inst: e,
              continue: !t.abort
            })
            return
          }
          if (i === 2) {
            n.issues.push({ code: `invalid_format`, format: `url`, input: n.value, inst: e, continue: !t.abort })
            return
          }
          if (i === !0) {
            n.value = Mn(r)
            return
          }
          ;(t.hostname &&
            !Nn(i, t.hostname) &&
            n.issues.push({
              code: `invalid_format`,
              format: `url`,
              note: `Invalid hostname`,
              pattern: t.hostname.source,
              input: n.value,
              inst: e,
              continue: !t.abort
            }),
            t.protocol &&
              !Pn(i, t.protocol) &&
              n.issues.push({
                code: `invalid_format`,
                format: `url`,
                note: `Invalid protocol`,
                pattern: t.protocol.source,
                input: n.value,
                inst: e,
                continue: !t.abort
              }),
            (n.value = t.normalize ? i.href : Mn(r)))
          return
        } catch {
          n.issues.push({ code: `invalid_format`, format: `url`, input: n.value, inst: e, continue: !t.abort })
        }
      }))
  }),
  In = w(`$ZodEmoji`, (e, t) => {
    ;((t.pattern ??= Pt()), A.init(e, t))
  }),
  Ln = w(`$ZodNanoID`, (e, t) => {
    if (t.length !== void 0 && (!Number.isInteger(t.length) || t.length < 1))
      throw Error(`Invalid nanoid length: ${t.length}`)
    ;((t.pattern ??= t.length === void 0 ? Ot : kt(t.length)), A.init(e, t))
  }),
  Rn = w(`$ZodCUID`, (e, t) => {
    ;((t.pattern ??= Ct), A.init(e, t))
  }),
  zn = w(`$ZodCUID2`, (e, t) => {
    ;((t.pattern ??= wt), A.init(e, t))
  }),
  Bn = w(`$ZodULID`, (e, t) => {
    ;((t.pattern ??= Tt), A.init(e, t))
  }),
  Vn = w(`$ZodXID`, (e, t) => {
    ;((t.pattern ??= Et), A.init(e, t))
  }),
  Hn = w(`$ZodKSUID`, (e, t) => {
    ;((t.pattern ??= Dt), A.init(e, t))
  }),
  Un = w(`$ZodISODateTime`, (e, t) => {
    ;((t.pattern ??= Jt(t)), A.init(e, t))
  }),
  Wn = w(`$ZodISODate`, (e, t) => {
    ;((t.pattern ??= Gt), A.init(e, t))
  }),
  Gn = w(`$ZodISOTime`, (e, t) => {
    ;((t.pattern ??= qt(t)), A.init(e, t))
  }),
  Kn = w(`$ZodISODuration`, (e, t) => {
    ;((t.pattern ??= At), A.init(e, t))
  }),
  qn = w(`$ZodIPv4`, (e, t) => {
    ;((t.pattern ??= Ft), A.init(e, t))
  }),
  Jn = /^[0-9a-fA-F:.]+$/
function Yn(e) {
  return Jn.test(e) ? On(`http://[${e}]`) : !1
}
const Xn = w(`$ZodIPv6`, (e, t) => {
    ;((t.pattern ??= It),
      A.init(e, t),
      (e._zod.check = (n) => {
        Yn(n.value) ||
          n.issues.push({ code: `invalid_format`, format: `ipv6`, input: n.value, inst: e, continue: !t.abort })
      }))
  }),
  Zn = w(`$ZodCIDRv4`, (e, t) => {
    ;((t.pattern ??= Lt), A.init(e, t))
  })
function Qn(e) {
  let t = e.split(`/`)
  if (t.length !== 2) return !1
  let [n, r] = t
  if (!r) return !1
  let i = Number(r)
  return `${i}` !== r || i < 0 || i > 128 ? !1 : Yn(n)
}
const $n = w(`$ZodCIDRv6`, (e, t) => {
  ;((t.pattern ??= Rt),
    A.init(e, t),
    (e._zod.check = (n) => {
      Qn(n.value) ||
        n.issues.push({ code: `invalid_format`, format: `cidrv6`, input: n.value, inst: e, continue: !t.abort })
    }))
})
function er(e) {
  if (e === ``) return !0
  if (/\s/.test(e) || e.length % 4 != 0) return !1
  try {
    return (atob(e), !0)
  } catch {
    return !1
  }
}
const tr = /^[0-9a-zA-Z+/]*={0,2}$/,
  nr = w(`$ZodBase64`, (e, t) => {
    ;((t.pattern ??= tr),
      A.init(e, t),
      (e._zod.check = (n) => {
        er(n.value) ||
          n.issues.push({ code: `invalid_format`, format: `base64`, input: n.value, inst: e, continue: !t.abort })
      }))
  }),
  rr = /^[A-Za-z0-9_-]*$/
function ir(e) {
  if (!rr.test(e)) return !1
  let t = e.replace(/[-_]/g, (e) => (e === `-` ? `+` : `/`))
  return er(t.padEnd(Math.ceil(t.length / 4) * 4, `=`))
}
const ar = w(`$ZodBase64URL`, (e, t) => {
    ;((t.pattern ??= rr),
      A.init(e, t),
      (e._zod.check = (n) => {
        ir(n.value) ||
          n.issues.push({ code: `invalid_format`, format: `base64url`, input: n.value, inst: e, continue: !t.abort })
      }))
  }),
  or = w(`$ZodE164`, (e, t) => {
    ;((t.pattern ??= Ht), A.init(e, t))
  })
function sr(e, t = null) {
  try {
    let n = e.split(`.`)
    if (n.length !== 3) return !1
    let [r] = n
    if (!r) return !1
    let i = JSON.parse(atob(r))
    return !((`typ` in i && i?.typ !== `JWT`) || !i.alg || (t && (!(`alg` in i) || i.alg !== t)))
  } catch {
    return !1
  }
}
const cr = w(`$ZodJWT`, (e, t) => {
    ;(A.init(e, t),
      (e._zod.check = (n) => {
        sr(n.value, t.alg) ||
          n.issues.push({ code: `invalid_format`, format: `jwt`, input: n.value, inst: e, continue: !t.abort })
      }))
  }),
  lr = w(`$ZodNumber`, (e, t) => {
    ;(k.init(e, t),
      (e._zod.pattern = Zt),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = Number(n.value)
          } catch {}
        let i = n.value
        if (typeof i == `number` && !Number.isNaN(i) && Number.isFinite(i)) return n
        let a = typeof i == `number` ? (Number.isNaN(i) ? `NaN` : Number.isFinite(i) ? void 0 : String(i)) : void 0
        return (
          n.issues.push({ expected: `number`, code: `invalid_type`, input: i, inst: e, ...(a ? { received: a } : {}) }),
          n
        )
      }))
  }),
  ur = w(`$ZodNumberFormat`, (e, t) => {
    ;(sn.init(e, t), lr.init(e, t))
  }),
  dr = w(`$ZodBoolean`, (e, t) => {
    ;(k.init(e, t),
      (e._zod.pattern = Qt),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = !!n.value
          } catch {}
        let i = n.value
        return (
          typeof i == `boolean` || n.issues.push({ expected: `boolean`, code: `invalid_type`, input: i, inst: e }), n
        )
      }))
  }),
  fr = w(`$ZodUnknown`, (e, t) => {
    ;(k.init(e, t), (e._zod.parse = (e) => e))
  }),
  pr = w(`$ZodNever`, (e, t) => {
    ;(k.init(e, t),
      (e._zod.parse = (t, n) => (
        t.issues.push({ expected: `never`, code: `invalid_type`, input: t.value, inst: e }),
        t
      )))
  })
function mr(e, t) {
  let n = Ee(e._zod.def.checks)
  if (!n.length) return
  let r = Math.min(...n.map((e) => e[0])),
    i = e._zod.parse
  e._zod.parse = (n, a) => {
    let o = t(n.value)
    if (o > r && !a?.skipChecks && a?.direction !== `backward`) {
      for (let [t, r] of Ee(e._zod.def.checks))
        if (o > t && r._zod.def.when(n)) {
          let t = n.issues.length
          return (r._zod.check(n), (n.issues[t].continue = !1), De(n.issues, t, e), n)
        }
    }
    return i(n, a)
  }
}
const hr = (e) => (Array.isArray(e) ? e.length : -1)
function gr(e, t, n) {
  ;(e.issues.length && t.issues.push(...b(n, e.issues)), (t.value[n] = e.value))
}
const _r = w(`$ZodArray`, (e, t) => {
  k.init(e, t)
  let n = E.memoizer
  ;(n?.attach(e),
    (e._zod.parse = (r, i) => {
      let a = r.value
      if (!Array.isArray(a)) return (r.issues.push({ expected: `array`, code: `invalid_type`, input: a, inst: e }), r)
      r.value = n ? n.alloc(e, r, Array(a.length), i) : Array(a.length)
      let o = [],
        s = i?.abortEarly
      for (let e = 0; e < a.length; e++) {
        let n = a[e],
          c = t.element._zod.run({ value: n, issues: [] }, i)
        if (c instanceof Promise) o.push(c.then((t) => gr(t, r, e)))
        else if ((gr(c, r, e), s && c.issues.length !== 0 && y(c))) break
      }
      return o.length ? Promise.all(o).then(() => r) : r
    }),
    mr(e, hr))
})
function vr(e, t, n, r, i, a) {
  let o = n in r,
    s = a === `optional`
  if (!(!o && s && i === `optional`)) {
    if (e.issues.length) {
      if (i !== void 0 && s && !o) return
      t.issues.push(...b(n, e.issues))
    }
    if (!o && i === void 0) {
      e.issues.length || t.issues.push({ code: `invalid_type`, expected: `nonoptional`, input: void 0, path: [n] })
      return
    }
    e.value === void 0 ? (o || (i === `defaulted` && !s)) && (t.value[n] = void 0) : (t.value[n] = e.value)
  }
}
const yr = []
function br(e) {
  let t = Object.keys(e.shape),
    n = Object.getOwnPropertySymbols(e.shape),
    r = n.length ? n : yr,
    i = r.length ? [...t, ...r] : t
  for (let t of i)
    if (!e.shape?.[t]?._zod?.traits?.has(`$ZodType`))
      throw Error(`Invalid element at key "${String(t)}": expected a Zod schema`)
  let a = fe(e.shape)
  return { ...e, allKeys: i, symbolKeys: r, keySet: new Set(t), numKeys: t.length, optionalKeys: new Set(a) }
}
function xr(e, t, n, r, i, a, o) {
  let s = [],
    c = i.keySet,
    l = i.catchall._zod,
    u = l.def.type,
    d = l.optin,
    f = l.optout,
    p = 0
  for (let i in t) {
    if (o && n.issues.length !== p) {
      if (y(n, p)) break
      p = n.issues.length
    }
    if (c.has(i)) continue
    if (i === `__proto__`) {
      u === `never` && s.push(i)
      continue
    }
    if (u === `never`) {
      s.push(i)
      continue
    }
    let a = l.run({ value: t[i], issues: [] }, r)
    a instanceof Promise ? e.push(a.then((e) => vr(e, n, i, t, d, f))) : vr(a, n, i, t, d, f)
  }
  return (
    s.length && n.issues.push({ code: `unrecognized_keys`, keys: s, input: t, inst: a, continue: !0 }),
    e.length ? Promise.all(e).then(() => n) : n
  )
}
const Sr = w(`$ZodObject`, (e, t) => {
    k.init(e, t)
    let n = Object.getOwnPropertyDescriptor(t, `shape`),
      r = n?.get ? n.get.raw : (t.shape ?? {})
    if (r) {
      let e = () => {
        let n = { ...r }
        return (Object.defineProperty(t, 'shape', { value: n }), (e.raw = n), n)
      }
      ;((e.raw = r), Object.defineProperty(t, 'shape', { get: e }))
    }
    let i = s(() => br(t))
    C(e, `propValues`, (e) => {
      let t = e.def.shape,
        n = {}
      for (let e in t) {
        let r = t[e]._zod
        if (r.values) {
          Object.prototype.hasOwnProperty.call(n, e) || d(n, e, new Set())
          for (let t of r.values) n[e].add(t)
          r.optin !== void 0 && n[e].add(void 0)
        }
      }
      return n
    })
    let a = ae,
      o = t.catchall,
      c,
      l = E.memoizer
    ;(l?.attach(e),
      (e._zod.parse = (t, n) => {
        c ??= i.value
        let r = t.value
        if (!a(r)) return (t.issues.push({ expected: `object`, code: `invalid_type`, input: r, inst: e }), t)
        t.value = l ? l.alloc(e, t, {}, n) : {}
        let s = [],
          u = c.shape,
          d = n?.abortEarly,
          f = t.issues.length
        for (let e of c.allKeys) {
          if (d && t.issues.length !== f) {
            if (y(t, f)) break
            f = t.issues.length
          }
          if (e === `__proto__`) continue
          let i = u[e],
            a = i._zod.optin,
            o = i._zod.optout,
            c = i._zod.run({ value: r[e], issues: [] }, n)
          c instanceof Promise ? s.push(c.then((n) => vr(n, t, e, r, a, o))) : vr(c, t, e, r, a, o)
        }
        return o ? xr(s, r, t, n, i.value, e, d === !0) : s.length ? Promise.all(s).then(() => t) : t
      }))
  }),
  Cr = w(`$ZodObjectJIT`, (e, t) => {
    Sr.init(e, t)
    let n = e._zod.parse,
      r = s(() => br(t)),
      i = E.memoizer,
      a = (t) => {
        let n = r.value,
          a = n.symbolKeys,
          o = new yn([`payload`, `ctx`], { shape: t, inst: e, memo: i, syms: a }),
          s = (e) => `shape[${e}]._zod.run({ value: input[${e}], issues: [] }, ctx)`,
          c = (e, t) => `
          let ${e}_ab = false;
          for (let i = 0; i < ${e}.issues.length; i++) {
            const iss = ${e}.issues[i];
            iss.path = iss.path ? [${t}, ...iss.path] : [${t}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${e}_ab = true;
          }
          if (${e}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`
        o.write(`const input = payload.value;`)
        let l = Object.create(null),
          u = 0
        for (let e of n.allKeys) l[e] = `key_${u++}`
        o.write(i ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`)
        for (let e of n.allKeys) {
          if (e === `__proto__`) continue
          let n = l[e],
            r = typeof e == `symbol` ? `syms[${a.indexOf(e)}]` : ne(e),
            i = `${r} in input`,
            u = t[e],
            d = u?._zod?.optin,
            f = d !== void 0,
            p = u?._zod?.optout === `optional`
          if ((o.write(`const ${n} = ${s(r)};`), f && p)) {
            let e = d === `optional` ? `${n}_present` : `${n}.value !== undefined || ${n}_present`
            o.write(`
        const ${n}_present = ${i};
        if (!${n}.issues.length || ${n}_present) {
          if (${n}.issues.length) {${c(n, r)}
          }

          if (${e}) {
            newResult[${r}] = ${n}.value;
          }
        }

      `)
          } else
            f
              ? (o.write(`
        if (${n}.issues.length) {${c(n, r)}
        }
      `),
                d === `defaulted`
                  ? o.write(`newResult[${r}] = ${n}.value;`)
                  : o.write(`
        if (${n}.value !== undefined || ${i}) {
          newResult[${r}] = ${n}.value;
        }
      `))
              : o.write(`
        const ${n}_present = ${i};
        if (${n}.issues.length) {${c(n, r)}
        }
        if (!${n}_present && !${n}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${r}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${n}_present) {
          newResult[${r}] = ${n}.value;
        }

      `)
        }
        return (o.write(`payload.value = newResult;`), o.write(`return payload;`), o.compile())
      },
      o,
      c = ae,
      l = !E.jitless,
      u = l && oe.value,
      d = t.catchall,
      f
    e._zod.parse = (i, s) => {
      f ??= r.value
      let p = i.value
      return c(p)
        ? l && u && s?.async === !1 && s.jitless !== !0
          ? ((o ||= a(t.shape)), (i = o(i, s)), d ? xr([], p, i, s, f, e, s?.abortEarly === !0) : i)
          : n(i, s)
        : (i.issues.push({ expected: `object`, code: `invalid_type`, input: p, inst: e }), i)
    }
  })
function wr(e, t, n, r) {
  for (let n of e) if (n.issues.length === 0) return ((t.value = n.value), t)
  let i = e.filter((e) => !y(e))
  return i.length === 1
    ? ((t.value = i[0].value), i[0])
    : (t.issues.push({
        code: `invalid_union`,
        input: t.value,
        inst: n,
        errors: e.map((e) => e.issues.map((e) => x(e, r, D())))
      }),
      t)
}
const Tr = w(`$ZodUnion`, (e, t) => {
  ;(k.init(e, t),
    C(e, `optin`, (e) =>
      e.def.options.some((e) => e._zod.optin === `defaulted`)
        ? `defaulted`
        : e.def.options.some((e) => e._zod.optin !== void 0)
          ? `optional`
          : void 0
    ),
    C(e, `optout`, (e) => (e.def.options.some((e) => e._zod.optout === `optional`) ? `optional` : void 0)),
    C(e, `values`, (e) => {
      if (e.def.options.every((e) => e._zod.values))
        return new Set(e.def.options.flatMap((e) => Array.from(e._zod.values)))
    }),
    C(e, `pattern`, (e) => {
      if (e.def.options.every((e) => e._zod.pattern)) {
        let t = e.def.options.map((e) => e._zod.pattern)
        return RegExp(`^(${t.map((e) => l(e.source)).join(`|`)})$`)
      }
    }))
  let n = t.options.length === 1 ? t.options[0]._zod.run : null
  e._zod.parse = (r, i) => {
    if (n) return n(r, i)
    let a = !1,
      o = []
    for (let e of t.options) {
      let t = e._zod.run({ value: r.value, issues: [] }, i)
      if (t instanceof Promise) (o.push(t), (a = !0))
      else {
        if (t.issues.length === 0) return t
        o.push(t)
      }
    }
    return a ? Promise.all(o).then((t) => wr(t, r, e, i)) : wr(o, r, e, i)
  }
})
function Er(e) {
  let t = new Map()
  for (let n of e.options) {
    let r = n._zod.propValues?.[e.discriminator]
    if (!r || r.size === 0) throw Error(`Invalid discriminated union option at index "${e.options.indexOf(n)}"`)
    for (let e of r)
      if (t.has(e)) {
        if (e !== void 0) throw Error(`Duplicate discriminator value "${String(e)}"`)
        t.set(e, null)
      } else t.set(e, n)
  }
  return t
}
const Dr = w(`$ZodDiscriminatedUnion`, (e, t) => {
    ;((t.inclusive = !1), Tr.init(e, t))
    let n = e._zod.parse
    ;(C(e, `propValues`, (e) => {
      let t = {},
        n = 0
      for (let r of e.def.options) {
        let i = r._zod.propValues
        if (!i || Object.keys(i).length === 0)
          throw Error(`Invalid discriminated union option at index "${e.def.options.indexOf(r)}"`)
        i[e.def.discriminator]?.has(void 0) && n++
        for (let [e, n] of Object.entries(i)) {
          Object.prototype.hasOwnProperty.call(t, e) || d(t, e, new Set())
          for (let r of n) t[e].add(r)
        }
      }
      return (!e.def.unionFallback && n > 1 && t[e.def.discriminator]?.delete(void 0), t)
    }),
      t.options.forEach((e, n) => {
        let r = f(e._zod.def)
        if (r && !Object.prototype.hasOwnProperty.call(r, t.discriminator))
          throw Error(`Invalid discriminated union option at index "${n}"`)
      }))
    let r = s(() => Er(t))
    e._zod.parse = (i, a) => {
      let o = i.value
      if (!ae(o)) return (i.issues.push({ code: `invalid_type`, expected: `object`, input: o, inst: e }), i)
      let s = o?.[t.discriminator],
        c = r.value.get(s)
      return c && (s !== void 0 || a.direction !== `backward`)
        ? c._zod.run(i, a)
        : t.unionFallback || a.direction === `backward`
          ? n(i, a)
          : (i.issues.push({
              code: `invalid_union`,
              errors: [],
              note: `No matching discriminator`,
              discriminator: t.discriminator,
              options: Array.from(r.value.keys()).filter((e) => r.value.get(e) !== null),
              input: o,
              path: [t.discriminator],
              inst: e
            }),
            i)
    }
  }),
  Or = w(`$ZodIntersection`, (e, t) => {
    ;(k.init(e, t),
      (e._zod.parse = (e, n) => {
        let r = e.value,
          i = t.left._zod.run({ value: r, issues: [] }, n),
          a = t.right._zod.run({ value: r, issues: [] }, n)
        return i instanceof Promise || a instanceof Promise
          ? Promise.all([i, a]).then(([t, n]) => Ar(e, t, n))
          : Ar(e, i, a)
      }))
  })
function kr(e, t) {
  if (e === t || (e instanceof Date && t instanceof Date && +e == +t)) return { valid: !0, data: e }
  if (se(e) && se(t)) {
    let n = Object.keys(t),
      r = Object.keys(e).filter((e) => n.indexOf(e) !== -1),
      i = { ...e, ...t }
    Object.prototype.hasOwnProperty.call(i, `__proto__`) && delete i.__proto__
    for (let n of r) {
      if (n === `__proto__`) continue
      let r = kr(e[n], t[n])
      if (!r.valid) return { valid: !1, mergeErrorPath: [n, ...r.mergeErrorPath] }
      i[n] = r.data
    }
    return { valid: !0, data: i }
  }
  if (Array.isArray(e) && Array.isArray(t)) {
    if (e.length !== t.length) return { valid: !1, mergeErrorPath: [] }
    let n = []
    for (let r = 0; r < e.length; r++) {
      let i = e[r],
        a = t[r],
        o = kr(i, a)
      if (!o.valid) return { valid: !1, mergeErrorPath: [r, ...o.mergeErrorPath] }
      n.push(o.data)
    }
    return { valid: !0, data: n }
  }
  return { valid: !1, mergeErrorPath: [] }
}
function Ar(e, t, n) {
  let r = new Map(),
    i,
    a = new Map(),
    o = (e, t) => {
      let n
      if (e.code === `unrecognized_keys` && !e.path?.length) ((i ??= e), (n = e.keys))
      else if (e.code === `invalid_key` && e.origin === `record` && e.path?.length === 1) {
        let t = String(e.path[0])
        ;(a.has(t) || a.set(t, e), (n = [t]))
      } else return !1
      for (let e of n) (r.has(e) || r.set(e, {}), (r.get(e)[t] = !0))
      return !0
    }
  for (let n of t.issues) o(n, `l`) || e.issues.push(n)
  for (let t of n.issues) o(t, `r`) || e.issues.push(t)
  let s = [...r].filter(([, e]) => e.l && e.r).map(([e]) => e)
  if (s.length) {
    let t = i ? s.filter((e) => i.keys.includes(e)) : []
    t.length && e.issues.push({ ...i, keys: t })
    for (let n of s) !t.includes(n) && a.has(n) && e.issues.push(a.get(n))
  }
  let c = kr(t.value, n.value)
  if (!c.valid) {
    if (y(e)) return e
    throw Error(`Unmergable intersection. Error path: ${JSON.stringify(c.mergeErrorPath)}`)
  }
  return ((e.value = c.data), e)
}
const jr = w(`$ZodRecord`, (e, t) => {
    k.init(e, t)
    let n = E.memoizer
    ;(n?.attach(e),
      (e._zod.parse = (r, i) => {
        let a = r.value
        if (!se(a)) return (r.issues.push({ expected: `record`, code: `invalid_type`, input: a, inst: e }), r)
        let o = [],
          s = t.keyType._zod.values
        if (s && !t.partial) {
          r.value = n ? n.alloc(e, r, {}, i) : {}
          let c = new Set()
          for (let n of s)
            if (typeof n == `string` || typeof n == `number` || typeof n == `symbol`) {
              if ((c.add(typeof n == `number` ? n.toString() : n), n === `__proto__`)) continue
              let s = t.keyType._zod.run({ value: n, issues: [] }, i)
              if (s instanceof Promise) throw Error(`Async schemas not supported in object keys currently`)
              if (s.issues.length) {
                r.issues.push({
                  code: `invalid_key`,
                  origin: `record`,
                  issues: s.issues.map((e) => x(e, i, D())),
                  input: n,
                  path: [n],
                  inst: e
                })
                continue
              }
              let l = s.value
              if (l === `__proto__`) continue
              let u = t.valueType._zod.run({ value: a[n], issues: [] }, i)
              u instanceof Promise
                ? o.push(
                    u.then((e) => {
                      ;(e.issues.length && r.issues.push(...b(n, e.issues)), (r.value[l] = e.value))
                    })
                  )
                : (u.issues.length && r.issues.push(...b(n, u.issues)), (r.value[l] = u.value))
            }
          let l
          for (let e in a)
            if (!c.has(e)) {
              if (t.mode === `loose`) {
                if (e === `__proto__`) continue
                r.value[e] = a[e]
              } else ((l ??= []), l.push(e))
            }
          l && l.length > 0 && r.issues.push({ code: `unrecognized_keys`, input: a, inst: e, keys: l, continue: !0 })
        } else {
          r.value = n ? n.alloc(e, r, {}, i) : {}
          let c
          for (let n of Reflect.ownKeys(a)) {
            if (n === `__proto__` || !Object.prototype.propertyIsEnumerable.call(a, n)) continue
            let l = t.keyType._zod.run({ value: n, issues: [] }, i)
            if (l instanceof Promise) throw Error(`Async schemas not supported in object keys currently`)
            if (typeof n == `string` && Zt.test(n) && l.issues.length) {
              let e = t.keyType._zod.run({ value: Number(n), issues: [] }, i)
              if (e instanceof Promise) throw Error(`Async schemas not supported in object keys currently`)
              e.issues.length === 0 && (l = e)
            }
            if (l.issues.length) {
              t.mode === `loose`
                ? (r.value[n] = a[n])
                : s
                  ? ((c ??= []), c.push(n))
                  : r.issues.push({
                      code: `invalid_key`,
                      origin: `record`,
                      issues: l.issues.map((e) => x(e, i, D())),
                      input: n,
                      path: [n],
                      inst: e
                    })
              continue
            }
            let u = l.value
            if (u === `__proto__`) continue
            let d = t.valueType._zod.run({ value: a[n], issues: [] }, i)
            d instanceof Promise
              ? o.push(
                  d.then((e) => {
                    ;(e.issues.length && r.issues.push(...b(n, e.issues)), (r.value[u] = e.value))
                  })
                )
              : (d.issues.length && r.issues.push(...b(n, d.issues)), (r.value[u] = d.value))
          }
          c && c.length > 0 && r.issues.push({ code: `unrecognized_keys`, input: a, inst: e, keys: c, continue: !0 })
        }
        return o.length ? Promise.all(o).then(() => r) : r
      }))
  }),
  Mr = w(`$ZodEnum`, (e, t) => {
    k.init(e, t)
    let n = r(t.entries),
      i = new Set(n)
    ;((e._zod.values = i),
      C(e, `pattern`, (e) => {
        let t = r(e.def.entries).filter((e) => le.has(typeof e))
        return RegExp(t.length ? `^(${t.map((e) => ue(e.toString())).join(`|`)})$` : `^[^\\s\\S]$`)
      }),
      (e._zod.parse = (t, r) => {
        let a = t.value
        return (i.has(a) || t.issues.push({ code: `invalid_value`, values: n, input: a, inst: e }), t)
      }))
  }),
  Nr = w(`$ZodLiteral`, (e, t) => {
    k.init(e, t)
    let n = new Set(t.values)
    ;((e._zod.values = n),
      C(e, `pattern`, (e) => {
        let t = e.def.values
        return RegExp(
          t.length
            ? `^(${t.map((e) => (typeof e == `string` ? ue(e) : e ? ue(e.toString()) : String(e))).join(`|`)})$`
            : `^[^\\s\\S]$`
        )
      }),
      (e._zod.parse = (r, i) => {
        let a = r.value
        return (n.has(a) || r.issues.push({ code: `invalid_value`, values: t.values, input: a, inst: e }), r)
      }))
  }),
  Pr = w(`$ZodTransform`, (e, t) => {
    ;(k.init(e, t),
      (e._zod.optin = `optional`),
      E.memoizer?.guard(e),
      (e._zod.parse = (n, r) => {
        if (r.direction === `backward`) throw new qe(e.constructor.name)
        let i = t.transform(n.value, n)
        if (r.async) return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => ((n.value = e), n))
        if (i instanceof Promise) throw new T()
        return ((n.value = i), n)
      }))
  })
function Fr(e, t) {
  return ((e.value = t.issues.length ? void 0 : t.value), e)
}
const Ir = w(`$ZodOptional`, (e, t) => {
    ;(k.init(e, t),
      C(e, `optin`, (e) => (e.def.innerType._zod.optin === `defaulted` ? `defaulted` : `optional`)),
      (e._zod.optout = `optional`),
      C(e, `values`, (e) => {
        let t = e.def.innerType._zod.values
        return t ? new Set([...t, void 0]) : void 0
      }),
      C(e, `pattern`, (e) => {
        let t = e.def.innerType._zod.pattern
        return t ? RegExp(`^(${l(t.source)})?$`) : void 0
      }),
      (e._zod.parse = (e, n) => {
        if (e.value === void 0) {
          if (t.innerType._zod.optin !== `defaulted`) return e
          let r = t.innerType._zod.run({ value: e.value, issues: [] }, n)
          return r instanceof Promise ? r.then((t) => Fr(e, t)) : Fr(e, r)
        }
        return t.innerType._zod.run(e, n)
      }))
  }),
  Lr = w(`$ZodExactOptional`, (e, t) => {
    ;(Ir.init(e, t),
      C(e, `values`, (e) => e.def.innerType._zod.values),
      C(e, `pattern`, (e) => e.def.innerType._zod.pattern),
      (e._zod.parse = (e, n) => t.innerType._zod.run(e, n)))
  }),
  Rr = w(`$ZodNullable`, (e, t) => {
    ;(k.init(e, t),
      C(e, `optin`, (e) => e.def.innerType._zod.optin),
      C(e, `optout`, (e) => e.def.innerType._zod.optout),
      C(e, `pattern`, (e) => {
        let t = e.def.innerType._zod.pattern
        return t ? RegExp(`^(${l(t.source)}|null)$`) : void 0
      }),
      C(e, `values`, (e) => (e.def.innerType._zod.values ? new Set([...e.def.innerType._zod.values, null]) : void 0)),
      (e._zod.parse = (e, n) => (e.value === null ? e : t.innerType._zod.run(e, n))))
  }),
  zr = w(`$ZodDefault`, (e, t) => {
    ;(k.init(e, t),
      (e._zod.optin = `defaulted`),
      C(e, `values`, (e) => e.def.innerType._zod.values),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n)
        if (e.value === void 0) return ((e.value = t.defaultValue), e)
        let r = t.innerType._zod.run(e, n)
        return r instanceof Promise ? r.then((e) => Br(e, t)) : Br(r, t)
      }))
  })
function Br(e, t) {
  return (e.value === void 0 && (e.value = t.defaultValue), e)
}
const Vr = w(`$ZodPrefault`, (e, t) => {
    ;(k.init(e, t),
      (e._zod.optin = `defaulted`),
      C(e, `values`, (e) => e.def.innerType._zod.values),
      (e._zod.parse = (e, n) => (
        n.direction === `backward` || (e.value === void 0 && (e.value = t.defaultValue)),
        t.innerType._zod.run(e, n)
      )))
  }),
  Hr = w(`$ZodNonOptional`, (e, t) => {
    ;(k.init(e, t),
      C(e, `values`, (e) => {
        let t = e.def.innerType._zod.values
        return t ? new Set([...t].filter((e) => e !== void 0)) : void 0
      }),
      (e._zod.parse = (n, r) => {
        let i = t.innerType._zod.run(n, r)
        return i instanceof Promise ? i.then((t) => Ur(t, e)) : Ur(i, e)
      }))
  })
function Ur(e, t) {
  return (
    !e.issues.length &&
      e.value === void 0 &&
      e.issues.push({ code: `invalid_type`, expected: `nonoptional`, input: e.value, inst: t }),
    e
  )
}
function Wr(e, t, n, r) {
  return t.issues.length
    ? ((e.value = n.catchValue({
        ...t,
        value: e.value,
        error: { issues: t.issues.map((e) => x(e, r, D())) },
        input: e.value
      })),
      e)
    : ((e.value = t.value), t.memo && (e.memo = !0), e)
}
const Gr = w(`$ZodCatch`, (e, t) => {
    ;(k.init(e, t),
      C(e, `optin`, (e) => (e.def.innerType._zod.optin === `defaulted` ? `defaulted` : `optional`)),
      C(e, `optout`, (e) => e.def.innerType._zod.optout),
      C(e, `values`, (e) => e.def.innerType._zod.values),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n)
        let r = t.innerType._zod.run({ value: e.value, issues: [] }, n)
        return r instanceof Promise ? r.then((r) => Wr(e, r, t, n)) : Wr(e, r, t, n)
      }))
  }),
  Kr = w(`$ZodPipe`, (e, t) => {
    ;(k.init(e, t),
      C(e, `values`, (e) => e.def.in._zod.values),
      C(e, `optin`, (e) => e.def.in._zod.optin),
      C(e, `optout`, (e) => e.def.out._zod.optout),
      C(e, `propValues`, (e) => e.def.in._zod.propValues),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) {
          let r = t.out._zod.run(e, n)
          return r instanceof Promise ? r.then((e) => qr(e, t.in, n)) : qr(r, t.in, n)
        }
        let r = t.in._zod.run(e, n)
        return r instanceof Promise ? r.then((e) => qr(e, t.out, n)) : qr(r, t.out, n)
      }))
  })
function qr(e, t, n) {
  return e.issues.some((e) => e.code !== `unrecognized_keys`)
    ? ((e.aborted = !0), e)
    : t._zod.run({ value: e.value, issues: e.issues }, n)
}
const Jr = w(`$ZodReadonly`, (e, t) => {
  ;(k.init(e, t),
    C(e, `propValues`, (e) => e.def.innerType._zod.propValues),
    C(e, `values`, (e) => e.def.innerType._zod.values),
    C(e, `optin`, (e) => e.def.innerType?._zod?.optin),
    C(e, `optout`, (e) => e.def.innerType?._zod?.optout),
    (e._zod.parse = (e, n) => {
      if (n.direction === `backward`) return t.innerType._zod.run(e, n)
      let r = t.innerType._zod.run(e, n)
      return r instanceof Promise ? r.then(Yr) : Yr(r)
    }))
})
function Yr(e) {
  return (e.memo || (e.value = Object.freeze(e.value)), e)
}
const Xr = w(`$ZodCustom`, (e, t) => {
  ;(O.init(e, t),
    k.init(e, t),
    (e._zod.parse = (e, t) => e),
    (e._zod.check = (n) => {
      let r = n.value,
        i = t.fn(r)
      if (i instanceof Promise) return i.then((t) => Zr(t, n, r, e))
      Zr(i, n, r, e)
    }))
})
function Zr(e, t, n, r) {
  if (!e) {
    let e = { code: `custom`, input: n, inst: r, path: [...(r._zod.def.path ?? [])], continue: !r._zod.def.abort }
    ;(r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(Me(e)))
  }
}
var Qr = class extends Error {
  constructor() {
    ;(super(`Cannot parse a reference cycle that closes through a transform`), (this.name = `ZodCyclicError`))
  }
}
const $r = `~memo`,
  ei = []
function ti(e) {
  return typeof e == `object` && !!e
}
function ni(e) {
  return e.map((e) => (e.path ? { ...e, path: e.path.slice() } : { ...e }))
}
const ri = new WeakMap()
function ii(e, t, n) {
  let r = ri.get(e)
  if (r !== void 0) return r ? 2 : 0
  if (t.has(e)) return 2
  t.add(e)
  let i = 0,
    a = (e) => {
      if (i !== 2 && e?._zod) {
        let r = ii(e, t, n)
        r > i && (i = r)
      }
    },
    o = (e, r) => {
      let i = 0
      for (let a of Reflect.ownKeys(e)) {
        let o = Object.getOwnPropertyDescriptor(e, a)
        if (r && !o.enumerable) continue
        let s = o.get ? 1 : o.value?._zod ? ii(o.value, t, n) : 0
        s > i && (i = s)
      }
      return i
    },
    s = (e) => {
      e > i && (i = e)
    },
    c = e._zod.def
  switch (c.type) {
    case `object`: {
      let e = f(c)
      ;(s(e ? o(e, !0) : 1), a(c.catchall))
      break
    }
    case `array`:
      a(c.element)
      break
    case `tuple`:
      for (let e of c.items) a(e)
      a(c.rest)
      break
    case `record`:
    case `map`:
      ;(a(c.keyType), a(c.valueType))
      break
    case `set`:
      a(c.valueType)
      break
    case `union`:
      for (let e of c.options) a(e)
      break
    case `intersection`:
      ;(a(c.left), a(c.right))
      break
    case `optional`:
    case `nullable`:
    case `default`:
    case `prefault`:
    case `catch`:
    case `readonly`:
    case `nonoptional`:
    case `promise`:
    case `success`:
      a(c.innerType)
      break
    case `pipe`:
      ;(a(c.in), a(c.out))
      break
    case `function`:
      ;(a(c.input), a(c.output))
      break
    case `lazy`: {
      let r = c._cachedInner ?? (n ? e._zod.innerType : void 0)
      s(r ? ii(r, t, !1) : 1)
      break
    }
    case `template_literal`:
    case `string`:
    case `number`:
    case `int`:
    case `boolean`:
    case `bigint`:
    case `symbol`:
    case `undefined`:
    case `null`:
    case `void`:
    case `never`:
    case `any`:
    case `unknown`:
    case `date`:
    case `nan`:
    case `enum`:
    case `literal`:
    case `file`:
    case `transform`:
    case `custom`:
      break
    default:
      for (let e in c) {
        let t = Object.getOwnPropertyDescriptor(c, e)
        if (!t || t.get) continue
        let n = t.value
        if (!(!n || typeof n != `object`)) {
          if (n._zod) a(n)
          else if (Array.isArray(n)) for (let e of n) a(e)
        }
      }
  }
  return (t.delete(e), ai(e, i))
}
function ai(e, t) {
  return (t !== 1 && ri.set(e, t === 2), t)
}
function oi(e, t) {
  let n = e.buckets.get(t)
  return (n || ((n = new WeakMap()), e.buckets.set(t, n)), n)
}
let si
const ci = [],
  li = {
    alloc(e, t, n) {
      let r = si
      if (!r) return n
      si = void 0
      let i = { value: n, issues: null }
      return (r.set(t.value, i), ci.push(i), n)
    },
    guard(e) {
      var t
      ;((t = e._zod).deferred ?? (t.deferred = []),
        e._zod.deferred.push(() => {
          let t = e._zod.parse,
            n = (e, n) => {
              if (n.direction !== `backward` && di(n, e.value)) throw new Qr()
              return t(e, n)
            }
          ;((e._zod.parse = n), e._zod.run === t && (e._zod.run = n))
        }))
    },
    attach(e) {
      var t
      let n,
        r = !1,
        i,
        a
      ;((t = e._zod).deferred ?? (t.deferred = []),
        e._zod.deferred.push(() => {
          let t = e._zod.parse,
            o = (s, c) => {
              if (n === void 0) {
                let i = ii(e, new Set(), !1)
                if (i === 0) return ((e._zod.parse = t), e._zod.run === o && (e._zod.run = t), t(s, c))
                i === 2 || r ? (n = !0) : (r = !0)
              }
              let l = s.value
              if (!ti(l)) return t(s, c)
              let u = c[$r]
              u || ((u = { buckets: new WeakMap(), backEdges: void 0 }), (c[$r] = u))
              let d
              i === c ? (d = a) : ((d = oi(u, e)), (i = c), (a = d))
              let f = d.get(l)
              if (f)
                return (
                  (s.value = f.value),
                  f.issues
                    ? f.issues.length && s.issues.push(...ni(f.issues))
                    : ((s.memo = !0), u.backEdges ?? (u.backEdges = new WeakSet()), u.backEdges.add(f.value)),
                  s
                )
              si = d
              let p = ci.length,
                m = t(s, c)
              si = void 0
              let ee = ci.length > p ? ci.pop() : void 0
              return m instanceof Promise
                ? m.then((e) => (ee && (ee.issues = e.issues.length ? ni(e.issues) : ei), e))
                : (ee && (ee.issues = m.issues.length ? ni(m.issues) : ei), m)
            }
          ;((e._zod.parse = o), e._zod.run === t && (e._zod.run = o))
        }))
    }
  }
function ui() {
  return li
}
function di(e, t) {
  let n = e[$r]?.backEdges
  return n !== void 0 && ti(t) && n.has(t)
}
const fi = () => {
  let e = {
    string: { unit: `characters`, verb: `to have` },
    file: { unit: `bytes`, verb: `to have` },
    array: { unit: `items`, verb: `to have` },
    set: { unit: `items`, verb: `to have` },
    map: { unit: `entries`, verb: `to have` }
  }
  function t(t) {
    return e[t] ?? null
  }
  let n = {
      regex: `input`,
      email: `email address`,
      url: `URL`,
      emoji: `emoji`,
      uuid: `UUID`,
      uuidv4: `UUIDv4`,
      uuidv6: `UUIDv6`,
      nanoid: `nanoid`,
      guid: `GUID`,
      cuid: `cuid`,
      cuid2: `cuid2`,
      ulid: `ULID`,
      xid: `XID`,
      ksuid: `KSUID`,
      datetime: `ISO datetime`,
      date: `ISO date`,
      time: `ISO time`,
      duration: `ISO duration`,
      ipv4: `IPv4 address`,
      ipv6: `IPv6 address`,
      mac: `MAC address`,
      cidrv4: `IPv4 range`,
      cidrv6: `IPv6 range`,
      base64: `base64-encoded string`,
      base64url: `base64url-encoded string`,
      json_string: `JSON string`,
      e164: `E.164 number`,
      currency_code: `currency code`,
      credit_card: `credit card number`,
      iban: `IBAN`,
      jwt: `JWT`,
      template_literal: `input`
    },
    r = { nan: `NaN` }
  function a(e, t) {
    return e === `number` && typeof t == `number` && !Number.isFinite(t) ? String(t) : (r[e] ?? e)
  }
  return (e) => {
    switch (e.code) {
      case `invalid_type`:
        return `Invalid input: expected ${a(e.expected)}, received ${a(je(e.input), e.input)}`
      case `invalid_value`:
        return e.values.length === 1
          ? `Invalid input: expected ${de(e.values[0])}`
          : `Invalid option: expected one of ${i(e.values, `|`)}`
      case `too_big`: {
        let n = e.exact ? `exactly ` : e.inclusive ? `<=` : `<`,
          r = t(e.origin)
        return r
          ? `Too big: expected ${e.origin ?? `value`} to have ${n}${e.maximum.toString()} ${r.unit ?? `elements`}`
          : `Too big: expected ${e.origin ?? `value`} to be ${n}${e.maximum.toString()}`
      }
      case `too_small`: {
        let n = e.exact ? `exactly ` : e.inclusive ? `>=` : `>`,
          r = t(e.origin)
        return r
          ? `Too small: expected ${e.origin} to have ${n}${e.minimum.toString()} ${r.unit}`
          : `Too small: expected ${e.origin} to be ${n}${e.minimum.toString()}`
      }
      case `invalid_format`: {
        let t = e
        return t.format === `starts_with`
          ? `Invalid string: must start with "${t.prefix}"`
          : t.format === `ends_with`
            ? `Invalid string: must end with "${t.suffix}"`
            : t.format === `includes`
              ? `Invalid string: must include "${t.includes}"`
              : t.format === `regex`
                ? `Invalid string: must match pattern ${t.pattern}`
                : `Invalid ${n[t.format] ?? e.format}`
      }
      case `not_multiple_of`:
        return `Invalid number: must be a multiple of ${e.divisor}`
      case `unrecognized_keys`:
        return `Unrecognized key${e.keys.length > 1 ? `s` : ``}: ${i(e.keys, `, `)}`
      case `invalid_key`:
        return `Invalid key in ${e.origin}`
      case `invalid_union`:
        return e.options && Array.isArray(e.options) && e.options.length > 0
          ? `Invalid discriminator value. Expected ${e.options.map((e) => `'${e}'`).join(` | `)}`
          : e.inclusive === !1
            ? `Invalid input: more than one option matched`
            : `Invalid input`
      case `invalid_element`:
        return `Invalid value in ${e.origin}`
      default:
        return `Invalid input`
    }
  }
}
function pi() {
  return { localeError: fi() }
}
var mi,
  hi = class {
    constructor() {
      ;((this._map = new WeakMap()), (this._idmap = new Map()))
    }
    add(e, ...t) {
      let n = t[0]
      return (this._map.set(e, n), n && typeof n == `object` && `id` in n && this._idmap.set(n.id, e), this)
    }
    clear() {
      return ((this._map = new WeakMap()), (this._idmap = new Map()), this)
    }
    remove(e) {
      let t = this._map.get(e)
      return (t && typeof t == `object` && `id` in t && this._idmap.delete(t.id), this._map.delete(e), this)
    }
    get(e) {
      let t = e._zod.parent
      if (t) {
        let n = { ...(this.get(t) ?? {}) }
        delete n.id
        let r = { ...n, ...this._map.get(e) }
        return Object.keys(r).length ? r : void 0
      }
      return this._map.get(e)
    }
    has(e) {
      return this._map.has(e)
    }
  }
function gi() {
  return new hi()
}
;(mi = globalThis).__zod_globalRegistry ?? (mi.__zod_globalRegistry = gi())
const _i = globalThis.__zod_globalRegistry
function vi(e) {
  return ((e.checks &&= [...e.checks]), e)
}
function yi(e, t) {
  return new e(vi({ type: `string`, ...v(t) }))
}
function bi(e, t) {
  return new e({ type: `string`, format: `email`, check: `string_format`, abort: !1, ...v(t) })
}
function xi(e, t) {
  return new e({ type: `string`, format: `guid`, check: `string_format`, abort: !1, ...v(t) })
}
function Si(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, ...v(t) })
}
function Ci(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v4`, ...v(t) })
}
function wi(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v6`, ...v(t) })
}
function Ti(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v7`, ...v(t) })
}
function Ei(e, t) {
  return new e({ type: `string`, format: `url`, check: `string_format`, abort: !1, ...v(t) })
}
function Di(e, t) {
  return new e({ type: `string`, format: `emoji`, check: `string_format`, abort: !1, ...v(t) })
}
function Oi(e, t) {
  return new e({ type: `string`, format: `nanoid`, check: `string_format`, abort: !1, ...v(t) })
}
function ki(e, t) {
  return new e({ type: `string`, format: `cuid`, check: `string_format`, abort: !1, ...v(t) })
}
function Ai(e, t) {
  return new e({ type: `string`, format: `cuid2`, check: `string_format`, abort: !1, ...v(t) })
}
function ji(e, t) {
  return new e({ type: `string`, format: `ulid`, check: `string_format`, abort: !1, ...v(t) })
}
function Mi(e, t) {
  return new e({ type: `string`, format: `xid`, check: `string_format`, abort: !1, ...v(t) })
}
function Ni(e, t) {
  return new e({ type: `string`, format: `ksuid`, check: `string_format`, abort: !1, ...v(t) })
}
function Pi(e, t) {
  return new e({ type: `string`, format: `ipv4`, check: `string_format`, abort: !1, ...v(t) })
}
function Fi(e, t) {
  return new e({ type: `string`, format: `ipv6`, check: `string_format`, abort: !1, ...v(t) })
}
function Ii(e, t) {
  return new e({ type: `string`, format: `cidrv4`, check: `string_format`, abort: !1, ...v(t) })
}
function Li(e, t) {
  return new e({ type: `string`, format: `cidrv6`, check: `string_format`, abort: !1, ...v(t) })
}
function Ri(e, t) {
  return new e({ type: `string`, format: `base64`, check: `string_format`, abort: !1, ...v(t) })
}
function zi(e, t) {
  return new e({ type: `string`, format: `base64url`, check: `string_format`, abort: !1, ...v(t) })
}
function Bi(e, t) {
  return new e({ type: `string`, format: `e164`, check: `string_format`, abort: !1, ...v(t) })
}
function Vi(e, t) {
  return new e({ type: `string`, format: `jwt`, check: `string_format`, abort: !1, ...v(t) })
}
function Hi(e, t) {
  return new e({
    type: `string`,
    format: `datetime`,
    check: `string_format`,
    offset: !1,
    local: !1,
    precision: null,
    ...v(t)
  })
}
function Ui(e, t) {
  return new e({ type: `string`, format: `date`, check: `string_format`, ...v(t) })
}
function Wi(e, t) {
  return new e({ type: `string`, format: `time`, check: `string_format`, precision: null, ...v(t) })
}
function Gi(e, t) {
  return new e({ type: `string`, format: `duration`, check: `string_format`, ...v(t) })
}
function Ki(e, t) {
  return new e(vi({ type: `number`, checks: [], ...v(t) }))
}
function qi(e, t) {
  return new e({ type: `number`, check: `number_format`, abort: !1, format: `safeint`, ...v(t) })
}
function Ji(e, t) {
  return new e({ type: `boolean`, ...v(t) })
}
function Yi(e) {
  return new e({ type: `unknown` })
}
function Xi(e, t) {
  return new e({ type: `never`, ...v(t) })
}
function Zi(e, t) {
  return new rn({ check: `less_than`, ...v(t), value: e, inclusive: !1 })
}
function Qi(e, t) {
  return new rn({ check: `less_than`, ...v(t), value: e, inclusive: !0 })
}
function $i(e, t) {
  return new an({ check: `greater_than`, ...v(t), value: e, inclusive: !1 })
}
function ea(e, t) {
  return new an({ check: `greater_than`, ...v(t), value: e, inclusive: !0 })
}
function ta(e, t) {
  return new on({ check: `multiple_of`, ...v(t), value: e })
}
function na(e, t) {
  return new cn({ check: `max_length`, ...v(t), maximum: e })
}
function ra(e, t) {
  return new ln({ check: `min_length`, ...v(t), minimum: e })
}
function ia(e, t) {
  return new un({ check: `length_equals`, ...v(t), length: e })
}
function aa(e, t) {
  return new fn({ check: `string_format`, format: `regex`, ...v(t), pattern: e })
}
function oa(e) {
  return new pn({ check: `string_format`, format: `lowercase`, ...v(e) })
}
function sa(e) {
  return new mn({ check: `string_format`, format: `uppercase`, ...v(e) })
}
function ca(e, t) {
  return new hn({ check: `string_format`, format: `includes`, ...v(t), includes: e })
}
function la(e, t) {
  return new gn({ check: `string_format`, format: `starts_with`, ...v(t), prefix: e })
}
function ua(e, t) {
  return new _n({ check: `string_format`, format: `ends_with`, ...v(t), suffix: e })
}
function j(e) {
  return new vn({ check: `overwrite`, tx: e })
}
function da(e) {
  return j((t) => t.normalize(e))
}
function fa() {
  return j((e) => e.trim())
}
function pa() {
  return j((e) => e.toLowerCase())
}
function ma() {
  return j((e) => e.toUpperCase())
}
function ha() {
  return j((e) => re(e))
}
function ga(e, t, n) {
  return new e({ type: `array`, element: t, ...v(n) })
}
function _a(e, t, n) {
  return new e({ type: `custom`, check: `custom`, fn: t, ...v(n) })
}
function va(e, t) {
  let n = ya(
    (t) => (
      (t.addIssue = (e) => {
        if (typeof e == `string`) t.issues.push(Me(e, t.value, n._zod.def))
        else {
          let r = e
          ;(r.fatal && (r.continue = !1),
            (r.code ??= `custom`),
            `input` in r || (r.input = t.value),
            (r.inst ??= n),
            (r.continue ??= !n._zod.def.abort),
            t.issues.push(Me(r)))
        }
      }),
      e(t.value, t)
    ),
    t
  )
  return n
}
function ya(e, t) {
  let n = new O({ check: `custom`, ...v(t) })
  return ((n._zod.check = e), n)
}
function ba(e, ...t) {
  for (let n of t) for (let t of Reflect.ownKeys(n)) Object.prototype.propertyIsEnumerable.call(n, t) && d(e, t, n[t])
  return e
}
function xa(e) {
  let t = e?.target ?? `draft-2020-12`
  return (
    t === `draft-4` && (t = `draft-04`),
    t === `draft-7` && (t = `draft-07`),
    {
      processors: e.processors ?? {},
      metadataRegistry: e?.metadata ?? _i,
      target: t,
      unrepresentable: e?.unrepresentable ?? `throw`,
      override: e?.override ?? (() => {}),
      io: e?.io ?? `output`,
      counter: 0,
      seen: new Map(),
      sharedDefsExtractedFor: void 0,
      sharedEmitDoneFor: void 0,
      cycles: e?.cycles ?? `ref`,
      reused: e?.reused ?? `inline`,
      intersections: [],
      deferred: [],
      external: e?.external ?? void 0
    }
  )
}
function M(e, t, n, r, i) {
  let a =
    typeof t.unrepresentable == `function`
      ? t.unrepresentable({ zodSchema: e, path: r.path, message: i })
      : t.unrepresentable
  if (a === `any`) return !1
  if (a === void 0 || a === `throw`) throw Error(i)
  return (Object.assign(n, a), !0)
}
function N(e, t, n = { path: [], schemaPath: [] }) {
  var r
  let i = e._zod.def,
    a = t.seen.get(e)
  if (a) return (a.count++, n.schemaPath.includes(e) && (a.cycle = n.path), a.schema)
  let o = { schema: {}, count: 1, cycle: void 0, path: n.path }
  ;(t.seen.set(e, o), (t.sharedDefsExtractedFor = void 0), (t.sharedEmitDoneFor = void 0))
  let s = e._zod.toJSONSchema?.()
  if (s) o.schema = s
  else {
    let r = { ...n, schemaPath: [...n.schemaPath, e], path: n.path }
    if (e._zod.processJSONSchema) e._zod.processJSONSchema(t, o.schema, r)
    else {
      let n = o.schema,
        a = t.processors[i.type]
      if (!a) throw Error(`[toJSONSchema]: Non-representable type encountered: ${i.type}`)
      a(e, t, n, r)
    }
    let a = e._zod.parent
    a && ((o.ref ||= a), N(a, t, r), (t.seen.get(a).isParent = !0))
  }
  let c = t.metadataRegistry.get(e)
  return (
    c && ba(o.schema, c),
    t.io === `input` && P(e) && (delete o.schema.examples, delete o.schema.default),
    t.io === `input` && `_prefault` in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)),
    delete o.schema._prefault,
    t.seen.get(e).schema
  )
}
function Sa(e) {
  return e.replace(/~/g, `~0`).replace(/\//g, `~1`)
}
function Ca(e, t) {
  let n = e.seen.get(t)
  if (!n) throw Error(`Unprocessed schema. This is a bug in Zod.`)
  if (e.external && e.sharedDefsExtractedFor === e.external) return
  let r = new Map()
  for (let t of e.seen.entries()) {
    let n = e.metadataRegistry.get(t[0])?.id
    if (n) {
      let e = r.get(n)
      if (e && e !== t[0])
        throw Error(
          `Duplicate schema id "${n}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`
        )
      r.set(n, t[0])
    }
  }
  let i = (t) => {
      let r = e.target === `draft-2020-12` ? `$defs` : `definitions`
      if (e.external) {
        let n = e.external.registry.get(t[0])?.id,
          i = e.external.uri ?? ((e) => e)
        if (n) return { ref: i(n) }
        let a = t[1].defId ?? t[1].schema.id ?? `schema${e.counter++}`
        return ((t[1].defId = a), { defId: a, ref: `${i(`__shared`)}#/${r}/${Sa(a)}` })
      }
      let i = `#/${r}/`
      if (t[1] === n && !t[1].schema.id) return { ref: `#` }
      let a = t[1].schema.id ?? `__schema${e.counter++}`
      return { defId: a, ref: i + Sa(a) }
    },
    a = (e) => {
      if (e[1].schema.$ref) return
      let t = e[1],
        { ref: n, defId: r } = i(e)
      ;((t.def = { ...t.schema }), r && (t.defId = r))
      let a = t.schema
      for (let e in a) delete a[e]
      a.$ref = n
    }
  if (e.cycles === `throw`)
    for (let t of e.seen.entries()) {
      let e = t[1]
      if (e.cycle)
        throw Error(`Cycle detected: #/${e.cycle?.join(`/`)}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`)
    }
  for (let n of e.seen.entries()) {
    let r = n[1]
    if (t === n[0]) {
      a(n)
      continue
    }
    if (e.external) {
      let r = e.external.registry.get(n[0])?.id
      if (t !== n[0] && r) {
        a(n)
        continue
      }
    }
    if (e.metadataRegistry.get(n[0])?.id) {
      a(n)
      continue
    }
    if (r.cycle) {
      a(n)
      continue
    }
    r.count > 1 && e.reused === `ref` && a(n)
  }
  e.external && (e.sharedDefsExtractedFor = e.external)
}
function wa(e) {
  let t = e.anyOf
  if (!Array.isArray(t) || t.length === 0 || e.type !== void 0) return
  let n = []
  for (let e of t) {
    if (!e || typeof e != `object`) return
    wa(e)
    let t = Object.keys(e)
    if (t.length !== 1 || t[0] !== `type`) return
    let r = e.type
    for (let e of Array.isArray(r) ? r : [r]) {
      if (typeof e != `string`) return
      n.includes(e) || n.push(e)
    }
  }
  ;(delete e.anyOf, (e.type = n.length === 1 ? n[0] : n))
}
const Ta = new Set([`type`, `properties`, `required`, `additionalProperties`]),
  Ea = [`oneOf`, `anyOf`]
function Da(e) {
  let t = e.additionalProperties
  return t === void 0 || t === !1 || typeof t != `object` || !t ? null : Object.keys(t).length ? t : null
}
function Oa(e) {
  let t = []
  for (let n of e) {
    if (typeof n != `object` || n.type !== `object`) return null
    for (let e in n) if (!Ta.has(e)) return null
    t.push(n)
  }
  let n = {},
    r = new Set()
  for (let e of t) {
    for (let r in e.properties) {
      if (Object.prototype.hasOwnProperty.call(n, r)) continue
      let e = []
      for (let n of t) {
        let t = n.properties?.[r] ?? Da(n)
        t != null && (e.some((e) => JSON.stringify(e) === JSON.stringify(t)) || e.push(t))
      }
      d(n, r, e.length === 1 ? e[0] : (Oa(e) ?? { allOf: e }))
    }
    for (let t of e.required ?? []) r.add(t)
  }
  let i = { type: `object`, properties: n }
  if ((r.size && (i.required = [...r]), t.every((e) => e.additionalProperties === !1))) i.additionalProperties = !1
  else {
    let e = []
    for (let n of t) {
      let t = Da(n)
      t && !e.some((e) => JSON.stringify(e) === JSON.stringify(t)) && e.push(t)
    }
    e.length === 1 ? (i.additionalProperties = e[0]) : e.length > 1 && (i.additionalProperties = { allOf: e })
  }
  return i
}
function ka(e) {
  let t = e.allOf
  if (!Array.isArray(t) || t.length < 2) return
  for (let t of Ta) if (t in e) return
  let n = t.filter((e) => Ea.some((t) => Array.isArray(e[t]))),
    r = null
  if (!n.length) r = Oa(t)
  else {
    let e = n[0],
      i = Ea.find((t) => Array.isArray(e[t]))
    if (Object.keys(e).length !== 1) return
    let a = t.filter((t) => t !== e),
      o = e[i].map((e) => Oa([...a, e]))
    if (o.some((e) => !e)) return
    r = { [i]: o }
  }
  r && (delete e.allOf, ba(e, r))
}
function Aa(e, t) {
  let n = e.seen.get(t)
  if (!n) throw Error(`Unprocessed schema. This is a bug in Zod.`)
  let r = (t) => {
    let n = e.seen.get(t)
    if (n.ref === null) return
    let i = n.def ?? n.schema,
      a = { ...i },
      o = n.ref
    if (((n.ref = null), o)) {
      r(o)
      let n = e.seen.get(o),
        s = n.schema
      if (
        (s.$ref && (e.target === `draft-07` || e.target === `draft-04` || e.target === `openapi-3.0`)
          ? ((i.allOf = i.allOf ?? []), i.allOf.push(s))
          : ba(i, s),
        ba(i, a),
        t._zod.parent === o)
      )
        for (let e in i) e !== `$ref` && e !== `allOf` && (e in a || delete i[e])
      if (s.$ref && n.def)
        for (let e in i)
          e !== `$ref` &&
            e !== `allOf` &&
            e in n.def &&
            JSON.stringify(i[e]) === JSON.stringify(n.def[e]) &&
            delete i[e]
    }
    let s = t._zod.parent
    if (s && s !== o) {
      r(s)
      let t = e.seen.get(s)
      if (t?.schema.$ref && ((i.$ref = t.schema.$ref), t.def))
        for (let e in i)
          e !== `$ref` &&
            e !== `allOf` &&
            e in t.def &&
            JSON.stringify(i[e]) === JSON.stringify(t.def[e]) &&
            delete i[e]
    }
    e.override({ zodSchema: t, jsonSchema: i, path: n.path ?? [] })
  }
  if (!e.external || e.sharedEmitDoneFor !== e.external) {
    for (let t of [...e.seen.entries()].reverse()) r(t[0])
    if (e.target !== `openapi-3.0`) for (let t of e.seen.entries()) wa(t[1].def ?? t[1].schema)
    for (let t of e.deferred) t()
    if (e.intersections.length) {
      let t = new Map()
      for (let n of e.seen.values())
        for (let e of [n.schema, n.def]) {
          let n = e?.allOf
          if (!Array.isArray(n)) continue
          let r = t.get(n)
          r ? r.push(e) : t.set(n, [e])
        }
      for (let n of e.intersections) for (let e of t.get(n) ?? []) ka(e)
    }
  }
  let i = {}
  if (
    (e.target === `draft-2020-12`
      ? (i.$schema = `https://json-schema.org/draft/2020-12/schema`)
      : e.target === `draft-07`
        ? (i.$schema = `http://json-schema.org/draft-07/schema#`)
        : e.target === `draft-04`
          ? (i.$schema = `http://json-schema.org/draft-04/schema#`)
          : e.target,
    e.external?.uri)
  ) {
    let n = e.external.registry.get(t)?.id
    if (!n) throw Error('Schema is missing an `id` property')
    i.$id = e.external.uri(n)
  }
  ba(i, n.defId ? n.schema : (n.def ?? n.schema))
  let a = e.metadataRegistry.get(t)?.id
  a !== void 0 && i.id === a && delete i.id
  let o = e.external?.defs ?? {}
  if (!e.external || e.sharedEmitDoneFor !== e.external)
    for (let t of e.seen.entries()) {
      let e = t[1]
      e.def && e.defId && (e.def.id === e.defId && delete e.def.id, d(o, e.defId, e.def))
    }
  ;(e.external && (e.sharedEmitDoneFor = e.external),
    e.external || (Object.keys(o).length > 0 && (e.target === `draft-2020-12` ? (i.$defs = o) : (i.definitions = o))))
  try {
    let n = JSON.parse(JSON.stringify(i))
    return (
      Object.defineProperty(n, '~standard', {
        value: {
          ...t[`~standard`],
          jsonSchema: { input: Ma(t, `input`, e.processors), output: Ma(t, `output`, e.processors) }
        },
        enumerable: !1,
        writable: !1
      }),
      n
    )
  } catch {
    throw Error(`Error converting schema to JSON.`)
  }
}
function P(e, t) {
  let n = t ?? { seen: new Set() }
  if (n.seen.has(e)) return !1
  n.seen.add(e)
  let r = e._zod.def
  if (r.type === `transform`) return !0
  if (r.type === `array`) return P(r.element, n)
  if (r.type === `set`) return P(r.valueType, n)
  if (r.type === `lazy`) return P(r.getter(), n)
  if (
    r.type === `promise` ||
    r.type === `optional` ||
    r.type === `nonoptional` ||
    r.type === `nullable` ||
    r.type === `readonly` ||
    r.type === 'default' ||
    r.type === `prefault` ||
    r.type === `catch`
  )
    return P(r.innerType, n)
  if (r.type === `intersection`) return P(r.left, n) || P(r.right, n)
  if (r.type === `record` || r.type === `map`) return P(r.keyType, n) || P(r.valueType, n)
  if (r.type === `pipe`) return e._zod.traits.has(`$ZodCodec`) ? !0 : P(r.in, n) || P(r.out, n)
  if (r.type === `object`) {
    for (let e in r.shape) if (P(r.shape[e], n)) return !0
    return !1
  }
  if (r.type === `union`) {
    for (let e of r.options) if (P(e, n)) return !0
    return !1
  }
  if (r.type === `tuple`) {
    for (let e of r.items) if (P(e, n)) return !0
    return !!(r.rest && P(r.rest, n))
  }
  return !1
}
const ja =
    (e, t = {}) =>
    (n) => {
      let r = xa({ ...n, processors: t })
      return (N(e, r), Ca(r, e), Aa(r, e))
    },
  Ma =
    (e, t, n = {}) =>
    (r) => {
      let { libraryOptions: i, target: a } = r ?? {},
        o = xa({ ...(i ?? {}), target: a, io: t, processors: n })
      return (N(e, o), Ca(o, e), Aa(o, e))
    },
  F = (e, t, n) => {
    ;(e[t] === void 0 || n > e[t]) && (e[t] = n)
  },
  I = (e, t, n) => {
    ;(e[t] === void 0 || n < e[t]) && (e[t] = n)
  },
  Na = (e, t) => {
    ;(F(e, `minimum`, t), I(e, `maximum`, t))
  },
  Pa = (e, t) => {
    ;((e.multipleOf ??= []), e.multipleOf.includes(t) || e.multipleOf.push(t))
  },
  Fa = (e, t) => {
    ;((e.patterns ??= new Set()), e.patterns.add(t))
  },
  Ia = (e, t) => {
    e.mime = e.mime ? e.mime.filter((e) => t.includes(e)) : [...t]
  },
  La = (e, t) => {
    ;((e.format = t), t.includes(`int`) && (e.isInt = !0))
  },
  Ra = (e, t) => F(e, `minimum`, t.minimum),
  za = (e, t) => I(e, `maximum`, t.maximum),
  Ba = (e) => (t, n) => {
    La(t, n.format)
    let [r, i] = e[n.format]
    ;(F(t, `minimum`, r), I(t, `maximum`, i))
  },
  Va = {
    greater_than: (e, t) => F(e, t.inclusive ? `minimum` : `exclusiveMinimum`, t.value),
    less_than: (e, t) => I(e, t.inclusive ? `maximum` : `exclusiveMaximum`, t.value),
    multiple_of: (e, t) => Pa(e, t.value),
    number_format: Ba(pe),
    bigint_format: Ba(me),
    min_length: Ra,
    max_length: za,
    length_equals: (e, t) => Na(e, t.length),
    min_size: Ra,
    max_size: za,
    size_equals: (e, t) => Na(e, t.size),
    string_format: (e, t) => {
      ;(La(e, t.format),
        t.pattern && Fa(e, t.pattern),
        (t.format === `base64` || t.format === `base64url`) && (e.contentEncoding = t.format),
        (t.local || t.precision === -1) && (e.laxFormat = !0))
    },
    mime_type: (e, t) => Ia(e, t.mime)
  }
function L(e) {
  let t = {},
    n = e._zod.def,
    r = e._zod.traits.has(`$ZodCheck`) ? [e, ...(n.checks ?? [])] : (n.checks ?? [])
  for (let e of r) Va[e._zod.def.check]?.(t, e._zod.def)
  let i = e._zod.bag
  ;(i.minimum !== void 0 && F(t, `minimum`, i.minimum),
    i.exclusiveMinimum !== void 0 && F(t, `exclusiveMinimum`, i.exclusiveMinimum),
    i.maximum !== void 0 && I(t, `maximum`, i.maximum),
    i.exclusiveMaximum !== void 0 && I(t, `exclusiveMaximum`, i.exclusiveMaximum),
    i.multipleOf !== void 0 && Pa(t, i.multipleOf),
    i.format !== void 0 && ((t.format ??= i.format), i.format.includes(`int`) && (t.isInt = !0)),
    i.mime && Ia(t, i.mime))
  for (let e of i.patterns ?? []) Fa(t, e)
  return t
}
const Ha = { guid: `uuid`, url: `uri`, datetime: `date-time`, json_string: `json-string`, regex: `` },
  Ua = new Map([
    [tr, zt],
    [rr, Bt]
  ]),
  Wa = (e) => Ua.get(e) ?? e,
  Ga = (e, t, n, r) => {
    let i = n
    i.type = `string`
    let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l, laxFormat: u } = L(e)
    if (
      (typeof a == `number` && (i.minLength = a),
      typeof o == `number` && (i.maxLength = o),
      s && ((i.format = Ha[s] ?? s), i.format === `` && delete i.format, (s === `time` || u) && delete i.format),
      l && (i.contentEncoding = l),
      c && c.size > 0)
    ) {
      let e = [...c].map(Wa)
      e.length === 1
        ? (i.pattern = e[0].source)
        : e.length > 1 &&
          (i.allOf = [
            ...e.map((e) => ({
              ...(t.target === `draft-07` || t.target === `draft-04` || t.target === `openapi-3.0`
                ? { type: `string` }
                : {}),
              pattern: e.source
            }))
          ])
    }
  },
  Ka = (e, t, n, r) => {
    let i = n,
      { minimum: a, maximum: o, multipleOf: s, exclusiveMaximum: c, exclusiveMinimum: l, isInt: u } = L(e)
    i.type = u ? `integer` : `number`
    let d = typeof l == `number` && l >= (a ?? -1 / 0),
      f = typeof c == `number` && c <= (o ?? 1 / 0),
      p = t.target === `draft-04` || t.target === `openapi-3.0`
    if (
      (d
        ? p
          ? ((i.minimum = l), (i.exclusiveMinimum = !0))
          : (i.exclusiveMinimum = l)
        : typeof a == `number` && (i.minimum = a),
      f
        ? p
          ? ((i.maximum = c), (i.exclusiveMaximum = !0))
          : (i.exclusiveMaximum = c)
        : typeof o == `number` && (i.maximum = o),
      s)
    ) {
      let n = new Set()
      for (let a of s)
        Number.isFinite(a) && a !== 0
          ? n.add(Math.abs(a))
          : M(e, t, i, r, `A multipleOf divisor of ${a} cannot be represented in JSON Schema`)
      let [a, ...o] = n
      ;(a !== void 0 && (i.multipleOf = a),
        o.length && (i.allOf = [...(i.allOf ?? []), ...o.map((e) => ({ multipleOf: e }))]))
    }
  },
  qa = (e, t, n, r) => {
    n.type = `boolean`
  },
  Ja = (e, t, n, r) => {
    n.not = {}
  },
  Ya = (e, t, n, i) => {
    let a = e._zod.def,
      o = r(a.entries)
    if (o.length === 0) {
      n.not = {}
      return
    }
    ;(o.every((e) => typeof e == `number`) && (n.type = `number`),
      o.every((e) => typeof e == `string`) && (n.type = `string`),
      (n.enum = o))
  },
  Xa = (e, t, n, r) => {
    let i = e._zod.def
    if (i.values.length === 0) {
      n.not = {}
      return
    }
    let a = []
    for (let o of i.values)
      if (o === void 0) {
        if (M(e, t, n, r, 'Literal `undefined` cannot be represented in JSON Schema')) return
      } else if (typeof o == `bigint`) {
        if (M(e, t, n, r, `BigInt literals cannot be represented in JSON Schema`)) return
        a.push(Number(o))
      } else a.push(o)
    if (a.length !== 0) {
      if (a.length === 1) {
        let e = a[0]
        ;((n.type = e === null ? `null` : typeof e),
          t.target === `draft-04` || t.target === `openapi-3.0` ? (n.enum = [e]) : (n.const = e))
      } else
        (a.every((e) => typeof e == `number`) && (n.type = `number`),
          a.every((e) => typeof e == `string`) && (n.type = `string`),
          a.every((e) => typeof e == `boolean`) && (n.type = `boolean`),
          a.every((e) => e === null) && (n.type = `null`),
          (n.enum = a))
    }
  },
  Za = (e, t, n, r) => {
    M(e, t, n, r, `Custom types cannot be represented in JSON Schema`)
  },
  Qa = (e, t, n, r) => {
    M(e, t, n, r, `Transforms cannot be represented in JSON Schema`)
  },
  $a = (e, t, n, r) => {
    let i = n,
      a = e._zod.def,
      { minimum: o, maximum: s } = L(e)
    ;(typeof o == `number` && (i.minItems = o),
      typeof s == `number` && (i.maxItems = s),
      (i.type = `array`),
      (i.items = N(a.element, t, { ...r, path: [...r.path, `items`] })))
  }
function eo(e) {
  let t = e._zod.def
  return t.type === `pipe` && t.in._zod.traits.has(`$ZodTransform`)
    ? eo(t.out)
    : t.type === `catch`
      ? eo(t.innerType)
      : e._zod.optin
}
const to = (e, t, n, r) => {
    let i = n,
      a = e._zod.def,
      o = a.shape
    if (Object.getOwnPropertySymbols(o).length && M(e, t, i, r, `Symbol keys cannot be represented in JSON Schema`))
      return
    ;((i.type = `object`), (i.properties = {}))
    for (let e in o) d(i.properties, e, N(o[e], t, { ...r, path: [...r.path, `properties`, e] }))
    let s = []
    for (let e of Object.keys(o)) {
      let n = a.shape[e]
      ;(t.io === `input` ? eo(n) === void 0 : n._zod.optout === void 0) && s.push(e)
    }
    ;(s.length > 0 && (i.required = s),
      a.catchall?._zod.def.type === `never`
        ? (i.additionalProperties = !1)
        : a.catchall
          ? a.catchall &&
            (i.additionalProperties = N(a.catchall, t, { ...r, path: [...r.path, `additionalProperties`] }))
          : t.io === `output` && (i.additionalProperties = !1))
  },
  no = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.inclusive === !1,
      o = i.options.map((e, n) => N(e, t, { ...r, path: [...r.path, a ? `oneOf` : `anyOf`, n] }))
    a ? (n.oneOf = o) : (n.anyOf = o)
  },
  ro = (e, t, n, r) => {
    let i = e._zod.def,
      a = N(i.left, t, { ...r, path: [...r.path, `allOf`, 0] }),
      o = N(i.right, t, { ...r, path: [...r.path, `allOf`, 1] }),
      s = (e) => `allOf` in e && Object.keys(e).length === 1,
      c = [...(s(a) ? a.allOf : [a]), ...(s(o) ? o.allOf : [o])]
    ;((n.allOf = c), t.intersections.push(c))
  }
function io(e, t, n) {
  if (t.$ref) {
    if (n.has(t)) return t
    n.add(t)
    let r = e.get(t)?.def
    if (!r) return t
    let i = io(e, r, n)
    return i === r ? t : i
  }
  for (let r of [`anyOf`, `oneOf`]) {
    let i = t[r]
    if (!Array.isArray(i)) continue
    let a = i.map((t) => io(e, t, n))
    a.some((e, t) => e !== i[t]) && (t = { ...t, [r]: a })
  }
  let r = Array.isArray(t.type) ? t.type : [t.type],
    i = !r.includes(`string`) && r.some((e) => e === `number` || e === `integer`),
    a = t.enum ?? (t.const === void 0 ? void 0 : [t.const])
  if (!i && !a?.some((e) => typeof e == `number`)) return t
  let { minimum: o, maximum: s, exclusiveMinimum: c, exclusiveMaximum: l, multipleOf: u, format: d, id: f, ...p } = t
  return (
    p.enum
      ? (p.enum = p.enum.map((e) => (typeof e == `number` ? String(e) : e)))
      : typeof p.const == `number` && (p.const = String(p.const)),
    i ? ((p.type = `string`), a || (p.pattern = (r.includes(`number`) ? Zt : Xt).source), p) : p
  )
}
const ao = new WeakMap()
function oo(e) {
  let t = new Map()
  for (let n of e.seen.values()) n.def && !t.has(n.schema) && t.set(n.schema, n)
  let n = new Map()
  for (let r of ao.get(e) ?? []) {
    let i = e.seen.get(r),
      a = (i?.def ?? i?.schema)?.propertyNames
    if (!a || a === !0 || n.has(a)) continue
    let o = io(t, a, new Set())
    o !== a && n.set(a, o)
  }
  if (n.size)
    for (let t of e.seen.values())
      for (let e of [t.schema, t.def]) {
        let t = e && n.get(e.propertyNames)
        t && (e.propertyNames = t)
      }
}
const so = (e, t, n, r) => {
    let i = n,
      a = e._zod.def
    i.type = `object`
    let o = a.keyType,
      s = L(o).patterns
    if (a.mode === `loose` && s && s.size > 0) {
      let e = N(a.valueType, t, { ...r, path: [...r.path, `patternProperties`, `*`] })
      i.patternProperties = {}
      for (let t of s) d(i.patternProperties, Wa(t).source, e)
    } else {
      if (t.target === `draft-07` || t.target === `draft-2020-12`) {
        i.propertyNames = N(a.keyType, t, { ...r, path: [...r.path, `propertyNames`] })
        let n = ao.get(t)
        ;(n || ((n = []), ao.set(t, n), t.deferred.push(() => oo(t))), n.push(e))
      }
      i.additionalProperties = N(a.valueType, t, { ...r, path: [...r.path, `additionalProperties`] })
    }
    let c = o._zod.values,
      l = t.io === `input` && eo(a.valueType) !== void 0
    if (c && !a.partial && !l) {
      let e = [...c].filter((e) => typeof e == `string` || typeof e == `number`)
      e.length > 0 && (i.required = e.map(String))
    }
  },
  co = (e, t, n, r) => {
    let i = e._zod.def,
      a = N(i.innerType, t, r),
      o = t.seen.get(e)
    t.target === `openapi-3.0` ? ((o.ref = i.innerType), (n.nullable = !0)) : (n.anyOf = [a, { type: `null` }])
  },
  lo = (e, t, n, r) => {
    let i = e._zod.def
    N(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
  },
  uo = Symbol()
function fo(e, t, n, r, i) {
  let a = !1,
    o = JSON.stringify(e, (e, t) => (typeof t == `bigint` ? ((a = !0), null) : t))
  return a ? (M(t, n, r, i, `BigInt defaults cannot be represented in JSON Schema`), uo) : JSON.parse(o)
}
const po = (e, t, n, r) => {
    let i = e._zod.def
    N(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
    let o = fo(i.defaultValue, e, t, n, r)
    o !== uo && (n.default = o)
  },
  mo = (e, t, n, r) => {
    let i = e._zod.def
    N(i.innerType, t, r)
    let a = t.seen.get(e)
    if (((a.ref = i.innerType), t.io !== `input`)) return
    let o = fo(i.defaultValue, e, t, n, r)
    o !== uo && (n._prefault = o)
  },
  ho = (e, t, n, r) => {
    let i = e._zod.def
    N(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
    let o
    try {
      o = i.catchValue(void 0)
    } catch {
      M(e, t, n, r, `Dynamic catch values are not supported in JSON Schema`)
      return
    }
    n.default = o
  },
  go = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.in._zod.traits.has(`$ZodTransform`),
      o = t.io === `input` ? (a ? i.out : i.in) : i.out
    N(o, t, r)
    let s = t.seen.get(e)
    s.ref = o
  },
  _o = (e, t, n, r) => {
    let i = e._zod.def
    N(i.innerType, t, r)
    let a = t.seen.get(e)
    ;((a.ref = i.innerType), (n.readOnly = !0))
  },
  vo = (e, t, n, r) => {
    let i = e._zod.def
    N(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
  },
  yo = new WeakSet([Object.prototype, Error.prototype])
function bo(e, t, n) {
  Object.defineProperty(e, t, {
    configurable: !0,
    enumerable: !1,
    get() {
      let e = n(this)
      return (Object.defineProperty(this, t, { value: e, configurable: !0, writable: !0 }), e)
    },
    set(e) {
      Object.defineProperty(this, t, { value: e, configurable: !0, writable: !0 })
    }
  })
}
const R = w(
    `ZodError`,
    (e, t) => {
      ;(et.init(e, t), (e.name = `ZodError`))
      let n = Object.getPrototypeOf(e)
      yo.has(n) ||
        (yo.add(n),
        bo(n, `format`, (e) => (t) => rt(e, t)),
        bo(n, `flatten`, (e) => (t) => nt(e, t)),
        bo(n, `addIssue`, (e) => (t) => {
          ;(e.issues.push(t), (e.message = JSON.stringify(e.issues, a, 2)))
        }),
        bo(n, `addIssues`, (e) => (t) => {
          ;(e.issues.push(...t), (e.message = JSON.stringify(e.issues, a, 2)))
        }),
        Object.defineProperty(n, 'isEmpty', {
          configurable: !0,
          enumerable: !1,
          get() {
            return this.issues.length === 0
          }
        }))
    },
    void 0,
    { Parent: Error }
  ),
  xo = at(R),
  So = ot(R),
  Co = st(R),
  wo = lt(R),
  To = ht(R),
  Eo = gt(R),
  Do = _t(R),
  Oo = vt(R),
  ko = yt(R),
  Ao = bt(R),
  jo = xt(R),
  Mo = St(R)
function No() {
  E.localeError || D(pi())
}
function Po() {
  E.memoizer || D({ memoizer: ui() })
}
const z = w(`ZodType`, (e, t) => (No(), k.init(e, t), (e.def = t), (e.type = t.type), e), {
    check(...e) {
      let t = this.def
      return this.clone(
        g(t, {
          checks: [
            ...(t.checks ?? []),
            ...e.map((e) =>
              typeof e == `function` ? { _zod: { check: e, def: { check: `custom` }, onattach: [] } } : e
            )
          ]
        }),
        { parent: !0 }
      )
    },
    with(...e) {
      return this.check(...e)
    },
    clone(e, t) {
      return _(this, e, t)
    },
    brand() {
      return this
    },
    register(e, t) {
      return (e.add(this, t), this)
    },
    refine(e, t) {
      return this.check(qs(e, t))
    },
    superRefine(e, t) {
      return this.check(Js(e, t))
    },
    overwrite(e) {
      return this.check(j(e))
    },
    optional() {
      return ks(this)
    },
    exactOptional() {
      return js(this)
    },
    nullable() {
      return Ns(this)
    },
    nullish() {
      return ks(Ns(this))
    },
    nonoptional(e) {
      return zs(this, e)
    },
    array() {
      return G(this)
    },
    or(e) {
      return _s([this, e])
    },
    and(e) {
      return bs(this, e)
    },
    transform(e) {
      return Us(this, Ds(e))
    },
    default(e) {
      return Fs(this, e)
    },
    prefault(e) {
      return Ls(this, e)
    },
    catch(e) {
      return Vs(this, e)
    },
    pipe(e) {
      return Us(this, e)
    },
    readonly() {
      return Gs(this)
    },
    describe(e) {
      let t = this.clone()
      return (_i.add(t, { description: e }), t)
    },
    meta(...e) {
      if (e.length === 0) return _i.get(this)
      let t = this.clone()
      return (_i.add(t, e[0]), t)
    },
    isOptional() {
      return this.safeParse(void 0).success
    },
    isNullable() {
      return this.safeParse(null).success
    },
    apply(e, ...t) {
      return t.length === 0 ? e(this) : e(this, ...t)
    },
    get '~standard'() {
      return Pe(this, `~standard`, {
        ...Cn(this),
        jsonSchema: { input: Ma(this, `input`), output: Ma(this, `output`) }
      })
    },
    set '~standard'(e) {
      S(this, `~standard`, e)
    },
    parse: function e(t, n) {
      return xo(this, t, n, { callee: e })
    },
    parseAsync: async function e(t, n) {
      return await So(this, t, n, { callee: e })
    },
    safeParse(e, t) {
      return Co(this, e, t)
    },
    async safeParseAsync(e, t) {
      return wo(this, e, t)
    },
    get spa() {
      return this?.safeParseAsync
    },
    set spa(e) {
      S(this, `spa`, e)
    },
    validate(e, t) {
      return ft(this, e, t)
    },
    validateAsync(e, t) {
      return mt(this, e, t)
    },
    encode: function e(t, n) {
      return To(this, t, n, { callee: e })
    },
    decode: function e(t, n) {
      return Eo(this, t, n, { callee: e })
    },
    encodeAsync: async function e(t, n) {
      return await Do(this, t, n, { callee: e })
    },
    decodeAsync: async function e(t, n) {
      return await Oo(this, t, n, { callee: e })
    },
    safeEncode(e, t) {
      return ko(this, e, t)
    },
    safeDecode(e, t) {
      return Ao(this, e, t)
    },
    async safeEncodeAsync(e, t) {
      return jo(this, e, t)
    },
    async safeDecodeAsync(e, t) {
      return Mo(this, e, t)
    },
    toJSONSchema(e) {
      return ja(this, {})(e)
    },
    get description() {
      return _i.get(this)?.description
    },
    get _def() {
      return this._zod.def
    }
  }),
  Fo = w(
    `_ZodString`,
    (e, t) => {
      ;(wn.init(e, t), z.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Ga(e, t, n, r)))
    },
    Fe(
      {
        format: (e) => L(e).format ?? null,
        minLength: (e) => L(e).minimum ?? null,
        maxLength: (e) => L(e).maximum ?? null
      },
      {
        regex(...e) {
          return this.check(aa(...e))
        },
        includes(...e) {
          return this.check(ca(...e))
        },
        startsWith(...e) {
          return this.check(la(...e))
        },
        endsWith(...e) {
          return this.check(ua(...e))
        },
        min(...e) {
          return this.check(ra(...e))
        },
        max(...e) {
          return this.check(na(...e))
        },
        length(...e) {
          return this.check(ia(...e))
        },
        nonempty(...e) {
          return this.check(ra(1, ...e))
        },
        lowercase(e) {
          return this.check(oa(e))
        },
        uppercase(e) {
          return this.check(sa(e))
        },
        trim() {
          return this.check(fa())
        },
        normalize(...e) {
          return this.check(da(...e))
        },
        toLowerCase() {
          return this.check(pa())
        },
        toUpperCase() {
          return this.check(ma())
        },
        slugify() {
          return this.check(ha())
        }
      }
    )
  ),
  Io = w(
    `ZodString`,
    (e, t) => {
      ;(wn.init(e, t), Fo.init(e, t))
    },
    {
      email(e) {
        return this.check(bi(Vo, e))
      },
      url(e) {
        return this.check(Ei(Wo, e))
      },
      jwt(e) {
        return this.check(Vi(as, e))
      },
      emoji(e) {
        return this.check(Di(Go, e))
      },
      guid(e) {
        return this.check(xi(Ho, e))
      },
      uuid(e) {
        return this.check(Si(Uo, e))
      },
      uuidv4(e) {
        return this.check(Ci(Uo, e))
      },
      uuidv6(e) {
        return this.check(wi(Uo, e))
      },
      uuidv7(e) {
        return this.check(Ti(Uo, e))
      },
      nanoid(e) {
        return this.check(Oi(Ko, e))
      },
      cuid(e) {
        return this.check(ki(qo, e))
      },
      cuid2(e) {
        return this.check(Ai(Jo, e))
      },
      ulid(e) {
        return this.check(ji(Yo, e))
      },
      base64(e) {
        return this.check(Ri(ns, e))
      },
      base64url(e) {
        return this.check(zi(rs, e))
      },
      xid(e) {
        return this.check(Mi(Xo, e))
      },
      ksuid(e) {
        return this.check(Ni(Zo, e))
      },
      ipv4(e) {
        return this.check(Pi(Qo, e))
      },
      ipv6(e) {
        return this.check(Fi($o, e))
      },
      cidrv4(e) {
        return this.check(Ii(es, e))
      },
      cidrv6(e) {
        return this.check(Li(ts, e))
      },
      e164(e) {
        return this.check(Bi(is, e))
      },
      datetime(e) {
        return this.check(Hi(Lo, e))
      },
      date(e) {
        return this.check(Ui(Ro, e))
      },
      time(e) {
        return this.check(Wi(zo, e))
      },
      duration(e) {
        return this.check(Gi(Bo, e))
      }
    }
  )
function B(e) {
  return yi(Io, e)
}
const V = w(`ZodStringFormat`, (e, t) => {
    ;(A.init(e, t), Fo.init(e, t))
  }),
  Lo = w(`ZodISODateTime`, (e, t) => {
    ;(Un.init(e, t), V.init(e, t))
  }),
  Ro = w(`ZodISODate`, (e, t) => {
    ;(Wn.init(e, t), V.init(e, t))
  }),
  zo = w(`ZodISOTime`, (e, t) => {
    ;(Gn.init(e, t), V.init(e, t))
  }),
  Bo = w(`ZodISODuration`, (e, t) => {
    ;(Kn.init(e, t), V.init(e, t))
  }),
  Vo = w(`ZodEmail`, (e, t) => {
    ;(Dn.init(e, t), V.init(e, t))
  }),
  Ho = w(`ZodGUID`, (e, t) => {
    ;(Tn.init(e, t), V.init(e, t))
  }),
  Uo = w(`ZodUUID`, (e, t) => {
    ;(En.init(e, t), V.init(e, t))
  }),
  Wo = w(`ZodURL`, (e, t) => {
    ;(Fn.init(e, t), V.init(e, t))
  })
function H(e) {
  return Ei(Wo, e)
}
const Go = w(`ZodEmoji`, (e, t) => {
    ;(In.init(e, t), V.init(e, t))
  }),
  Ko = w(`ZodNanoID`, (e, t) => {
    ;(Ln.init(e, t), V.init(e, t))
  }),
  qo = w(`ZodCUID`, (e, t) => {
    ;(Rn.init(e, t), V.init(e, t))
  }),
  Jo = w(`ZodCUID2`, (e, t) => {
    ;(zn.init(e, t), V.init(e, t))
  }),
  Yo = w(`ZodULID`, (e, t) => {
    ;(Bn.init(e, t), V.init(e, t))
  }),
  Xo = w(`ZodXID`, (e, t) => {
    ;(Vn.init(e, t), V.init(e, t))
  }),
  Zo = w(`ZodKSUID`, (e, t) => {
    ;(Hn.init(e, t), V.init(e, t))
  }),
  Qo = w(`ZodIPv4`, (e, t) => {
    ;(qn.init(e, t), V.init(e, t))
  }),
  $o = w(`ZodIPv6`, (e, t) => {
    ;(Xn.init(e, t), V.init(e, t))
  }),
  es = w(`ZodCIDRv4`, (e, t) => {
    ;(Zn.init(e, t), V.init(e, t))
  }),
  ts = w(`ZodCIDRv6`, (e, t) => {
    ;($n.init(e, t), V.init(e, t))
  }),
  ns = w(`ZodBase64`, (e, t) => {
    ;(nr.init(e, t), V.init(e, t))
  }),
  rs = w(`ZodBase64URL`, (e, t) => {
    ;(ar.init(e, t), V.init(e, t))
  }),
  is = w(`ZodE164`, (e, t) => {
    ;(or.init(e, t), V.init(e, t))
  }),
  as = w(`ZodJWT`, (e, t) => {
    ;(cr.init(e, t), V.init(e, t))
  }),
  os = w(
    `ZodNumber`,
    (e, t) => {
      ;(lr.init(e, t), z.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Ka(e, t, n, r)), (e.isFinite = !0))
    },
    Fe(
      {
        minValue: (e) => {
          let { minimum: t, exclusiveMinimum: n } = L(e)
          return Math.max(t ?? -1 / 0, n ?? -1 / 0)
        },
        maxValue: (e) => {
          let { maximum: t, exclusiveMaximum: n } = L(e)
          return Math.min(t ?? 1 / 0, n ?? 1 / 0)
        },
        isInt: (e) => {
          let { isInt: t, multipleOf: n } = L(e)
          return !!t || !!n?.some(Number.isSafeInteger)
        },
        format: (e) => L(e).format ?? null
      },
      {
        gt(e, t) {
          return this.check($i(e, t))
        },
        gte(e, t) {
          return this.check(ea(e, t))
        },
        min(e, t) {
          return this.check(ea(e, t))
        },
        lt(e, t) {
          return this.check(Zi(e, t))
        },
        lte(e, t) {
          return this.check(Qi(e, t))
        },
        max(e, t) {
          return this.check(Qi(e, t))
        },
        int(e) {
          return this.check(cs(e))
        },
        safe(e) {
          return this.check(cs(e))
        },
        positive(e) {
          return this.check($i(0, e))
        },
        nonnegative(e) {
          return this.check(ea(0, e))
        },
        negative(e) {
          return this.check(Zi(0, e))
        },
        nonpositive(e) {
          return this.check(Qi(0, e))
        },
        multipleOf(e, t) {
          return this.check(ta(e, t))
        },
        step(e, t) {
          return this.check(ta(e, t))
        },
        finite() {
          return this
        }
      }
    )
  )
function U(e) {
  return Ki(os, e)
}
const ss = w(`ZodNumberFormat`, (e, t) => {
  ;(ur.init(e, t), os.init(e, t))
})
function cs(e) {
  return qi(ss, e)
}
const ls = w(`ZodBoolean`, (e, t) => {
  ;(dr.init(e, t), z.init(e, t), (e._zod.processJSONSchema = (t, n, r) => qa(e, t, n, r)))
})
function W(e) {
  return Ji(ls, e)
}
const us = w(`ZodUnknown`, (e, t) => {
  ;(fr.init(e, t), z.init(e, t), (e._zod.processJSONSchema = (e, t, n) => void 0))
})
function ds() {
  return Yi(us)
}
const fs = w(`ZodNever`, (e, t) => {
  ;(pr.init(e, t), z.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Ja(e, t, n, r)))
})
function ps(e) {
  return Xi(fs, e)
}
const ms = w(
  `ZodArray`,
  (e, t) => {
    ;(Po(),
      _r.init(e, t),
      z.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => $a(e, t, n, r)),
      (e.element = t.element))
  },
  {
    min(e, t) {
      return this.check(ra(e, t))
    },
    nonempty(e) {
      return this.check(ra(1, e))
    },
    max(e, t) {
      return this.check(na(e, t))
    },
    length(e, t) {
      return this.check(ia(e, t))
    },
    unwrap() {
      return this.element
    }
  }
)
function G(e, t) {
  return ga(ms, e, t)
}
const hs = w(
  `ZodObject`,
  (e, t) => {
    ;(Po(),
      Cr.init(e, t),
      z.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => to(e, t, n, r)),
      Ve(e, `shape`, (e) => e._zod.def.shape, !1))
  },
  {
    keyof() {
      return J(Object.keys(this._zod.def.shape))
    },
    catchall(e) {
      return this.clone(g(this._zod.def, { catchall: e }))
    },
    passthrough() {
      return this.clone(g(this._zod.def, { catchall: ds() }))
    },
    loose() {
      return this.clone(g(this._zod.def, { catchall: ds() }))
    },
    strict() {
      return this.clone(g(this._zod.def, { catchall: ps() }))
    },
    strip() {
      return this.clone(g(this._zod.def, { catchall: void 0 }))
    },
    extend(e) {
      return ve(this, e)
    },
    safeExtend(e) {
      return be(this, e)
    },
    merge(e) {
      return xe(this, e)
    },
    pick(e) {
      return he(this, e)
    },
    omit(e) {
      return _e(this, e)
    },
    partial(...e) {
      return Se(Os, this, e[0])
    },
    exactPartial(...e) {
      return Se(As, this, e[0], `exactPartial`)
    },
    required(...e) {
      return Ce(Rs, this, e[0])
    }
  }
)
function K(e, t) {
  let n = { type: `object`, shape: e ?? {}, ...v(t) }
  return new hs(n)
}
const gs = w(`ZodUnion`, (e, t) => {
  ;(Tr.init(e, t), z.init(e, t), (e._zod.processJSONSchema = (t, n, r) => no(e, t, n, r)), (e.options = t.options))
})
function _s(e, t) {
  return new gs({ type: `union`, options: e, ...v(t) })
}
const vs = w(`ZodDiscriminatedUnion`, (e, t) => {
  ;(gs.init(e, t), Dr.init(e, t))
})
function q(e, t, n) {
  return new vs({ type: `union`, options: t, discriminator: e, ...v(n) })
}
const ys = w(`ZodIntersection`, (e, t) => {
  ;(Or.init(e, t), z.init(e, t), (e._zod.processJSONSchema = (t, n, r) => ro(e, t, n, r)))
})
function bs(e, t) {
  return new ys({ type: `intersection`, left: e, right: t })
}
const xs = w(`ZodRecord`, (e, t) => {
  ;(Po(),
    jr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => so(e, t, n, r)),
    (e.keyType = t.keyType),
    (e.valueType = t.valueType))
})
function Ss(e, t, n) {
  return !t || !t._zod
    ? new xs({ type: `record`, keyType: B(), valueType: e, ...v(t) })
    : new xs({ type: `record`, keyType: e, valueType: t, ...v(n) })
}
function Cs(e, t, n) {
  return new xs({ type: `record`, keyType: e, valueType: t, ...v(n), partial: !0 })
}
const ws = w(`ZodEnum`, (e, t) => {
  ;(Mr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Ya(e, t, n, r)),
    (e.enum = t.entries),
    (e.options = [...e._zod.values]))
  let n = new Set(Object.keys(t.entries))
  ;((e.extract = (e, r) => {
    let i = {}
    for (let r of e)
      if (n.has(r)) i[r] = t.entries[r]
      else throw Error(`Key ${r} not found in enum`)
    return new ws({ ...t, checks: [], ...v(r), entries: i })
  }),
    (e.exclude = (e, r) => {
      let i = { ...t.entries }
      for (let t of e)
        if (n.has(t)) delete i[t]
        else throw Error(`Key ${t} not found in enum`)
      return new ws({ ...t, checks: [], ...v(r), entries: i })
    }))
})
function J(e, t) {
  let n = Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e
  return new ws({ type: `enum`, entries: n, ...v(t) })
}
const Ts = w(`ZodLiteral`, (e, t) => {
  ;(Nr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Xa(e, t, n, r)),
    (e.values = new Set(t.values)),
    Object.defineProperty(e, 'value', {
      get() {
        if (t.values.length > 1)
          throw Error('This schema contains multiple valid literal values. Use `.values` instead.')
        return t.values[0]
      }
    }))
})
function Y(e, t) {
  return new Ts({ type: `literal`, values: Array.isArray(e) ? e : [e], ...v(t) })
}
const Es = w(`ZodTransform`, (e, t) => {
  ;(Po(),
    Pr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Qa(e, t, n, r)),
    (e._zod.parse = (n, r) => {
      if (r.direction === `backward`) throw new qe(e.constructor.name)
      n.addIssue = (r) => {
        if (typeof r == `string`) n.issues.push(Me(r, n.value, t))
        else {
          let t = r
          ;(t.fatal && (t.continue = !1),
            (t.code ??= `custom`),
            `input` in t || (t.input = n.value),
            (t.inst ??= e),
            n.issues.push(Me(t)))
        }
      }
      let i = t.transform(n.value, n)
      return i instanceof Promise ? i.then((e) => ((n.value = e), n)) : ((n.value = i), n)
    }))
})
function Ds(e) {
  return new Es({ type: `transform`, transform: e })
}
const Os = w(`ZodOptional`, (e, t) => {
  ;(Ir.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => vo(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function ks(e) {
  return new Os({ type: `optional`, innerType: e })
}
const As = w(`ZodExactOptional`, (e, t) => {
  ;(Lr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => vo(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function js(e) {
  return new As({ type: `optional`, innerType: e })
}
const Ms = w(`ZodNullable`, (e, t) => {
  ;(Rr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => co(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Ns(e) {
  return new Ms({ type: `nullable`, innerType: e })
}
const Ps = w(`ZodDefault`, (e, t) => {
  ;(zr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => po(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeDefault = e.unwrap))
})
function Fs(e, t) {
  return new Ps({
    type: `default`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : ce(t)
    }
  })
}
const Is = w(`ZodPrefault`, (e, t) => {
  ;(Vr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => mo(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Ls(e, t) {
  return new Is({
    type: `prefault`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : ce(t)
    }
  })
}
const Rs = w(`ZodNonOptional`, (e, t) => {
  ;(Hr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => lo(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function zs(e, t) {
  return new Rs({ type: `nonoptional`, innerType: e, ...v(t) })
}
const Bs = w(`ZodCatch`, (e, t) => {
  ;(Gr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ho(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeCatch = e.unwrap))
})
function Vs(e, t) {
  return new Bs({ type: `catch`, innerType: e, catchValue: typeof t == `function` ? t : He(t) })
}
const Hs = w(`ZodPipe`, (e, t) => {
  ;(Kr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => go(e, t, n, r)),
    (e.in = t.in),
    (e.out = t.out))
})
function Us(e, t) {
  return new Hs({ type: `pipe`, in: e, out: t })
}
const Ws = w(`ZodReadonly`, (e, t) => {
  ;(Jr.init(e, t),
    z.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => _o(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Gs(e) {
  return new Ws({ type: `readonly`, innerType: e })
}
const Ks = w(`ZodCustom`, (e, t) => {
  ;(Xr.init(e, t), z.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Za(e, t, n, r)))
})
function qs(e, t = {}) {
  return _a(Ks, e, t)
}
function Js(e, t) {
  return va(e, t)
}
const Ys = [`models.json`, `providers.json`, `provider-models.json`]
K({
  minAppVersion: B().min(1),
  sourceAppVersion: B().min(1),
  revision: U().int().nonnegative(),
  schemaVersion: U().int(),
  files: Ss(B(), B())
})
const X = {
    ANTHROPIC_MESSAGES: `anthropic-messages`,
    GOOGLE_GENERATE_CONTENT: `google-generate-content`,
    JINA_RERANK: `jina-rerank`,
    OLLAMA_CHAT: `ollama-chat`,
    OLLAMA_GENERATE: `ollama-generate`,
    OPENAI_AUDIO_TRANSCRIPTION: `openai-audio-transcription`,
    OPENAI_AUDIO_TRANSLATION: `openai-audio-translation`,
    OPENAI_CHAT_COMPLETIONS: `openai-chat-completions`,
    OPENAI_EMBEDDINGS: `openai-embeddings`,
    OPENAI_IMAGE_EDIT: `openai-image-edit`,
    OPENAI_IMAGE_GENERATION: `openai-image-generation`,
    OPENAI_RESPONSES: `openai-responses`,
    OPENAI_TEXT_COMPLETIONS: `openai-text-completions`,
    OPENAI_TEXT_TO_SPEECH: `openai-text-to-speech`,
    OPENAI_VIDEO_GENERATION: `openai-video-generation`
  },
  Xs = {
    FUNCTION_CALL: `function-call`,
    REASONING: `reasoning`,
    IMAGE_RECOGNITION: `image-recognition`,
    IMAGE_GENERATION: `image-generation`,
    AUDIO_RECOGNITION: `audio-recognition`,
    AUDIO_GENERATION: `audio-generation`,
    EMBEDDING: `embedding`,
    RERANK: `rerank`,
    AUDIO_TRANSCRIPT: `audio-transcript`,
    VIDEO_RECOGNITION: `video-recognition`,
    VIDEO_GENERATION: `video-generation`,
    STRUCTURED_OUTPUT: `structured-output`,
    FILE_INPUT: `file-input`,
    CODE_EXECUTION: `code-execution`,
    FILE_SEARCH: `file-search`,
    COMPUTER_USE: `computer-use`
  },
  Zs = { WEB_SEARCH: `web-search`, URL_CONTEXT: `url-context` },
  Qs = { ALL_CHAT_MODELS: `all-chat-models`, MODEL_DEPENDENT: `model-dependent` },
  $s = {
    ADD_WATERMARK: `addWatermark`,
    ASPECT_RATIO: `aspectRatio`,
    BACKGROUND: `background`,
    BOTTOM_SCALE: `bottomScale`,
    CFG: `cfg`,
    COMPLEXITY: `complexity`,
    CUSTOM_SIZE: `customSize`,
    DETAIL: `detail`,
    ENABLE_INTERLEAVE: `enableInterleave`,
    FRAME_COUNT: `frameCount`,
    FRAME_DURATION_MS: `frameDurationMs`,
    FUNCTION: `function`,
    GUIDANCE_SCALE: `guidanceScale`,
    IMAGE_RESOLUTION: `imageResolution`,
    IMAGE_WEIGHT: `imageWeight`,
    IS_SKETCH: `isSketch`,
    LEFT_SCALE: `leftScale`,
    MAGIC_PROMPT_OPTION: `magicPromptOption`,
    MAX_IMAGES: `maxImages`,
    MODERATION: `moderation`,
    NEGATIVE_PROMPT: `negativePrompt`,
    NUM_IMAGES: `numImages`,
    NUM_INFERENCE_STEPS: `numInferenceSteps`,
    OUTPUT_FORMAT: `outputFormat`,
    OUTPUT_COMPRESSION: `outputCompression`,
    PERSON_GENERATION: `personGeneration`,
    PROMPT_ENHANCEMENT: `promptEnhancement`,
    PROMPT_EXTEND: `promptExtend`,
    QUALITY: `quality`,
    RESOLUTION: `resolution`,
    REF_MODE: `refMode`,
    REF_STRENGTH: `refStrength`,
    RENDERING_SPEED: `renderingSpeed`,
    RESEMBLANCE: `resemblance`,
    RIGHT_SCALE: `rightScale`,
    SAFETY_TOLERANCE: `safetyTolerance`,
    SEED: `seed`,
    SEQUENTIAL_IMAGE_GENERATION: `sequentialImageGeneration`,
    SIZE: `size`,
    SOURCE_LANG: `sourceLang`,
    STRENGTH: `strength`,
    STYLE: `style`,
    STYLE_TYPE: `styleType`,
    TARGET_LANG: `targetLang`,
    THINKING_MODE: `thinkingMode`,
    TOP_SCALE: `topScale`,
    UPSCALE_FACTOR: `upscaleFactor`
  },
  ec = { TEXT: `text`, IMAGE: `image`, AUDIO: `audio`, VIDEO: `video`, VECTOR: `vector` },
  tc = { USD: `USD`, CNY: `CNY` },
  nc = {
    NONE: `none`,
    MINIMAL: `minimal`,
    LOW: `low`,
    MEDIUM: `medium`,
    HIGH: `high`,
    XHIGH: `xhigh`,
    MAX: `max`,
    ULTRA: `ultra`,
    AUTO: `auto`
  }
function Z(e) {
  return Object.values(e)
}
const rc = J(Z(X)),
  ic = B().min(1),
  ac = B().min(1),
  oc = B().min(1),
  sc = K({ min: U(), max: U() }).refine((e) => e.min <= e.max, { message: `min must be less than or equal to max` })
K({ min: B(), max: B() })
const cc = J(Z(tc)).optional(),
  Q = K({ perMillionTokens: U().nonnegative().nullable(), currency: cc }),
  lc = Ss(B(), ds()).optional()
function $(e, { min: t } = {}) {
  let n = G(ds()).transform((t) =>
    t.reduce((t, n) => {
      let r = e.safeParse(n)
      return (r.success && t.push(r.data), t)
    }, [])
  )
  return t === void 0 ? n : n.refine((e) => e.length >= t, { message: `expected at least ${t} recognized value(s)` })
}
const uc = J(Z(ec)),
  dc = J(Z(Xs)),
  fc = J(Z($s)),
  pc = K({ min: U().nonnegative().optional(), max: U().positive().optional(), default: U().nonnegative().optional() })
    .refine((e) => (e.min == null) == (e.max == null), { message: `min and max must be both present or both absent` })
    .refine((e) => e.min == null || e.max == null || e.min <= e.max, {
      message: `min must be less than or equal to max`
    }),
  mc = J(Z(nc)),
  hc = q(`kind`, [
    K({ kind: Y(`effort`), values: $(mc, { min: 1 }), default: mc.optional() }),
    K({ kind: Y(`budget`), min: U().nonnegative(), max: U().positive(), default: U().nonnegative().optional() }),
    K({ kind: Y(`toggle`), default: W().optional() })
  ]),
  gc = J([`effort`, `budget`, `adaptive-always`, `adaptive-between-tools`])
K({
  pattern: B().refine(
    (e) => {
      try {
        return (new RegExp(e, `i`), !0)
      } catch {
        return !1
      }
    },
    { message: `pattern must be a valid regular expression` }
  ),
  effort: $(mc, { min: 1 }).optional(),
  toggle: W().optional(),
  budget: K({ min: U().nonnegative(), max: U().positive() })
    .refine((e) => e.min <= e.max, { message: `budget min must be <= max` })
    .optional(),
  template: Y(!0).optional(),
  wireDialect: gc.optional()
}).refine(
  (e) =>
    e.template !== !0 || e.effort !== void 0 || e.toggle !== void 0 || e.budget !== void 0 || e.wireDialect !== void 0,
  { message: `a template rule with no knobs declares nothing — drop it or make it a profile` }
)
const _c = K({
    controls: $(hc).optional(),
    thinkingTokenLimits: pc.optional(),
    supportedEfforts: $(mc).optional(),
    defaultEffort: mc.optional(),
    wireDialect: gc.optional()
  }).superRefine((e, t) => {
    let n = (e.controls ?? []).map((e) => e.kind)
    new Set(n).size !== n.length && t.addIssue({ code: `custom`, message: `at most one reasoning control per kind` })
    for (let n of e.controls ?? [])
      (n.kind === `effort` &&
        n.default != null &&
        !n.values.includes(n.default) &&
        t.addIssue({ code: `custom`, message: `effort default must be a member of values` }),
        n.kind === `budget` &&
          (n.min > n.max || (n.default != null && (n.default < n.min || n.default > n.max))) &&
          t.addIssue({ code: `custom`, message: `budget range must satisfy min <= default <= max` }))
  }),
  vc = J([`generate`, `edit`, `remix`, `upscale`, `merge`]),
  yc = K({ type: Y(`switch`), default: W().optional() }),
  bc = K({
    type: Y(`enum`),
    options: G(B()).min(1),
    default: B().optional(),
    render: J([`select`, `chips`]).optional(),
    columns: U().int().positive().optional()
  }),
  xc = K({ type: Y(`range`), min: U(), max: U(), default: U().optional(), step: U().optional() }).refine(
    (e) => e.min <= e.max,
    { message: `min must be ≤ max` }
  ),
  Sc = K({
    type: Y(`range`),
    min: U().int(),
    max: U().int(),
    default: U().int().optional(),
    step: U().int().positive().default(1)
  }).refine((e) => e.min <= e.max, { message: `min must be ≤ max` }),
  Cc = q(`type`, [
    yc,
    bc,
    xc,
    K({ type: Y(`size`), minSide: U(), maxSide: U(), pairedEnumKey: B().optional() }),
    K({ type: Y(`text`), multiline: W().optional() })
  ]),
  wc = [$s.NUM_IMAGES, $s.MAX_IMAGES, $s.NUM_INFERENCE_STEPS, $s.SAFETY_TOLERANCE, $s.OUTPUT_COMPRESSION],
  Tc = K({
    modes: Cs(
      vc,
      K({
        supports: Cs(fc, Cc).transform((e, t) => {
          let n = { ...e }
          for (let r of wc) {
            let i = e[r]
            if (i === void 0) continue
            let a = Sc.safeParse(i)
            if (a.success) n[r] = a.data
            else for (let e of a.error.issues) t.addIssue({ ...e, path: [r, ...e.path] })
          }
          return n
        }),
        maxInputImages: U().int().positive().optional(),
        vendorTransport: K({
          endpoint: B().regex(/^\/(?!\/)/, `vendor transport endpoint must be a root-relative path, not a URL`),
          isSync: W().optional()
        }).optional(),
        requirePrompt: W().optional()
      })
    )
  }),
  Ec = K({
    temperature: K({ supported: W(), range: sc.optional() }).default({ supported: !0 }),
    topP: K({ supported: W(), range: sc.optional() }).default({ supported: !0 }),
    topK: K({ supported: W(), range: sc.optional() }).default({ supported: !1 }),
    frequencyPenalty: W().default(!0),
    presencePenalty: W().default(!0),
    maxTokens: W().default(!0),
    stopSequences: W().default(!0),
    systemMessage: W().default(!0)
  }),
  Dc = K({
    input: Q,
    output: Q,
    cacheRead: Q.optional(),
    cacheWrite: Q.optional(),
    inputTokenTiers: G(
      K({
        minInputTokens: U().int().positive().refine(Number.isSafeInteger),
        input: Q,
        output: Q,
        cacheRead: Q.optional(),
        cacheWrite: Q.optional()
      })
    ).optional(),
    perImage: K({ price: U(), currency: cc, unit: J([`image`, `pixel`]).optional() }).optional(),
    perMinute: K({ price: U(), currency: cc }).optional()
  })
function Oc(e, t) {
  for (let n = 1; n < (e.inputTokenTiers?.length ?? 0); n++)
    e.inputTokenTiers[n].minInputTokens <= e.inputTokenTiers[n - 1].minInputTokens &&
      t.addIssue({
        code: `custom`,
        path: [`inputTokenTiers`, n, `minInputTokens`],
        message: `minInputTokens must be strictly increasing`
      })
  if (!e.inputTokenTiers?.length) return
  let n = [
      ...(e.input ? [{ rate: e.input, path: [`input`] }] : []),
      ...(e.output ? [{ rate: e.output, path: [`output`] }] : []),
      ...(e.cacheRead ? [{ rate: e.cacheRead, path: [`cacheRead`] }] : []),
      ...(e.cacheWrite ? [{ rate: e.cacheWrite, path: [`cacheWrite`] }] : []),
      ...e.inputTokenTiers.flatMap((e, t) => [
        { rate: e.input, path: [`inputTokenTiers`, t, `input`] },
        { rate: e.output, path: [`inputTokenTiers`, t, `output`] },
        ...(e.cacheRead ? [{ rate: e.cacheRead, path: [`inputTokenTiers`, t, `cacheRead`] }] : []),
        ...(e.cacheWrite ? [{ rate: e.cacheWrite, path: [`inputTokenTiers`, t, `cacheWrite`] }] : [])
      ])
    ],
    r = n[0]?.rate.currency ?? tc.USD
  for (let { rate: e, path: i } of n)
    (e.currency ?? tc.USD) !== r &&
      t.addIssue({ code: `custom`, path: [...i, `currency`], message: `pricing currencies must match` })
}
const kc = Dc.superRefine(Oc),
  Ac = Dc.partial().superRefine(Oc),
  jc = K({
    id: ic,
    name: B(),
    description: B().optional(),
    capabilities: $(dc)
      .refine((e) => new Set(e).size === e.length, { message: `Capabilities must be unique` })
      .optional(),
    inputModalities: $(uc)
      .refine((e) => new Set(e).size === e.length, { message: `Input modalities must be unique` })
      .optional(),
    outputModalities: $(uc)
      .refine((e) => new Set(e).size === e.length, { message: `Output modalities must be unique` })
      .optional(),
    endpointTypes: $(rc).optional(),
    contextWindow: U().optional(),
    maxOutputTokens: U().optional(),
    maxInputTokens: U().optional(),
    pricing: kc.optional(),
    reasoning: _c.optional(),
    parameterSupport: Ec.optional(),
    imageGeneration: Tc.optional(),
    family: B().optional(),
    ownedBy: B().optional(),
    openWeights: W().optional(),
    metadata: lc
  }),
  Mc = K({ version: oc, models: $(jc) }),
  Nc = {
    anthropic: /^(?:anthropic\.)?claude/i,
    gemini: /^(?:gemini|palm|veo|imagen|learnlm|lyria)/i,
    gemma: /^gemma(?:[-:\d]|$)/i,
    grok: /^grok/i,
    openai: /\bgpt\b|^o[134]|^chatgpt|^codex|^davinci|^babbage|^dall-e|^text-moderation|^text-embedding-(?:3|ada)/i,
    qwen: /^qwen|^qwq|^qvq|^tongyi/i,
    doubao: /^(?:doubao|skylark|seed|seedance|seedream|ep-)/i,
    hunyuan: /^(?:hunyuan|hy-|hy\d)/i,
    kimi: /^(?:kimi|moonshot|k3(?:[-_.]|$))/i,
    deepseek: /^deepseek/i,
    perplexity: /^sonar/i,
    baichuan: /^baichuan/i,
    mimo: /^mimo-/i,
    ling: /^(?:ling|ring)-/i,
    minimax: /^(?:minimax|abab)/i,
    step: /^step-/i,
    zhipu: /^(?:glm|chatglm|cogview|cogvideo|codegeex)/i,
    mistral: /^(?:open-|labs-)?(?:mistral|pixtral|codestral|ministral|voxtral|devstral|mixtral|magistral)/i
  },
  Pc = J(
    `reasoningEffort,reasoningSummary,reasoning_effort,reasoning.effort,reasoning.enabled,reasoning.exclude,reasoning.max_tokens,thinking.type,thinking.budget_tokens,thinking.budgetTokens,thinking.display,effort,sendReasoning,enable_thinking,thinking_budget,incremental_output,disable_reasoning,reasoning_budget,chat_template_kwargs.enable_thinking,chat_template_kwargs.thinking,chat_template_kwargs.thinking_mode,chat_template_kwargs.thinking_budget,extra_body.google.thinking_config.thinking_budget,extra_body.google.thinking_config.include_thoughts,extra_body.thinking.type,extra_body.thinking_budget,extra_body.reasoning_effort,thinkingConfig.includeThoughts,thinkingConfig.thinkingBudget,thinkingConfig.thinkingLevel,reasoningConfig.type,reasoningConfig.budgetTokens,reasoningConfig.maxReasoningEffort,think`.split(
      `,`
    )
  ),
  Fc = J(Z(nc)),
  Ic = K({
    target: Pc,
    value: q(`source`, [
      K({ source: Y(`literal`), value: _s([B(), U(), W()]) }),
      K({ source: Y(`effort`) }),
      K({ source: Y(`budget`) }),
      K({ source: Y(`assistant-summary`) })
    ])
  }),
  Lc = K({
    target: Pc,
    value: q(`source`, [
      K({ source: Y(`literal`), value: _s([B(), U(), W()]) }),
      K({ source: Y(`effort`) }),
      K({ source: Y(`assistant-summary`) })
    ])
  }),
  Rc = K({
    min: U().nonnegative().optional(),
    autoValue: U().optional(),
    clampToMaxTokens: W().optional(),
    missing: q(`type`, [
      K({ type: Y(`omit-value`) }),
      K({ type: Y(`omit-mode`) }),
      K({ type: Y(`fallback`), value: U() })
    ])
  }),
  zc = Cs(Fc, Fc).optional(),
  Bc = _s([
    K({ operations: G(Lc).min(1), effortMap: zc }),
    K({
      operations: G(Ic)
        .min(1)
        .refine((e) => e.some((e) => e.value.source === `budget`), {
          message: `reasoning budget mode must contain a budget operation`
        }),
      effortMap: zc,
      budget: Rc
    })
  ]),
  Vc = K({
    disabled: Y(!0).optional(),
    default: Bc.optional(),
    off: Bc.optional(),
    auto: Bc.optional(),
    effort: Bc.optional()
  }).refine((e) => e.disabled === !0 || e.default || e.off || e.auto || e.effort, {
    message: `reasoning wire profile must declare a mode or be disabled`
  })
K({ wire: Vc, budgetWire: Vc.optional(), alwaysOnWire: Vc.optional(), betweenToolsWire: Vc.optional() })
const Hc = Z(X),
  Uc = J([`global`, `cn`]),
  Wc = J([`openai-priority`, `claude-code`]),
  Gc = J([`standard`, `auto`, `fast`, `flex`]),
  Kc = G(Gc)
    .min(1)
    .refine((e) => new Set(e).size === e.length, { message: `service tier options must be unique` })
    .refine((e) => e.includes(`standard`), { message: `service tier options must include standard` }),
  qc = K({
    default: Gc,
    options: Kc,
    wire: K({
      delivery: q(`type`, [
        K({ type: Y(`provider-option`), key: B().min(1) }),
        K({ type: Y(`request-body`), key: B().min(1) })
      ]),
      values: Cs(Gc, B().min(1))
    })
  }).superRefine((e, t) => {
    e.options.includes(e.default) ||
      t.addIssue({ code: `custom`, message: `service tier default must be one of its options`, path: [`default`] })
    for (let n of e.options)
      e.wire.values[n] ||
        t.addIssue({
          code: `custom`,
          message: `service tier option '${n}' must have a wire value`,
          path: [`wire`, `values`, n]
        })
  }),
  Jc = K({
    id: J(Z(Zs)),
    modelScope: J(Z(Qs)).default(Qs.MODEL_DEPENDENT),
    endpointTypes: $(rc).optional(),
    vendors: $(J(Object.keys(Nc))).optional()
  }),
  Yc = (e) => K({ type: Y(e), wire: Vc.optional() }),
  Xc = q(`type`, [Yc(`openai-chat`), Yc(`openai-responses`), Yc(`anthropic`), Yc(`gemini`), Yc(`ollama`), Yc(`none`)])
Xc.options.map((e) => e.shape.type.value)
const Zc = K({
    website: K({
      billing: H().optional(),
      official: H().optional(),
      docs: H().optional(),
      apiKey: H().optional(),
      models: H().optional()
    })
  }),
  Qc = K({ streamOptions: W().optional(), developerRole: W().optional(), reasoningSummary: W().optional() }),
  $c = K({
    baseUrl: H().optional(),
    modelsApiUrls: K({
      default: H().optional(),
      embedding: H().optional(),
      image: H().optional(),
      reranker: H().optional()
    }).optional(),
    reasoningFormat: Xc.optional(),
    adapterFamily: B().optional(),
    dialect: Qc.optional(),
    requestControls: K({ serviceTier: qc.optional() }).optional()
  }),
  el = K({
    version: oc,
    providers: $(
      K({
        id: ac,
        presetProviderId: ac.optional(),
        name: B(),
        availableInEditions: $(Uc, { min: 1 }).optional(),
        description: B().optional(),
        endpointConfigs: Ss(
          B().refine((e) => Hc.includes(e), {
            message: `Invalid endpoint type key, must be one of: ${Z(X).join(`, `)}`
          }),
          $c
        ).optional(),
        defaultChatEndpoint: rc.nullable().default(null),
        modelListSource: J([`api`, `registry`]).default(`api`),
        supplementModelsFromRegistry: W().optional(),
        modelResolution: q(`source`, [
          K({ source: Y(`catalog`) }),
          K({
            source: Y(`provider`),
            defaults: jc
              .pick({
                capabilities: !0,
                inputModalities: !0,
                outputModalities: !0,
                endpointTypes: !0,
                imageGeneration: !0
              })
              .required({ capabilities: !0, inputModalities: !0, outputModalities: !0, endpointTypes: !0 })
              .extend({ supportsStreaming: W() })
          })
        ]).optional(),
        authMethods: $(J([`api-key`, `oauth`, `external-cli`])).optional(),
        authOptional: W().default(!1),
        serverTools: $(Jc).default([]),
        reportsActualCost: W().default(!1),
        reportedCostCurrency: cc,
        fastMode: K({ transport: Wc, serviceTier: B().optional() }).optional(),
        metadata: lc.and(Zc)
      }).refine((e) => (e.endpointConfigs && e.defaultChatEndpoint ? e.defaultChatEndpoint in e.endpointConfigs : !0), {
        message: `defaultChatEndpoint must exist as a key in endpointConfigs`
      })
    )
  }),
  tl = K({ add: $(dc).optional(), remove: $(dc).optional(), force: $(dc).optional() }),
  nl = J([
    X.OPENAI_RESPONSES,
    X.OPENAI_CHAT_COMPLETIONS,
    X.ANTHROPIC_MESSAGES,
    X.GOOGLE_GENERATE_CONTENT,
    X.OLLAMA_CHAT,
    X.OLLAMA_GENERATE,
    X.OPENAI_TEXT_COMPLETIONS
  ]),
  rl = K({ support: _c.optional(), wire: Vc.optional() }).refine((e) => e.support || e.wire, {
    message: `provider-model reasoning contract must declare support or wire`
  }),
  il = {
    'models.json': Mc,
    'providers.json': el,
    'provider-models.json': K({
      version: oc,
      overrides: $(
        K({
          providerId: ac,
          modelId: ic,
          apiModelId: B().optional(),
          modelVariants: G(B().min(1)).optional(),
          capabilities: tl.optional(),
          limits: K({
            contextWindow: U().optional(),
            maxOutputTokens: U().optional(),
            maxInputTokens: U().optional()
          }).optional(),
          pricing: Ac.optional(),
          reasoningContracts: Cs(nl, rl).optional(),
          supportsFastMode: W().optional(),
          requestControls: K({ serviceTier: K({ options: Kc }).optional() }).optional(),
          parameterSupport: Ec.partial().optional(),
          endpointTypes: $(rc).optional(),
          inputModalities: $(uc).optional(),
          outputModalities: $(uc).optional(),
          name: B().optional(),
          description: B().optional(),
          family: B().optional(),
          ownedBy: B().optional(),
          imageGeneration: Tc.optional(),
          disabled: W().optional(),
          replaceWith: ic.optional(),
          reason: B().optional()
        })
      )
    })
  },
  al = 5
function ol(e) {
  return e && typeof e == `object` && `issues` in e
    ? JSON.stringify(e.issues)
    : e instanceof Error
      ? e.message
      : String(e)
}
function sl(e, t) {
  il[e].parse(t)
}
function cl(n) {
  for (let r of Ys)
    try {
      sl(r, JSON.parse(e(t.join(n, r), `utf8`)))
    } catch (e) {
      throw Error(`${r} is not compatible with registry schema v5: ${ol(e)}`)
    }
}
if (process.argv[1] && t.resolve(process.argv[1]) === n(import.meta.url)) {
  let e = process.argv[2]
  if (!e) (console.error(`Usage: node vN-validator.mjs <catalog-data-directory>`), (process.exitCode = 1))
  else
    try {
      ;(cl(t.resolve(e)), console.log(`Catalog is compatible with frozen registry schema v5`))
    } catch (e) {
      ;(console.error(e instanceof Error ? e.message : e), (process.exitCode = 1))
    }
}
export { al as schemaVersion, cl as validateCatalogDirectory, sl as validateCatalogFile }
