/* eslint-disable */
// AUTO-GENERATED compatibility contract. Never edit or replace this file.
import { readFileSync as e } from 'node:fs'
import t from 'node:path'
import { fileURLToPath as n } from 'node:url'
var r
function i(e, t, n) {
  function r(n, r) {
    if (
      (n._zod || Object.defineProperty(n, '_zod', { value: { def: r, constr: o, traits: new Set() }, enumerable: !1 }),
      n._zod.traits.has(e))
    )
      return
    ;(n._zod.traits.add(e), t(n, r))
    let i = o.prototype,
      a = Object.keys(i)
    for (let e = 0; e < a.length; e++) {
      let t = a[e]
      t in n || (n[t] = i[t].bind(n))
    }
  }
  let i = n?.Parent ?? Object
  class a extends i {}
  Object.defineProperty(a, 'name', { value: e })
  function o(e) {
    var t
    let i = n?.Parent ? new a() : this
    ;(r(i, e), (t = i._zod).deferred ?? (t.deferred = []))
    for (let e of i._zod.deferred) e()
    return i
  }
  return (
    Object.defineProperty(o, 'init', { value: r }),
    Object.defineProperty(o, Symbol.hasInstance, {
      value: (t) => (n?.Parent && t instanceof n.Parent ? !0 : t?._zod?.traits?.has(e))
    }),
    Object.defineProperty(o, 'name', { value: e }),
    o
  )
}
var a = class extends Error {
    constructor() {
      super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`)
    }
  },
  o = class extends Error {
    constructor(e) {
      ;(super(`Encountered unidirectional transform during encode: ${e}`), (this.name = `ZodEncodeError`))
    }
  }
;(r = globalThis).__zod_globalConfig ?? (r.__zod_globalConfig = {})
const s = globalThis.__zod_globalConfig
function c(e) {
  return (e && Object.assign(s, e), s)
}
function l(e) {
  let t = Object.values(e).filter((e) => typeof e == `number`)
  return Object.entries(e)
    .filter(([e, n]) => t.indexOf(+e) === -1)
    .map(([e, t]) => t)
}
function u(e, t) {
  return typeof t == `bigint` ? t.toString() : t
}
function d(e) {
  return {
    get value() {
      {
        let t = e()
        return (Object.defineProperty(this, 'value', { value: t }), t)
      }
    }
  }
}
function f(e) {
  return e == null
}
function p(e) {
  let t = +!!e.startsWith(`^`),
    n = e.endsWith(`$`) ? e.length - 1 : e.length
  return e.slice(t, n)
}
function ee(e, t) {
  let n = e / t,
    r = Math.round(n),
    i = 2 ** -52 * Math.max(Math.abs(n), 1)
  return Math.abs(n - r) < i ? 0 : n - r
}
const te = Symbol(`evaluating`)
function m(e, t, n) {
  let r
  Object.defineProperty(e, t, {
    get() {
      if (r !== te) return (r === void 0 && ((r = te), (r = n())), r)
    },
    set(n) {
      Object.defineProperty(e, t, { value: n })
    },
    configurable: !0
  })
}
function h(e, t, n) {
  Object.defineProperty(e, t, { value: n, writable: !0, enumerable: !0, configurable: !0 })
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
function _(e) {
  return typeof e == `object` && !!e && !Array.isArray(e)
}
const ae = d(() => {
  if (s.jitless || (typeof navigator < `u` && navigator?.userAgent?.includes(`Cloudflare`))) return !1
  try {
    return (Function(``), !0)
  } catch {
    return !1
  }
})
function v(e) {
  if (_(e) === !1) return !1
  let t = e.constructor
  if (t === void 0 || typeof t != `function`) return !0
  let n = t.prototype
  return _(n) !== !1 && Object.prototype.hasOwnProperty.call(n, `isPrototypeOf`) !== !1
}
function oe(e) {
  return v(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e
}
const se = new Set([`string`, `number`, `symbol`])
function y(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
}
function b(e, t, n) {
  let r = new e._zod.constr(t ?? e._zod.def)
  return ((!t || n?.parent) && (r._zod.parent = e), r)
}
function x(e) {
  let t = e
  if (!t) return {}
  if (typeof t == `string`) return { error: () => t }
  if (t?.message !== void 0) {
    if (t?.error !== void 0) throw Error('Cannot specify both `message` and `error` params')
    t.error = t.message
  }
  return (delete t.message, typeof t.error == `string` ? { ...t, error: () => t.error } : t)
}
function ce(e) {
  return Object.keys(e).filter((t) => e[t]._zod.optin === `optional` && e[t]._zod.optout === `optional`)
}
const le = {
  safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}
function ue(e, t) {
  let n = e._zod.def,
    r = n.checks
  if (r && r.length > 0) throw Error(`.pick() cannot be used on object schemas containing refinements`)
  return b(
    e,
    g(e._zod.def, {
      get shape() {
        let e = {}
        for (let r in t) {
          if (!(r in n.shape)) throw Error(`Unrecognized key: "${r}"`)
          t[r] && (e[r] = n.shape[r])
        }
        return (h(this, `shape`, e), e)
      },
      checks: []
    })
  )
}
function de(e, t) {
  let n = e._zod.def,
    r = n.checks
  if (r && r.length > 0) throw Error(`.omit() cannot be used on object schemas containing refinements`)
  return b(
    e,
    g(e._zod.def, {
      get shape() {
        let r = { ...e._zod.def.shape }
        for (let e in t) {
          if (!(e in n.shape)) throw Error(`Unrecognized key: "${e}"`)
          t[e] && delete r[e]
        }
        return (h(this, `shape`, r), r)
      },
      checks: []
    })
  )
}
function fe(e, t) {
  if (!v(t)) throw Error(`Invalid input to extend: expected a plain object`)
  let n = e._zod.def.checks
  if (n && n.length > 0) {
    let n = e._zod.def.shape
    for (let e in t)
      if (Object.getOwnPropertyDescriptor(n, e) !== void 0)
        throw Error('Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.')
  }
  return b(
    e,
    g(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t }
        return (h(this, `shape`, n), n)
      }
    })
  )
}
function pe(e, t) {
  if (!v(t)) throw Error(`Invalid input to safeExtend: expected a plain object`)
  return b(
    e,
    g(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t }
        return (h(this, `shape`, n), n)
      }
    })
  )
}
function me(e, t) {
  if (e._zod.def.checks?.length)
    throw Error(`.merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.`)
  return b(
    e,
    g(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t._zod.def.shape }
        return (h(this, `shape`, n), n)
      },
      get catchall() {
        return t._zod.def.catchall
      },
      checks: t._zod.def.checks ?? []
    })
  )
}
function he(e, t, n) {
  let r = t._zod.def.checks
  if (r && r.length > 0) throw Error(`.partial() cannot be used on object schemas containing refinements`)
  return b(
    t,
    g(t._zod.def, {
      get shape() {
        let r = t._zod.def.shape,
          i = { ...r }
        if (n)
          for (let t in n) {
            if (!(t in r)) throw Error(`Unrecognized key: "${t}"`)
            n[t] && (i[t] = e ? new e({ type: `optional`, innerType: r[t] }) : r[t])
          }
        else for (let t in r) i[t] = e ? new e({ type: `optional`, innerType: r[t] }) : r[t]
        return (h(this, `shape`, i), i)
      },
      checks: []
    })
  )
}
function ge(e, t, n) {
  return b(
    t,
    g(t._zod.def, {
      get shape() {
        let r = t._zod.def.shape,
          i = { ...r }
        if (n)
          for (let t in n) {
            if (!(t in i)) throw Error(`Unrecognized key: "${t}"`)
            n[t] && (i[t] = new e({ type: `nonoptional`, innerType: r[t] }))
          }
        else for (let t in r) i[t] = new e({ type: `nonoptional`, innerType: r[t] })
        return (h(this, `shape`, i), i)
      }
    })
  )
}
function S(e, t = 0) {
  if (e.aborted === !0) return !0
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0
  return !1
}
function _e(e, t = 0) {
  if (e.aborted === !0) return !0
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0
  return !1
}
function C(e, t) {
  return t.map((t) => {
    var n
    return ((n = t).path ?? (n.path = []), t.path.unshift(e), t)
  })
}
function ve(e) {
  return typeof e == `string` ? e : e?.message
}
function w(e, t, n) {
  let r = e.message
      ? e.message
      : (ve(e.inst?._zod.def?.error?.(e)) ??
        ve(t?.error?.(e)) ??
        ve(n.customError?.(e)) ??
        ve(n.localeError?.(e)) ??
        `Invalid input`),
    { inst: i, continue: a, input: o, ...s } = e
  return ((s.path ??= []), (s.message = r), t?.reportInput && (s.input = o), s)
}
function ye(e) {
  return Array.isArray(e) ? `array` : typeof e == `string` ? `string` : `unknown`
}
function T(...e) {
  let [t, n, r] = e
  return typeof t == `string` ? { message: t, code: `custom`, input: n, inst: r } : { ...t }
}
const be = (e, t) => {
    ;((e.name = `$ZodError`),
      Object.defineProperty(e, '_zod', { value: e._zod, enumerable: !1 }),
      Object.defineProperty(e, 'issues', { value: t, enumerable: !1 }),
      (e.message = JSON.stringify(t, u, 2)),
      Object.defineProperty(e, 'toString', { value: () => e.message, enumerable: !1 }))
  },
  xe = i(`$ZodError`, be),
  Se = i(`$ZodError`, be, { Parent: Error })
function Ce(e, t = (e) => e.message) {
  let n = {},
    r = []
  for (let i of e.issues)
    i.path.length > 0 ? ((n[i.path[0]] = n[i.path[0]] || []), n[i.path[0]].push(t(i))) : r.push(t(i))
  return { formErrors: r, fieldErrors: n }
}
function we(e, t = (e) => e.message) {
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
              let n = e[i]
              ;(i === e.length - 1
                ? ((r[n] = r[n] || { _errors: [] }), r[n]._errors.push(t(a)))
                : (r[n] = r[n] || { _errors: [] }),
                (r = r[n]),
                i++)
            }
          }
        }
    }
  return (r(e), n)
}
const Te = (e) => (t, n, r, i) => {
    let o = r ? { ...r, async: !1 } : { async: !1 },
      s = t._zod.run({ value: n, issues: [] }, o)
    if (s instanceof Promise) throw new a()
    if (s.issues.length) {
      let t = new (i?.Err ?? e)(s.issues.map((e) => w(e, o, c())))
      throw (ie(t, i?.callee), t)
    }
    return s.value
  },
  Ee = (e) => async (t, n, r, i) => {
    let a = r ? { ...r, async: !0 } : { async: !0 },
      o = t._zod.run({ value: n, issues: [] }, a)
    if ((o instanceof Promise && (o = await o), o.issues.length)) {
      let t = new (i?.Err ?? e)(o.issues.map((e) => w(e, a, c())))
      throw (ie(t, i?.callee), t)
    }
    return o.value
  },
  De = (e) => (t, n, r) => {
    let i = r ? { ...r, async: !1 } : { async: !1 },
      o = t._zod.run({ value: n, issues: [] }, i)
    if (o instanceof Promise) throw new a()
    return o.issues.length
      ? { success: !1, error: new (e ?? xe)(o.issues.map((e) => w(e, i, c()))) }
      : { success: !0, data: o.value }
  },
  Oe = De(Se),
  ke = (e) => async (t, n, r) => {
    let i = r ? { ...r, async: !0 } : { async: !0 },
      a = t._zod.run({ value: n, issues: [] }, i)
    return (
      a instanceof Promise && (a = await a),
      a.issues.length
        ? { success: !1, error: new e(a.issues.map((e) => w(e, i, c()))) }
        : { success: !0, data: a.value }
    )
  },
  Ae = ke(Se),
  je = (e) => (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` }
    return Te(e)(t, n, i)
  },
  Me = (e) => (t, n, r) => Te(e)(t, n, r),
  Ne = (e) => async (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` }
    return Ee(e)(t, n, i)
  },
  Pe = (e) => async (t, n, r) => Ee(e)(t, n, r),
  Fe = (e) => (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` }
    return De(e)(t, n, i)
  },
  Ie = (e) => (t, n, r) => De(e)(t, n, r),
  Le = (e) => async (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` }
    return ke(e)(t, n, i)
  },
  Re = (e) => async (t, n, r) => ke(e)(t, n, r),
  ze = /^[cC][0-9a-z]{6,}$/,
  Be = /^[0-9a-z]+$/,
  Ve = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/,
  He = /^[0-9a-vA-V]{20}$/,
  Ue = /^[A-Za-z0-9]{27}$/,
  We = /^[a-zA-Z0-9_-]{21}$/,
  Ge = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/,
  Ke = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  qe = (e) =>
    e
      ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`)
      : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/,
  Je = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/
function Ye() {
  return RegExp(`^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`, `u`)
}
const Xe =
    /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
  Ze =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/,
  Qe =
    /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/,
  $e =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
  et = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/,
  tt = /^[A-Za-z0-9_-]*$/,
  nt = /^https?$/,
  rt = /^\+[1-9]\d{6,14}$/,
  it = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`,
  at = RegExp(`^${it}$`)
function ot(e) {
  let t = `(?:[01]\\d|2[0-3]):[0-5]\\d`
  return typeof e.precision == `number`
    ? e.precision === -1
      ? `${t}`
      : e.precision === 0
        ? `${t}:[0-5]\\d`
        : `${t}:[0-5]\\d\\.\\d{${e.precision}}`
    : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`
}
function st(e) {
  return RegExp(`^${ot(e)}$`)
}
function ct(e) {
  let t = ot({ precision: e.precision }),
    n = [`Z`]
  ;(e.local && n.push(``), e.offset && n.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`))
  let r = `${t}(?:${n.join(`|`)})`
  return RegExp(`^${it}T(?:${r})$`)
}
const lt = (e) => {
    let t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ``}}` : `[\\s\\S]*`
    return RegExp(`^${t}$`)
  },
  ut = /^-?\d+$/,
  dt = /^-?\d+(?:\.\d+)?$/,
  ft = /^(?:true|false)$/i,
  pt = /^[^A-Z]*$/,
  mt = /^[^a-z]*$/,
  E = i(`$ZodCheck`, (e, t) => {
    var n
    ;((e._zod ??= {}), (e._zod.def = t), (n = e._zod).onattach ?? (n.onattach = []))
  }),
  ht = { number: `number`, bigint: `bigint`, object: `date` },
  gt = i(`$ZodCheckLessThan`, (e, t) => {
    E.init(e, t)
    let n = ht[typeof t.value]
    ;(e._zod.onattach.push((e) => {
      let n = e._zod.bag,
        r = (t.inclusive ? n.maximum : n.exclusiveMaximum) ?? 1 / 0
      t.value < r && (t.inclusive ? (n.maximum = t.value) : (n.exclusiveMaximum = t.value))
    }),
      (e._zod.check = (r) => {
        ;(t.inclusive ? r.value <= t.value : r.value < t.value) ||
          r.issues.push({
            origin: n,
            code: `too_big`,
            maximum: typeof t.value == `object` ? t.value.getTime() : t.value,
            input: r.value,
            inclusive: t.inclusive,
            inst: e,
            continue: !t.abort
          })
      }))
  }),
  _t = i(`$ZodCheckGreaterThan`, (e, t) => {
    E.init(e, t)
    let n = ht[typeof t.value]
    ;(e._zod.onattach.push((e) => {
      let n = e._zod.bag,
        r = (t.inclusive ? n.minimum : n.exclusiveMinimum) ?? -1 / 0
      t.value > r && (t.inclusive ? (n.minimum = t.value) : (n.exclusiveMinimum = t.value))
    }),
      (e._zod.check = (r) => {
        ;(t.inclusive ? r.value >= t.value : r.value > t.value) ||
          r.issues.push({
            origin: n,
            code: `too_small`,
            minimum: typeof t.value == `object` ? t.value.getTime() : t.value,
            input: r.value,
            inclusive: t.inclusive,
            inst: e,
            continue: !t.abort
          })
      }))
  }),
  vt = i(`$ZodCheckMultipleOf`, (e, t) => {
    ;(E.init(e, t),
      e._zod.onattach.push((e) => {
        var n
        ;(n = e._zod.bag).multipleOf ?? (n.multipleOf = t.value)
      }),
      (e._zod.check = (n) => {
        if (typeof n.value != typeof t.value) throw Error(`Cannot mix number and bigint in multiple_of check.`)
        ;(typeof n.value == `bigint` ? n.value % t.value === BigInt(0) : ee(n.value, t.value) === 0) ||
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
  yt = i(`$ZodCheckNumberFormat`, (e, t) => {
    ;(E.init(e, t), (t.format = t.format || `float64`))
    let n = t.format?.includes(`int`),
      r = n ? `int` : `number`,
      [i, a] = le[t.format]
    ;(e._zod.onattach.push((e) => {
      let r = e._zod.bag
      ;((r.format = t.format), (r.minimum = i), (r.maximum = a), n && (r.pattern = ut))
    }),
      (e._zod.check = (o) => {
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
      }))
  }),
  bt = i(`$ZodCheckMaxLength`, (e, t) => {
    var n
    ;(E.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !f(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag.maximum ?? 1 / 0
        t.maximum < n && (e._zod.bag.maximum = t.maximum)
      }),
      (e._zod.check = (n) => {
        let r = n.value
        if (r.length <= t.maximum) return
        let i = ye(r)
        n.issues.push({
          origin: i,
          code: `too_big`,
          maximum: t.maximum,
          inclusive: !0,
          input: r,
          inst: e,
          continue: !t.abort
        })
      }))
  }),
  xt = i(`$ZodCheckMinLength`, (e, t) => {
    var n
    ;(E.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !f(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag.minimum ?? -1 / 0
        t.minimum > n && (e._zod.bag.minimum = t.minimum)
      }),
      (e._zod.check = (n) => {
        let r = n.value
        if (r.length >= t.minimum) return
        let i = ye(r)
        n.issues.push({
          origin: i,
          code: `too_small`,
          minimum: t.minimum,
          inclusive: !0,
          input: r,
          inst: e,
          continue: !t.abort
        })
      }))
  }),
  St = i(`$ZodCheckLengthEquals`, (e, t) => {
    var n
    ;(E.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !f(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag
        ;((n.minimum = t.length), (n.maximum = t.length), (n.length = t.length))
      }),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length
        if (i === t.length) return
        let a = ye(r),
          o = i > t.length
        n.issues.push({
          origin: a,
          ...(o ? { code: `too_big`, maximum: t.length } : { code: `too_small`, minimum: t.length }),
          inclusive: !0,
          exact: !0,
          input: n.value,
          inst: e,
          continue: !t.abort
        })
      }))
  }),
  Ct = i(`$ZodCheckStringFormat`, (e, t) => {
    var n, r
    ;(E.init(e, t),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag
        ;((n.format = t.format), t.pattern && ((n.patterns ??= new Set()), n.patterns.add(t.pattern)))
      }),
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
  wt = i(`$ZodCheckRegex`, (e, t) => {
    ;(Ct.init(e, t),
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
  Tt = i(`$ZodCheckLowerCase`, (e, t) => {
    ;((t.pattern ??= pt), Ct.init(e, t))
  }),
  Et = i(`$ZodCheckUpperCase`, (e, t) => {
    ;((t.pattern ??= mt), Ct.init(e, t))
  }),
  Dt = i(`$ZodCheckIncludes`, (e, t) => {
    E.init(e, t)
    let n = y(t.includes),
      r = new RegExp(typeof t.position == `number` ? `^.{${t.position}}${n}` : n)
    ;((t.pattern = r),
      e._zod.onattach.push((e) => {
        let t = e._zod.bag
        ;((t.patterns ??= new Set()), t.patterns.add(r))
      }),
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
  Ot = i(`$ZodCheckStartsWith`, (e, t) => {
    E.init(e, t)
    let n = RegExp(`^${y(t.prefix)}.*`)
    ;((t.pattern ??= n),
      e._zod.onattach.push((e) => {
        let t = e._zod.bag
        ;((t.patterns ??= new Set()), t.patterns.add(n))
      }),
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
  kt = i(`$ZodCheckEndsWith`, (e, t) => {
    E.init(e, t)
    let n = RegExp(`.*${y(t.suffix)}$`)
    ;((t.pattern ??= n),
      e._zod.onattach.push((e) => {
        let t = e._zod.bag
        ;((t.patterns ??= new Set()), t.patterns.add(n))
      }),
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
  At = i(`$ZodCheckOverwrite`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.check = (e) => {
        e.value = t.tx(e.value)
      }))
  })
var jt = class {
  constructor(e = []) {
    ;((this.content = []), (this.indent = 0), this && (this.args = e))
  }
  indented(e) {
    ;((this.indent += 1), e(this), --this.indent)
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
      t = this?.args,
      n = [...(this?.content ?? [``]).map((e) => `  ${e}`)]
    return new e(
      ...t,
      n.join(`
`)
    )
  }
}
const Mt = { major: 4, minor: 4, patch: 3 },
  D = i(`$ZodType`, (e, t) => {
    var n
    ;((e ??= {}), (e._zod.def = t), (e._zod.bag = e._zod.bag || {}), (e._zod.version = Mt))
    let r = [...(e._zod.def.checks ?? [])]
    e._zod.traits.has(`$ZodCheck`) && r.unshift(e)
    for (let t of r) for (let n of t._zod.onattach) n(e)
    if (r.length === 0)
      ((n = e._zod).deferred ?? (n.deferred = []),
        e._zod.deferred?.push(() => {
          e._zod.run = e._zod.parse
        }))
    else {
      let t = (e, t, n) => {
          let r = S(e),
            i
          for (let o of t) {
            if (o._zod.def.when) {
              if (_e(e) || !o._zod.def.when(e)) continue
            } else if (r) continue
            let t = e.issues.length,
              s = o._zod.check(e)
            if (s instanceof Promise && n?.async === !1) throw new a()
            if (i || s instanceof Promise)
              i = (i ?? Promise.resolve()).then(async () => {
                ;(await s, e.issues.length !== t && (r ||= S(e, t)))
              })
            else {
              if (e.issues.length === t) continue
              r ||= S(e, t)
            }
          }
          return i ? i.then(() => e) : e
        },
        n = (n, i, o) => {
          if (S(n)) return ((n.aborted = !0), n)
          let s = t(i, r, o)
          if (s instanceof Promise) {
            if (o.async === !1) throw new a()
            return s.then((t) => e._zod.parse(t, o))
          }
          return e._zod.parse(s, o)
        }
      e._zod.run = (i, o) => {
        if (o.skipChecks) return e._zod.parse(i, o)
        if (o.direction === `backward`) {
          let t = e._zod.parse({ value: i.value, issues: [] }, { ...o, skipChecks: !0 })
          return t instanceof Promise ? t.then((e) => n(e, i, o)) : n(t, i, o)
        }
        let s = e._zod.parse(i, o)
        if (s instanceof Promise) {
          if (o.async === !1) throw new a()
          return s.then((e) => t(e, r, o))
        }
        return t(s, r, o)
      }
    }
    m(e, `~standard`, () => ({
      validate: (t) => {
        try {
          let n = Oe(e, t)
          return n.success ? { value: n.data } : { issues: n.error?.issues }
        } catch {
          return Ae(e, t).then((e) => (e.success ? { value: e.data } : { issues: e.error?.issues }))
        }
      },
      vendor: `zod`,
      version: 1
    }))
  }),
  Nt = i(`$ZodString`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.pattern = [...(e?._zod.bag?.patterns ?? [])].pop() ?? lt(e._zod.bag)),
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
  O = i(`$ZodStringFormat`, (e, t) => {
    ;(Ct.init(e, t), Nt.init(e, t))
  }),
  Pt = i(`$ZodGUID`, (e, t) => {
    ;((t.pattern ??= Ke), O.init(e, t))
  }),
  Ft = i(`$ZodUUID`, (e, t) => {
    if (t.version) {
      let e = { v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7, v8: 8 }[t.version]
      if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`)
      t.pattern ??= qe(e)
    } else t.pattern ??= qe()
    O.init(e, t)
  }),
  It = i(`$ZodEmail`, (e, t) => {
    ;((t.pattern ??= Je), O.init(e, t))
  }),
  Lt = i(`$ZodURL`, (e, t) => {
    ;(O.init(e, t),
      (e._zod.check = (n) => {
        try {
          let r = n.value.trim()
          if (!t.normalize && t.protocol?.source === nt.source && !/^https?:\/\//i.test(r)) {
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
          let i = new URL(r)
          ;(t.hostname &&
            ((t.hostname.lastIndex = 0),
            t.hostname.test(i.hostname) ||
              n.issues.push({
                code: `invalid_format`,
                format: `url`,
                note: `Invalid hostname`,
                pattern: t.hostname.source,
                input: n.value,
                inst: e,
                continue: !t.abort
              })),
            t.protocol &&
              ((t.protocol.lastIndex = 0),
              t.protocol.test(i.protocol.endsWith(`:`) ? i.protocol.slice(0, -1) : i.protocol) ||
                n.issues.push({
                  code: `invalid_format`,
                  format: `url`,
                  note: `Invalid protocol`,
                  pattern: t.protocol.source,
                  input: n.value,
                  inst: e,
                  continue: !t.abort
                })),
            (n.value = t.normalize ? i.href : r))
          return
        } catch {
          n.issues.push({ code: `invalid_format`, format: `url`, input: n.value, inst: e, continue: !t.abort })
        }
      }))
  }),
  Rt = i(`$ZodEmoji`, (e, t) => {
    ;((t.pattern ??= Ye()), O.init(e, t))
  }),
  zt = i(`$ZodNanoID`, (e, t) => {
    ;((t.pattern ??= We), O.init(e, t))
  }),
  Bt = i(`$ZodCUID`, (e, t) => {
    ;((t.pattern ??= ze), O.init(e, t))
  }),
  Vt = i(`$ZodCUID2`, (e, t) => {
    ;((t.pattern ??= Be), O.init(e, t))
  }),
  Ht = i(`$ZodULID`, (e, t) => {
    ;((t.pattern ??= Ve), O.init(e, t))
  }),
  Ut = i(`$ZodXID`, (e, t) => {
    ;((t.pattern ??= He), O.init(e, t))
  }),
  Wt = i(`$ZodKSUID`, (e, t) => {
    ;((t.pattern ??= Ue), O.init(e, t))
  }),
  Gt = i(`$ZodISODateTime`, (e, t) => {
    ;((t.pattern ??= ct(t)), O.init(e, t))
  }),
  Kt = i(`$ZodISODate`, (e, t) => {
    ;((t.pattern ??= at), O.init(e, t))
  }),
  qt = i(`$ZodISOTime`, (e, t) => {
    ;((t.pattern ??= st(t)), O.init(e, t))
  }),
  Jt = i(`$ZodISODuration`, (e, t) => {
    ;((t.pattern ??= Ge), O.init(e, t))
  }),
  Yt = i(`$ZodIPv4`, (e, t) => {
    ;((t.pattern ??= Xe), O.init(e, t), (e._zod.bag.format = `ipv4`))
  }),
  Xt = i(`$ZodIPv6`, (e, t) => {
    ;((t.pattern ??= Ze),
      O.init(e, t),
      (e._zod.bag.format = `ipv6`),
      (e._zod.check = (n) => {
        try {
          new URL(`http://[${n.value}]`)
        } catch {
          n.issues.push({ code: `invalid_format`, format: `ipv6`, input: n.value, inst: e, continue: !t.abort })
        }
      }))
  }),
  Zt = i(`$ZodCIDRv4`, (e, t) => {
    ;((t.pattern ??= Qe), O.init(e, t))
  }),
  Qt = i(`$ZodCIDRv6`, (e, t) => {
    ;((t.pattern ??= $e),
      O.init(e, t),
      (e._zod.check = (n) => {
        let r = n.value.split(`/`)
        try {
          if (r.length !== 2) throw Error()
          let [e, t] = r
          if (!t) throw Error()
          let n = Number(t)
          if (`${n}` !== t || n < 0 || n > 128) throw Error()
          new URL(`http://[${e}]`)
        } catch {
          n.issues.push({ code: `invalid_format`, format: `cidrv6`, input: n.value, inst: e, continue: !t.abort })
        }
      }))
  })
function $t(e) {
  if (e === ``) return !0
  if (/\s/.test(e) || e.length % 4 != 0) return !1
  try {
    return (atob(e), !0)
  } catch {
    return !1
  }
}
const en = i(`$ZodBase64`, (e, t) => {
  ;((t.pattern ??= et),
    O.init(e, t),
    (e._zod.bag.contentEncoding = `base64`),
    (e._zod.check = (n) => {
      $t(n.value) ||
        n.issues.push({ code: `invalid_format`, format: `base64`, input: n.value, inst: e, continue: !t.abort })
    }))
})
function tn(e) {
  if (!tt.test(e)) return !1
  let t = e.replace(/[-_]/g, (e) => (e === `-` ? `+` : `/`))
  return $t(t.padEnd(Math.ceil(t.length / 4) * 4, `=`))
}
const nn = i(`$ZodBase64URL`, (e, t) => {
    ;((t.pattern ??= tt),
      O.init(e, t),
      (e._zod.bag.contentEncoding = `base64url`),
      (e._zod.check = (n) => {
        tn(n.value) ||
          n.issues.push({ code: `invalid_format`, format: `base64url`, input: n.value, inst: e, continue: !t.abort })
      }))
  }),
  rn = i(`$ZodE164`, (e, t) => {
    ;((t.pattern ??= rt), O.init(e, t))
  })
function an(e, t = null) {
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
const on = i(`$ZodJWT`, (e, t) => {
    ;(O.init(e, t),
      (e._zod.check = (n) => {
        an(n.value, t.alg) ||
          n.issues.push({ code: `invalid_format`, format: `jwt`, input: n.value, inst: e, continue: !t.abort })
      }))
  }),
  sn = i(`$ZodNumber`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.pattern = e._zod.bag.pattern ?? dt),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = Number(n.value)
          } catch {}
        let i = n.value
        if (typeof i == `number` && !Number.isNaN(i) && Number.isFinite(i)) return n
        let a = typeof i == `number` ? (Number.isNaN(i) ? `NaN` : Number.isFinite(i) ? void 0 : `Infinity`) : void 0
        return (
          n.issues.push({ expected: `number`, code: `invalid_type`, input: i, inst: e, ...(a ? { received: a } : {}) }),
          n
        )
      }))
  }),
  cn = i(`$ZodNumberFormat`, (e, t) => {
    ;(yt.init(e, t), sn.init(e, t))
  }),
  ln = i(`$ZodBoolean`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.pattern = ft),
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
  un = i(`$ZodUnknown`, (e, t) => {
    ;(D.init(e, t), (e._zod.parse = (e) => e))
  }),
  dn = i(`$ZodNever`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.parse = (t, n) => (
        t.issues.push({ expected: `never`, code: `invalid_type`, input: t.value, inst: e }),
        t
      )))
  })
function fn(e, t, n) {
  ;(e.issues.length && t.issues.push(...C(n, e.issues)), (t.value[n] = e.value))
}
const pn = i(`$ZodArray`, (e, t) => {
  ;(D.init(e, t),
    (e._zod.parse = (n, r) => {
      let i = n.value
      if (!Array.isArray(i)) return (n.issues.push({ expected: `array`, code: `invalid_type`, input: i, inst: e }), n)
      n.value = Array(i.length)
      let a = []
      for (let e = 0; e < i.length; e++) {
        let o = i[e],
          s = t.element._zod.run({ value: o, issues: [] }, r)
        s instanceof Promise ? a.push(s.then((t) => fn(t, n, e))) : fn(s, n, e)
      }
      return a.length ? Promise.all(a).then(() => n) : n
    }))
})
function mn(e, t, n, r, i, a) {
  let o = n in r
  if (e.issues.length) {
    if (i && a && !o) return
    t.issues.push(...C(n, e.issues))
  }
  if (!o && !i) {
    e.issues.length || t.issues.push({ code: `invalid_type`, expected: `nonoptional`, input: void 0, path: [n] })
    return
  }
  e.value === void 0 ? o && (t.value[n] = void 0) : (t.value[n] = e.value)
}
function hn(e) {
  let t = Object.keys(e.shape)
  for (let n of t)
    if (!e.shape?.[n]?._zod?.traits?.has(`$ZodType`))
      throw Error(`Invalid element at key "${n}": expected a Zod schema`)
  let n = ce(e.shape)
  return { ...e, keys: t, keySet: new Set(t), numKeys: t.length, optionalKeys: new Set(n) }
}
function gn(e, t, n, r, i, a) {
  let o = [],
    s = i.keySet,
    c = i.catchall._zod,
    l = c.def.type,
    u = c.optin === `optional`,
    d = c.optout === `optional`
  for (let i in t) {
    if (i === `__proto__` || s.has(i)) continue
    if (l === `never`) {
      o.push(i)
      continue
    }
    let a = c.run({ value: t[i], issues: [] }, r)
    a instanceof Promise ? e.push(a.then((e) => mn(e, n, i, t, u, d))) : mn(a, n, i, t, u, d)
  }
  return (
    o.length && n.issues.push({ code: `unrecognized_keys`, keys: o, input: t, inst: a }),
    e.length ? Promise.all(e).then(() => n) : n
  )
}
const _n = i(`$ZodObject`, (e, t) => {
    if ((D.init(e, t), !Object.getOwnPropertyDescriptor(t, `shape`)?.get)) {
      let e = t.shape
      Object.defineProperty(t, 'shape', {
        get: () => {
          let n = { ...e }
          return (Object.defineProperty(t, 'shape', { value: n }), n)
        }
      })
    }
    let n = d(() => hn(t))
    m(e._zod, `propValues`, () => {
      let e = t.shape,
        n = {}
      for (let t in e) {
        let r = e[t]._zod
        if (r.values) {
          n[t] ?? (n[t] = new Set())
          for (let e of r.values) n[t].add(e)
        }
      }
      return n
    })
    let r = _,
      i = t.catchall,
      a
    e._zod.parse = (t, o) => {
      a ??= n.value
      let s = t.value
      if (!r(s)) return (t.issues.push({ expected: `object`, code: `invalid_type`, input: s, inst: e }), t)
      t.value = {}
      let c = [],
        l = a.shape
      for (let e of a.keys) {
        let n = l[e],
          r = n._zod.optin === `optional`,
          i = n._zod.optout === `optional`,
          a = n._zod.run({ value: s[e], issues: [] }, o)
        a instanceof Promise ? c.push(a.then((n) => mn(n, t, e, s, r, i))) : mn(a, t, e, s, r, i)
      }
      return i ? gn(c, s, t, o, n.value, e) : c.length ? Promise.all(c).then(() => t) : t
    }
  }),
  vn = i(`$ZodObjectJIT`, (e, t) => {
    _n.init(e, t)
    let n = e._zod.parse,
      r = d(() => hn(t)),
      i = (e) => {
        let t = new jt([`shape`, `payload`, `ctx`]),
          n = r.value,
          i = (e) => {
            let t = ne(e)
            return `shape[${t}]._zod.run({ value: input[${t}], issues: [] }, ctx)`
          }
        t.write(`const input = payload.value;`)
        let a = Object.create(null),
          o = 0
        for (let e of n.keys) a[e] = `key_${o++}`
        t.write(`const newResult = {};`)
        for (let r of n.keys) {
          let n = a[r],
            o = ne(r),
            s = e[r],
            c = s?._zod?.optin === `optional`,
            l = s?._zod?.optout === `optional`
          ;(t.write(`const ${n} = ${i(r)};`),
            c && l
              ? t.write(`
        if (${n}.issues.length) {
          if (${o} in input) {
            payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${o}, ...iss.path] : [${o}]
            })));
          }
        }

        if (${n}.value === undefined) {
          if (${o} in input) {
            newResult[${o}] = undefined;
          }
        } else {
          newResult[${o}] = ${n}.value;
        }

      `)
              : c
                ? t.write(`
        if (${n}.issues.length) {
          payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${o}, ...iss.path] : [${o}]
          })));
        }

        if (${n}.value === undefined) {
          if (${o} in input) {
            newResult[${o}] = undefined;
          }
        } else {
          newResult[${o}] = ${n}.value;
        }

      `)
                : t.write(`
        const ${n}_present = ${o} in input;
        if (${n}.issues.length) {
          payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${o}, ...iss.path] : [${o}]
          })));
        }
        if (!${n}_present && !${n}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${o}]
          });
        }

        if (${n}_present) {
          if (${n}.value === undefined) {
            newResult[${o}] = undefined;
          } else {
            newResult[${o}] = ${n}.value;
          }
        }

      `))
        }
        ;(t.write(`payload.value = newResult;`), t.write(`return payload;`))
        let s = t.compile()
        return (t, n) => s(e, t, n)
      },
      a,
      o = _,
      c = !s.jitless,
      l = c && ae.value,
      u = t.catchall,
      f
    e._zod.parse = (s, d) => {
      f ??= r.value
      let p = s.value
      return o(p)
        ? c && l && d?.async === !1 && d.jitless !== !0
          ? ((a ||= i(t.shape)), (s = a(s, d)), u ? gn([], p, s, d, f, e) : s)
          : n(s, d)
        : (s.issues.push({ expected: `object`, code: `invalid_type`, input: p, inst: e }), s)
    }
  })
function yn(e, t, n, r) {
  for (let n of e) if (n.issues.length === 0) return ((t.value = n.value), t)
  let i = e.filter((e) => !S(e))
  return i.length === 1
    ? ((t.value = i[0].value), i[0])
    : (t.issues.push({
        code: `invalid_union`,
        input: t.value,
        inst: n,
        errors: e.map((e) => e.issues.map((e) => w(e, r, c())))
      }),
      t)
}
const bn = i(`$ZodUnion`, (e, t) => {
    ;(D.init(e, t),
      m(e._zod, `optin`, () => (t.options.some((e) => e._zod.optin === `optional`) ? `optional` : void 0)),
      m(e._zod, `optout`, () => (t.options.some((e) => e._zod.optout === `optional`) ? `optional` : void 0)),
      m(e._zod, `values`, () => {
        if (t.options.every((e) => e._zod.values)) return new Set(t.options.flatMap((e) => Array.from(e._zod.values)))
      }),
      m(e._zod, `pattern`, () => {
        if (t.options.every((e) => e._zod.pattern)) {
          let e = t.options.map((e) => e._zod.pattern)
          return RegExp(`^(${e.map((e) => p(e.source)).join(`|`)})$`)
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
      return a ? Promise.all(o).then((t) => yn(t, r, e, i)) : yn(o, r, e, i)
    }
  }),
  xn = i(`$ZodDiscriminatedUnion`, (e, t) => {
    ;((t.inclusive = !1), bn.init(e, t))
    let n = e._zod.parse
    m(e._zod, `propValues`, () => {
      let e = {}
      for (let n of t.options) {
        let r = n._zod.propValues
        if (!r || Object.keys(r).length === 0)
          throw Error(`Invalid discriminated union option at index "${t.options.indexOf(n)}"`)
        for (let [t, n] of Object.entries(r)) {
          e[t] || (e[t] = new Set())
          for (let r of n) e[t].add(r)
        }
      }
      return e
    })
    let r = d(() => {
      let e = t.options,
        n = new Map()
      for (let r of e) {
        let e = r._zod.propValues?.[t.discriminator]
        if (!e || e.size === 0) throw Error(`Invalid discriminated union option at index "${t.options.indexOf(r)}"`)
        for (let t of e) {
          if (n.has(t)) throw Error(`Duplicate discriminator value "${String(t)}"`)
          n.set(t, r)
        }
      }
      return n
    })
    e._zod.parse = (i, a) => {
      let o = i.value
      if (!_(o)) return (i.issues.push({ code: `invalid_type`, expected: `object`, input: o, inst: e }), i)
      let s = r.value.get(o?.[t.discriminator])
      return s
        ? s._zod.run(i, a)
        : t.unionFallback || a.direction === `backward`
          ? n(i, a)
          : (i.issues.push({
              code: `invalid_union`,
              errors: [],
              note: `No matching discriminator`,
              discriminator: t.discriminator,
              options: Array.from(r.value.keys()),
              input: o,
              path: [t.discriminator],
              inst: e
            }),
            i)
    }
  }),
  Sn = i(`$ZodIntersection`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.parse = (e, n) => {
        let r = e.value,
          i = t.left._zod.run({ value: r, issues: [] }, n),
          a = t.right._zod.run({ value: r, issues: [] }, n)
        return i instanceof Promise || a instanceof Promise
          ? Promise.all([i, a]).then(([t, n]) => wn(e, t, n))
          : wn(e, i, a)
      }))
  })
function Cn(e, t) {
  if (e === t || (e instanceof Date && t instanceof Date && +e == +t)) return { valid: !0, data: e }
  if (v(e) && v(t)) {
    let n = Object.keys(t),
      r = Object.keys(e).filter((e) => n.indexOf(e) !== -1),
      i = { ...e, ...t }
    for (let n of r) {
      let r = Cn(e[n], t[n])
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
        o = Cn(i, a)
      if (!o.valid) return { valid: !1, mergeErrorPath: [r, ...o.mergeErrorPath] }
      n.push(o.data)
    }
    return { valid: !0, data: n }
  }
  return { valid: !1, mergeErrorPath: [] }
}
function wn(e, t, n) {
  let r = new Map(),
    i
  for (let n of t.issues)
    if (n.code === `unrecognized_keys`) {
      i ??= n
      for (let e of n.keys) (r.has(e) || r.set(e, {}), (r.get(e).l = !0))
    } else e.issues.push(n)
  for (let t of n.issues)
    if (t.code === `unrecognized_keys`) for (let e of t.keys) (r.has(e) || r.set(e, {}), (r.get(e).r = !0))
    else e.issues.push(t)
  let a = [...r].filter(([, e]) => e.l && e.r).map(([e]) => e)
  if ((a.length && i && e.issues.push({ ...i, keys: a }), S(e))) return e
  let o = Cn(t.value, n.value)
  if (!o.valid) throw Error(`Unmergable intersection. Error path: ${JSON.stringify(o.mergeErrorPath)}`)
  return ((e.value = o.data), e)
}
const Tn = i(`$ZodRecord`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.parse = (n, r) => {
        let i = n.value
        if (!v(i)) return (n.issues.push({ expected: `record`, code: `invalid_type`, input: i, inst: e }), n)
        let a = [],
          o = t.keyType._zod.values
        if (o) {
          n.value = {}
          let s = new Set()
          for (let l of o)
            if (typeof l == `string` || typeof l == `number` || typeof l == `symbol`) {
              s.add(typeof l == `number` ? l.toString() : l)
              let o = t.keyType._zod.run({ value: l, issues: [] }, r)
              if (o instanceof Promise) throw Error(`Async schemas not supported in object keys currently`)
              if (o.issues.length) {
                n.issues.push({
                  code: `invalid_key`,
                  origin: `record`,
                  issues: o.issues.map((e) => w(e, r, c())),
                  input: l,
                  path: [l],
                  inst: e
                })
                continue
              }
              let u = o.value,
                d = t.valueType._zod.run({ value: i[l], issues: [] }, r)
              d instanceof Promise
                ? a.push(
                    d.then((e) => {
                      ;(e.issues.length && n.issues.push(...C(l, e.issues)), (n.value[u] = e.value))
                    })
                  )
                : (d.issues.length && n.issues.push(...C(l, d.issues)), (n.value[u] = d.value))
            }
          let l
          for (let e in i) s.has(e) || ((l ??= []), l.push(e))
          l && l.length > 0 && n.issues.push({ code: `unrecognized_keys`, input: i, inst: e, keys: l })
        } else {
          n.value = {}
          for (let o of Reflect.ownKeys(i)) {
            if (o === `__proto__` || !Object.prototype.propertyIsEnumerable.call(i, o)) continue
            let s = t.keyType._zod.run({ value: o, issues: [] }, r)
            if (s instanceof Promise) throw Error(`Async schemas not supported in object keys currently`)
            if (typeof o == `string` && dt.test(o) && s.issues.length) {
              let e = t.keyType._zod.run({ value: Number(o), issues: [] }, r)
              if (e instanceof Promise) throw Error(`Async schemas not supported in object keys currently`)
              e.issues.length === 0 && (s = e)
            }
            if (s.issues.length) {
              t.mode === `loose`
                ? (n.value[o] = i[o])
                : n.issues.push({
                    code: `invalid_key`,
                    origin: `record`,
                    issues: s.issues.map((e) => w(e, r, c())),
                    input: o,
                    path: [o],
                    inst: e
                  })
              continue
            }
            let l = t.valueType._zod.run({ value: i[o], issues: [] }, r)
            l instanceof Promise
              ? a.push(
                  l.then((e) => {
                    ;(e.issues.length && n.issues.push(...C(o, e.issues)), (n.value[s.value] = e.value))
                  })
                )
              : (l.issues.length && n.issues.push(...C(o, l.issues)), (n.value[s.value] = l.value))
          }
        }
        return a.length ? Promise.all(a).then(() => n) : n
      }))
  }),
  En = i(`$ZodEnum`, (e, t) => {
    D.init(e, t)
    let n = l(t.entries),
      r = new Set(n)
    ;((e._zod.values = r),
      (e._zod.pattern = RegExp(
        `^(${n
          .filter((e) => se.has(typeof e))
          .map((e) => (typeof e == `string` ? y(e) : e.toString()))
          .join(`|`)})$`
      )),
      (e._zod.parse = (t, i) => {
        let a = t.value
        return (r.has(a) || t.issues.push({ code: `invalid_value`, values: n, input: a, inst: e }), t)
      }))
  }),
  Dn = i(`$ZodLiteral`, (e, t) => {
    if ((D.init(e, t), t.values.length === 0)) throw Error(`Cannot create literal schema with no valid values`)
    let n = new Set(t.values)
    ;((e._zod.values = n),
      (e._zod.pattern = RegExp(
        `^(${t.values.map((e) => (typeof e == `string` ? y(e) : e ? y(e.toString()) : String(e))).join(`|`)})$`
      )),
      (e._zod.parse = (r, i) => {
        let a = r.value
        return (n.has(a) || r.issues.push({ code: `invalid_value`, values: t.values, input: a, inst: e }), r)
      }))
  }),
  On = i(`$ZodTransform`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.optin = `optional`),
      (e._zod.parse = (n, r) => {
        if (r.direction === `backward`) throw new o(e.constructor.name)
        let i = t.transform(n.value, n)
        if (r.async)
          return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => ((n.value = e), (n.fallback = !0), n))
        if (i instanceof Promise) throw new a()
        return ((n.value = i), (n.fallback = !0), n)
      }))
  })
function kn(e, t) {
  return t === void 0 && (e.issues.length || e.fallback) ? { issues: [], value: void 0 } : e
}
const An = i(`$ZodOptional`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.optin = `optional`),
      (e._zod.optout = `optional`),
      m(e._zod, `values`, () => (t.innerType._zod.values ? new Set([...t.innerType._zod.values, void 0]) : void 0)),
      m(e._zod, `pattern`, () => {
        let e = t.innerType._zod.pattern
        return e ? RegExp(`^(${p(e.source)})?$`) : void 0
      }),
      (e._zod.parse = (e, n) => {
        if (t.innerType._zod.optin === `optional`) {
          let r = e.value,
            i = t.innerType._zod.run(e, n)
          return i instanceof Promise ? i.then((e) => kn(e, r)) : kn(i, r)
        }
        return e.value === void 0 ? e : t.innerType._zod.run(e, n)
      }))
  }),
  jn = i(`$ZodExactOptional`, (e, t) => {
    ;(An.init(e, t),
      m(e._zod, `values`, () => t.innerType._zod.values),
      m(e._zod, `pattern`, () => t.innerType._zod.pattern),
      (e._zod.parse = (e, n) => t.innerType._zod.run(e, n)))
  }),
  Mn = i(`$ZodNullable`, (e, t) => {
    ;(D.init(e, t),
      m(e._zod, `optin`, () => t.innerType._zod.optin),
      m(e._zod, `optout`, () => t.innerType._zod.optout),
      m(e._zod, `pattern`, () => {
        let e = t.innerType._zod.pattern
        return e ? RegExp(`^(${p(e.source)}|null)$`) : void 0
      }),
      m(e._zod, `values`, () => (t.innerType._zod.values ? new Set([...t.innerType._zod.values, null]) : void 0)),
      (e._zod.parse = (e, n) => (e.value === null ? e : t.innerType._zod.run(e, n))))
  }),
  Nn = i(`$ZodDefault`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.optin = `optional`),
      m(e._zod, `values`, () => t.innerType._zod.values),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n)
        if (e.value === void 0) return ((e.value = t.defaultValue), e)
        let r = t.innerType._zod.run(e, n)
        return r instanceof Promise ? r.then((e) => Pn(e, t)) : Pn(r, t)
      }))
  })
function Pn(e, t) {
  return (e.value === void 0 && (e.value = t.defaultValue), e)
}
const Fn = i(`$ZodPrefault`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.optin = `optional`),
      m(e._zod, `values`, () => t.innerType._zod.values),
      (e._zod.parse = (e, n) => (
        n.direction === `backward` || (e.value === void 0 && (e.value = t.defaultValue)),
        t.innerType._zod.run(e, n)
      )))
  }),
  In = i(`$ZodNonOptional`, (e, t) => {
    ;(D.init(e, t),
      m(e._zod, `values`, () => {
        let e = t.innerType._zod.values
        return e ? new Set([...e].filter((e) => e !== void 0)) : void 0
      }),
      (e._zod.parse = (n, r) => {
        let i = t.innerType._zod.run(n, r)
        return i instanceof Promise ? i.then((t) => Ln(t, e)) : Ln(i, e)
      }))
  })
function Ln(e, t) {
  return (
    !e.issues.length &&
      e.value === void 0 &&
      e.issues.push({ code: `invalid_type`, expected: `nonoptional`, input: e.value, inst: t }),
    e
  )
}
const Rn = i(`$ZodCatch`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.optin = `optional`),
      m(e._zod, `optout`, () => t.innerType._zod.optout),
      m(e._zod, `values`, () => t.innerType._zod.values),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n)
        let r = t.innerType._zod.run(e, n)
        return r instanceof Promise
          ? r.then(
              (r) => (
                (e.value = r.value),
                r.issues.length &&
                  ((e.value = t.catchValue({
                    ...e,
                    error: { issues: r.issues.map((e) => w(e, n, c())) },
                    input: e.value
                  })),
                  (e.issues = []),
                  (e.fallback = !0)),
                e
              )
            )
          : ((e.value = r.value),
            r.issues.length &&
              ((e.value = t.catchValue({ ...e, error: { issues: r.issues.map((e) => w(e, n, c())) }, input: e.value })),
              (e.issues = []),
              (e.fallback = !0)),
            e)
      }))
  }),
  zn = i(`$ZodPipe`, (e, t) => {
    ;(D.init(e, t),
      m(e._zod, `values`, () => t.in._zod.values),
      m(e._zod, `optin`, () => t.in._zod.optin),
      m(e._zod, `optout`, () => t.out._zod.optout),
      m(e._zod, `propValues`, () => t.in._zod.propValues),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) {
          let r = t.out._zod.run(e, n)
          return r instanceof Promise ? r.then((e) => Bn(e, t.in, n)) : Bn(r, t.in, n)
        }
        let r = t.in._zod.run(e, n)
        return r instanceof Promise ? r.then((e) => Bn(e, t.out, n)) : Bn(r, t.out, n)
      }))
  })
function Bn(e, t, n) {
  return e.issues.length
    ? ((e.aborted = !0), e)
    : t._zod.run({ value: e.value, issues: e.issues, fallback: e.fallback }, n)
}
const Vn = i(`$ZodReadonly`, (e, t) => {
  ;(D.init(e, t),
    m(e._zod, `propValues`, () => t.innerType._zod.propValues),
    m(e._zod, `values`, () => t.innerType._zod.values),
    m(e._zod, `optin`, () => t.innerType?._zod?.optin),
    m(e._zod, `optout`, () => t.innerType?._zod?.optout),
    (e._zod.parse = (e, n) => {
      if (n.direction === `backward`) return t.innerType._zod.run(e, n)
      let r = t.innerType._zod.run(e, n)
      return r instanceof Promise ? r.then(Hn) : Hn(r)
    }))
})
function Hn(e) {
  return ((e.value = Object.freeze(e.value)), e)
}
const Un = i(`$ZodCustom`, (e, t) => {
  ;(E.init(e, t),
    D.init(e, t),
    (e._zod.parse = (e, t) => e),
    (e._zod.check = (n) => {
      let r = n.value,
        i = t.fn(r)
      if (i instanceof Promise) return i.then((t) => Wn(t, n, r, e))
      Wn(i, n, r, e)
    }))
})
function Wn(e, t, n, r) {
  if (!e) {
    let e = { code: `custom`, input: n, inst: r, path: [...(r._zod.def.path ?? [])], continue: !r._zod.def.abort }
    ;(r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(T(e)))
  }
}
var Gn,
  Kn = class {
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
function qn() {
  return new Kn()
}
;(Gn = globalThis).__zod_globalRegistry ?? (Gn.__zod_globalRegistry = qn())
const k = globalThis.__zod_globalRegistry
function Jn(e, t) {
  return new e({ type: `string`, ...x(t) })
}
function Yn(e, t) {
  return new e({ type: `string`, format: `email`, check: `string_format`, abort: !1, ...x(t) })
}
function Xn(e, t) {
  return new e({ type: `string`, format: `guid`, check: `string_format`, abort: !1, ...x(t) })
}
function Zn(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, ...x(t) })
}
function Qn(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v4`, ...x(t) })
}
function $n(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v6`, ...x(t) })
}
function er(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v7`, ...x(t) })
}
function tr(e, t) {
  return new e({ type: `string`, format: `url`, check: `string_format`, abort: !1, ...x(t) })
}
function nr(e, t) {
  return new e({ type: `string`, format: `emoji`, check: `string_format`, abort: !1, ...x(t) })
}
function rr(e, t) {
  return new e({ type: `string`, format: `nanoid`, check: `string_format`, abort: !1, ...x(t) })
}
function ir(e, t) {
  return new e({ type: `string`, format: `cuid`, check: `string_format`, abort: !1, ...x(t) })
}
function ar(e, t) {
  return new e({ type: `string`, format: `cuid2`, check: `string_format`, abort: !1, ...x(t) })
}
function or(e, t) {
  return new e({ type: `string`, format: `ulid`, check: `string_format`, abort: !1, ...x(t) })
}
function sr(e, t) {
  return new e({ type: `string`, format: `xid`, check: `string_format`, abort: !1, ...x(t) })
}
function cr(e, t) {
  return new e({ type: `string`, format: `ksuid`, check: `string_format`, abort: !1, ...x(t) })
}
function lr(e, t) {
  return new e({ type: `string`, format: `ipv4`, check: `string_format`, abort: !1, ...x(t) })
}
function ur(e, t) {
  return new e({ type: `string`, format: `ipv6`, check: `string_format`, abort: !1, ...x(t) })
}
function dr(e, t) {
  return new e({ type: `string`, format: `cidrv4`, check: `string_format`, abort: !1, ...x(t) })
}
function fr(e, t) {
  return new e({ type: `string`, format: `cidrv6`, check: `string_format`, abort: !1, ...x(t) })
}
function pr(e, t) {
  return new e({ type: `string`, format: `base64`, check: `string_format`, abort: !1, ...x(t) })
}
function mr(e, t) {
  return new e({ type: `string`, format: `base64url`, check: `string_format`, abort: !1, ...x(t) })
}
function hr(e, t) {
  return new e({ type: `string`, format: `e164`, check: `string_format`, abort: !1, ...x(t) })
}
function gr(e, t) {
  return new e({ type: `string`, format: `jwt`, check: `string_format`, abort: !1, ...x(t) })
}
function _r(e, t) {
  return new e({
    type: `string`,
    format: `datetime`,
    check: `string_format`,
    offset: !1,
    local: !1,
    precision: null,
    ...x(t)
  })
}
function vr(e, t) {
  return new e({ type: `string`, format: `date`, check: `string_format`, ...x(t) })
}
function yr(e, t) {
  return new e({ type: `string`, format: `time`, check: `string_format`, precision: null, ...x(t) })
}
function br(e, t) {
  return new e({ type: `string`, format: `duration`, check: `string_format`, ...x(t) })
}
function xr(e, t) {
  return new e({ type: `number`, checks: [], ...x(t) })
}
function Sr(e, t) {
  return new e({ type: `number`, check: `number_format`, abort: !1, format: `safeint`, ...x(t) })
}
function Cr(e, t) {
  return new e({ type: `boolean`, ...x(t) })
}
function wr(e) {
  return new e({ type: `unknown` })
}
function Tr(e, t) {
  return new e({ type: `never`, ...x(t) })
}
function Er(e, t) {
  return new gt({ check: `less_than`, ...x(t), value: e, inclusive: !1 })
}
function Dr(e, t) {
  return new gt({ check: `less_than`, ...x(t), value: e, inclusive: !0 })
}
function Or(e, t) {
  return new _t({ check: `greater_than`, ...x(t), value: e, inclusive: !1 })
}
function kr(e, t) {
  return new _t({ check: `greater_than`, ...x(t), value: e, inclusive: !0 })
}
function Ar(e, t) {
  return new vt({ check: `multiple_of`, ...x(t), value: e })
}
function jr(e, t) {
  return new bt({ check: `max_length`, ...x(t), maximum: e })
}
function Mr(e, t) {
  return new xt({ check: `min_length`, ...x(t), minimum: e })
}
function Nr(e, t) {
  return new St({ check: `length_equals`, ...x(t), length: e })
}
function Pr(e, t) {
  return new wt({ check: `string_format`, format: `regex`, ...x(t), pattern: e })
}
function Fr(e) {
  return new Tt({ check: `string_format`, format: `lowercase`, ...x(e) })
}
function Ir(e) {
  return new Et({ check: `string_format`, format: `uppercase`, ...x(e) })
}
function Lr(e, t) {
  return new Dt({ check: `string_format`, format: `includes`, ...x(t), includes: e })
}
function Rr(e, t) {
  return new Ot({ check: `string_format`, format: `starts_with`, ...x(t), prefix: e })
}
function zr(e, t) {
  return new kt({ check: `string_format`, format: `ends_with`, ...x(t), suffix: e })
}
function A(e) {
  return new At({ check: `overwrite`, tx: e })
}
function Br(e) {
  return A((t) => t.normalize(e))
}
function Vr() {
  return A((e) => e.trim())
}
function Hr() {
  return A((e) => e.toLowerCase())
}
function Ur() {
  return A((e) => e.toUpperCase())
}
function Wr() {
  return A((e) => re(e))
}
function Gr(e, t, n) {
  return new e({ type: `array`, element: t, ...x(n) })
}
function Kr(e, t, n) {
  return new e({ type: `custom`, check: `custom`, fn: t, ...x(n) })
}
function qr(e, t) {
  let n = Jr(
    (t) => (
      (t.addIssue = (e) => {
        if (typeof e == `string`) t.issues.push(T(e, t.value, n._zod.def))
        else {
          let r = e
          ;(r.fatal && (r.continue = !1),
            (r.code ??= `custom`),
            (r.input ??= t.value),
            (r.inst ??= n),
            (r.continue ??= !n._zod.def.abort),
            t.issues.push(T(r)))
        }
      }),
      e(t.value, t)
    ),
    t
  )
  return n
}
function Jr(e, t) {
  let n = new E({ check: `custom`, ...x(t) })
  return ((n._zod.check = e), n)
}
function Yr(e) {
  let t = e?.target ?? `draft-2020-12`
  return (
    t === `draft-4` && (t = `draft-04`),
    t === `draft-7` && (t = `draft-07`),
    {
      processors: e.processors ?? {},
      metadataRegistry: e?.metadata ?? k,
      target: t,
      unrepresentable: e?.unrepresentable ?? `throw`,
      override: e?.override ?? (() => {}),
      io: e?.io ?? `output`,
      counter: 0,
      seen: new Map(),
      cycles: e?.cycles ?? `ref`,
      reused: e?.reused ?? `inline`,
      external: e?.external ?? void 0
    }
  )
}
function j(e, t, n = { path: [], schemaPath: [] }) {
  var r
  let i = e._zod.def,
    a = t.seen.get(e)
  if (a) return (a.count++, n.schemaPath.includes(e) && (a.cycle = n.path), a.schema)
  let o = { schema: {}, count: 1, cycle: void 0, path: n.path }
  t.seen.set(e, o)
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
    a && ((o.ref ||= a), j(a, t, r), (t.seen.get(a).isParent = !0))
  }
  let c = t.metadataRegistry.get(e)
  return (
    c && Object.assign(o.schema, c),
    t.io === `input` && M(e) && (delete o.schema.examples, delete o.schema.default),
    t.io === `input` && `_prefault` in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)),
    delete o.schema._prefault,
    t.seen.get(e).schema
  )
}
function Xr(e, t) {
  let n = e.seen.get(t)
  if (!n) throw Error(`Unprocessed schema. This is a bug in Zod.`)
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
        return ((t[1].defId = a), { defId: a, ref: `${i(`__shared`)}#/${r}/${a}` })
      }
      if (t[1] === n) return { ref: `#` }
      let i = `#/${r}/`,
        a = t[1].schema.id ?? `__schema${e.counter++}`
      return { defId: a, ref: i + a }
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
    if (r.count > 1 && e.reused === `ref`) {
      a(n)
      continue
    }
  }
}
function Zr(e, t) {
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
          : Object.assign(i, s),
        Object.assign(i, a),
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
  for (let t of [...e.seen.entries()].reverse()) r(t[0])
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
  Object.assign(i, n.def ?? n.schema)
  let a = e.metadataRegistry.get(t)?.id
  a !== void 0 && i.id === a && delete i.id
  let o = e.external?.defs ?? {}
  for (let t of e.seen.entries()) {
    let e = t[1]
    e.def && e.defId && (e.def.id === e.defId && delete e.def.id, (o[e.defId] = e.def))
  }
  e.external || (Object.keys(o).length > 0 && (e.target === `draft-2020-12` ? (i.$defs = o) : (i.definitions = o)))
  try {
    let n = JSON.parse(JSON.stringify(i))
    return (
      Object.defineProperty(n, '~standard', {
        value: {
          ...t[`~standard`],
          jsonSchema: { input: $r(t, `input`, e.processors), output: $r(t, `output`, e.processors) }
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
function M(e, t) {
  let n = t ?? { seen: new Set() }
  if (n.seen.has(e)) return !1
  n.seen.add(e)
  let r = e._zod.def
  if (r.type === `transform`) return !0
  if (r.type === `array`) return M(r.element, n)
  if (r.type === `set`) return M(r.valueType, n)
  if (r.type === `lazy`) return M(r.getter(), n)
  if (
    r.type === `promise` ||
    r.type === `optional` ||
    r.type === `nonoptional` ||
    r.type === `nullable` ||
    r.type === `readonly` ||
    r.type === 'default' ||
    r.type === `prefault`
  )
    return M(r.innerType, n)
  if (r.type === `intersection`) return M(r.left, n) || M(r.right, n)
  if (r.type === `record` || r.type === `map`) return M(r.keyType, n) || M(r.valueType, n)
  if (r.type === `pipe`) return e._zod.traits.has(`$ZodCodec`) ? !0 : M(r.in, n) || M(r.out, n)
  if (r.type === `object`) {
    for (let e in r.shape) if (M(r.shape[e], n)) return !0
    return !1
  }
  if (r.type === `union`) {
    for (let e of r.options) if (M(e, n)) return !0
    return !1
  }
  if (r.type === `tuple`) {
    for (let e of r.items) if (M(e, n)) return !0
    return !!(r.rest && M(r.rest, n))
  }
  return !1
}
const Qr =
    (e, t = {}) =>
    (n) => {
      let r = Yr({ ...n, processors: t })
      return (j(e, r), Xr(r, e), Zr(r, e))
    },
  $r =
    (e, t, n = {}) =>
    (r) => {
      let { libraryOptions: i, target: a } = r ?? {},
        o = Yr({ ...(i ?? {}), target: a, io: t, processors: n })
      return (j(e, o), Xr(o, e), Zr(o, e))
    },
  ei = { guid: `uuid`, url: `uri`, datetime: `date-time`, json_string: `json-string`, regex: `` },
  ti = (e, t, n, r) => {
    let i = n
    i.type = `string`
    let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l } = e._zod.bag
    if (
      (typeof a == `number` && (i.minLength = a),
      typeof o == `number` && (i.maxLength = o),
      s && ((i.format = ei[s] ?? s), i.format === `` && delete i.format, s === `time` && delete i.format),
      l && (i.contentEncoding = l),
      c && c.size > 0)
    ) {
      let e = [...c]
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
  ni = (e, t, n, r) => {
    let i = n,
      { minimum: a, maximum: o, format: s, multipleOf: c, exclusiveMaximum: l, exclusiveMinimum: u } = e._zod.bag
    i.type = typeof s == `string` && s.includes(`int`) ? `integer` : `number`
    let d = typeof u == `number` && u >= (a ?? -1 / 0),
      f = typeof l == `number` && l <= (o ?? 1 / 0),
      p = t.target === `draft-04` || t.target === `openapi-3.0`
    ;(d
      ? p
        ? ((i.minimum = u), (i.exclusiveMinimum = !0))
        : (i.exclusiveMinimum = u)
      : typeof a == `number` && (i.minimum = a),
      f
        ? p
          ? ((i.maximum = l), (i.exclusiveMaximum = !0))
          : (i.exclusiveMaximum = l)
        : typeof o == `number` && (i.maximum = o),
      typeof c == `number` && (i.multipleOf = c))
  },
  ri = (e, t, n, r) => {
    n.type = `boolean`
  },
  ii = (e, t, n, r) => {
    n.not = {}
  },
  ai = (e, t, n, r) => {
    let i = e._zod.def,
      a = l(i.entries)
    ;(a.every((e) => typeof e == `number`) && (n.type = `number`),
      a.every((e) => typeof e == `string`) && (n.type = `string`),
      (n.enum = a))
  },
  oi = (e, t, n, r) => {
    let i = e._zod.def,
      a = []
    for (let e of i.values)
      if (e === void 0) {
        if (t.unrepresentable === `throw`) throw Error('Literal `undefined` cannot be represented in JSON Schema')
      } else if (typeof e == `bigint`) {
        if (t.unrepresentable === `throw`) throw Error(`BigInt literals cannot be represented in JSON Schema`)
        a.push(Number(e))
      } else a.push(e)
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
  si = (e, t, n, r) => {
    if (t.unrepresentable === `throw`) throw Error(`Custom types cannot be represented in JSON Schema`)
  },
  ci = (e, t, n, r) => {
    if (t.unrepresentable === `throw`) throw Error(`Transforms cannot be represented in JSON Schema`)
  },
  li = (e, t, n, r) => {
    let i = n,
      a = e._zod.def,
      { minimum: o, maximum: s } = e._zod.bag
    ;(typeof o == `number` && (i.minItems = o),
      typeof s == `number` && (i.maxItems = s),
      (i.type = `array`),
      (i.items = j(a.element, t, { ...r, path: [...r.path, `items`] })))
  },
  ui = (e, t, n, r) => {
    let i = n,
      a = e._zod.def
    ;((i.type = `object`), (i.properties = {}))
    let o = a.shape
    for (let e in o) i.properties[e] = j(o[e], t, { ...r, path: [...r.path, `properties`, e] })
    let s = new Set(Object.keys(o)),
      c = new Set(
        [...s].filter((e) => {
          let n = a.shape[e]._zod
          return t.io === `input` ? n.optin === void 0 : n.optout === void 0
        })
      )
    ;(c.size > 0 && (i.required = Array.from(c)),
      a.catchall?._zod.def.type === `never`
        ? (i.additionalProperties = !1)
        : a.catchall
          ? a.catchall &&
            (i.additionalProperties = j(a.catchall, t, { ...r, path: [...r.path, `additionalProperties`] }))
          : t.io === `output` && (i.additionalProperties = !1))
  },
  di = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.inclusive === !1,
      o = i.options.map((e, n) => j(e, t, { ...r, path: [...r.path, a ? `oneOf` : `anyOf`, n] }))
    a ? (n.oneOf = o) : (n.anyOf = o)
  },
  fi = (e, t, n, r) => {
    let i = e._zod.def,
      a = j(i.left, t, { ...r, path: [...r.path, `allOf`, 0] }),
      o = j(i.right, t, { ...r, path: [...r.path, `allOf`, 1] }),
      s = (e) => `allOf` in e && Object.keys(e).length === 1
    n.allOf = [...(s(a) ? a.allOf : [a]), ...(s(o) ? o.allOf : [o])]
  },
  pi = (e, t, n, r) => {
    let i = n,
      a = e._zod.def
    i.type = `object`
    let o = a.keyType,
      s = o._zod.bag?.patterns
    if (a.mode === `loose` && s && s.size > 0) {
      let e = j(a.valueType, t, { ...r, path: [...r.path, `patternProperties`, `*`] })
      i.patternProperties = {}
      for (let t of s) i.patternProperties[t.source] = e
    } else
      ((t.target === `draft-07` || t.target === `draft-2020-12`) &&
        (i.propertyNames = j(a.keyType, t, { ...r, path: [...r.path, `propertyNames`] })),
        (i.additionalProperties = j(a.valueType, t, { ...r, path: [...r.path, `additionalProperties`] })))
    let c = o._zod.values
    if (c) {
      let e = [...c].filter((e) => typeof e == `string` || typeof e == `number`)
      e.length > 0 && (i.required = e)
    }
  },
  mi = (e, t, n, r) => {
    let i = e._zod.def,
      a = j(i.innerType, t, r),
      o = t.seen.get(e)
    t.target === `openapi-3.0` ? ((o.ref = i.innerType), (n.nullable = !0)) : (n.anyOf = [a, { type: `null` }])
  },
  hi = (e, t, n, r) => {
    let i = e._zod.def
    j(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
  },
  gi = (e, t, n, r) => {
    let i = e._zod.def
    j(i.innerType, t, r)
    let a = t.seen.get(e)
    ;((a.ref = i.innerType), (n.default = JSON.parse(JSON.stringify(i.defaultValue))))
  },
  _i = (e, t, n, r) => {
    let i = e._zod.def
    j(i.innerType, t, r)
    let a = t.seen.get(e)
    ;((a.ref = i.innerType), t.io === `input` && (n._prefault = JSON.parse(JSON.stringify(i.defaultValue))))
  },
  vi = (e, t, n, r) => {
    let i = e._zod.def
    j(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
    let o
    try {
      o = i.catchValue(void 0)
    } catch {
      throw Error(`Dynamic catch values are not supported in JSON Schema`)
    }
    n.default = o
  },
  yi = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.in._zod.traits.has(`$ZodTransform`),
      o = t.io === `input` ? (a ? i.out : i.in) : i.out
    j(o, t, r)
    let s = t.seen.get(e)
    s.ref = o
  },
  bi = (e, t, n, r) => {
    let i = e._zod.def
    j(i.innerType, t, r)
    let a = t.seen.get(e)
    ;((a.ref = i.innerType), (n.readOnly = !0))
  },
  xi = (e, t, n, r) => {
    let i = e._zod.def
    j(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
  },
  Si = i(`ZodISODateTime`, (e, t) => {
    ;(Gt.init(e, t), L.init(e, t))
  })
function Ci(e) {
  return _r(Si, e)
}
const wi = i(`ZodISODate`, (e, t) => {
  ;(Kt.init(e, t), L.init(e, t))
})
function Ti(e) {
  return vr(wi, e)
}
const Ei = i(`ZodISOTime`, (e, t) => {
  ;(qt.init(e, t), L.init(e, t))
})
function Di(e) {
  return yr(Ei, e)
}
const Oi = i(`ZodISODuration`, (e, t) => {
  ;(Jt.init(e, t), L.init(e, t))
})
function ki(e) {
  return br(Oi, e)
}
const N = i(
    `ZodError`,
    (e, t) => {
      ;(xe.init(e, t),
        (e.name = `ZodError`),
        Object.defineProperties(e, {
          format: { value: (t) => we(e, t) },
          flatten: { value: (t) => Ce(e, t) },
          addIssue: {
            value: (t) => {
              ;(e.issues.push(t), (e.message = JSON.stringify(e.issues, u, 2)))
            }
          },
          addIssues: {
            value: (t) => {
              ;(e.issues.push(...t), (e.message = JSON.stringify(e.issues, u, 2)))
            }
          },
          isEmpty: {
            get() {
              return e.issues.length === 0
            }
          }
        }))
    },
    { Parent: Error }
  ),
  Ai = Te(N),
  ji = Ee(N),
  Mi = De(N),
  Ni = ke(N),
  Pi = je(N),
  Fi = Me(N),
  Ii = Ne(N),
  Li = Pe(N),
  Ri = Fe(N),
  zi = Ie(N),
  Bi = Le(N),
  Vi = Re(N),
  Hi = new WeakMap()
function P(e, t, n) {
  let r = Object.getPrototypeOf(e),
    i = Hi.get(r)
  if ((i || ((i = new Set()), Hi.set(r, i)), !i.has(t))) {
    i.add(t)
    for (let e in n) {
      let t = n[e]
      Object.defineProperty(r, e, {
        configurable: !0,
        enumerable: !1,
        get() {
          let n = t.bind(this)
          return (Object.defineProperty(this, e, { configurable: !0, writable: !0, enumerable: !0, value: n }), n)
        },
        set(t) {
          Object.defineProperty(this, e, { configurable: !0, writable: !0, enumerable: !0, value: t })
        }
      })
    }
  }
}
const F = i(
    `ZodType`,
    (e, t) => (
      D.init(e, t),
      Object.assign(e[`~standard`], { jsonSchema: { input: $r(e, `input`), output: $r(e, `output`) } }),
      (e.toJSONSchema = Qr(e, {})),
      (e.def = t),
      (e.type = t.type),
      Object.defineProperty(e, '_def', { value: t }),
      (e.parse = (t, n) => Ai(e, t, n, { callee: e.parse })),
      (e.safeParse = (t, n) => Mi(e, t, n)),
      (e.parseAsync = async (t, n) => ji(e, t, n, { callee: e.parseAsync })),
      (e.safeParseAsync = async (t, n) => Ni(e, t, n)),
      (e.spa = e.safeParseAsync),
      (e.encode = (t, n) => Pi(e, t, n)),
      (e.decode = (t, n) => Fi(e, t, n)),
      (e.encodeAsync = async (t, n) => Ii(e, t, n)),
      (e.decodeAsync = async (t, n) => Li(e, t, n)),
      (e.safeEncode = (t, n) => Ri(e, t, n)),
      (e.safeDecode = (t, n) => zi(e, t, n)),
      (e.safeEncodeAsync = async (t, n) => Bi(e, t, n)),
      (e.safeDecodeAsync = async (t, n) => Vi(e, t, n)),
      P(e, `ZodType`, {
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
          return b(this, e, t)
        },
        brand() {
          return this
        },
        register(e, t) {
          return (e.add(this, t), this)
        },
        refine(e, t) {
          return this.check(Xa(e, t))
        },
        superRefine(e, t) {
          return this.check(Za(e, t))
        },
        overwrite(e) {
          return this.check(A(e))
        },
        optional() {
          return Ma(this)
        },
        exactOptional() {
          return Pa(this)
        },
        nullable() {
          return Ia(this)
        },
        nullish() {
          return Ma(Ia(this))
        },
        nonoptional(e) {
          return Ha(this, e)
        },
        array() {
          return V(this)
        },
        or(e) {
          return xa([this, e])
        },
        and(e) {
          return wa(this, e)
        },
        transform(e) {
          return Ka(this, Aa(e))
        },
        default(e) {
          return Ra(this, e)
        },
        prefault(e) {
          return Ba(this, e)
        },
        catch(e) {
          return Wa(this, e)
        },
        pipe(e) {
          return Ka(this, e)
        },
        readonly() {
          return Ja(this)
        },
        describe(e) {
          let t = this.clone()
          return (k.add(t, { description: e }), t)
        },
        meta(...e) {
          if (e.length === 0) return k.get(this)
          let t = this.clone()
          return (k.add(t, e[0]), t)
        },
        isOptional() {
          return this.safeParse(void 0).success
        },
        isNullable() {
          return this.safeParse(null).success
        },
        apply(e) {
          return e(this)
        }
      }),
      Object.defineProperty(e, 'description', {
        get() {
          return k.get(e)?.description
        },
        configurable: !0
      }),
      e
    )
  ),
  Ui = i(`_ZodString`, (e, t) => {
    ;(Nt.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => ti(e, t, n, r)))
    let n = e._zod.bag
    ;((e.format = n.format ?? null),
      (e.minLength = n.minimum ?? null),
      (e.maxLength = n.maximum ?? null),
      P(e, `_ZodString`, {
        regex(...e) {
          return this.check(Pr(...e))
        },
        includes(...e) {
          return this.check(Lr(...e))
        },
        startsWith(...e) {
          return this.check(Rr(...e))
        },
        endsWith(...e) {
          return this.check(zr(...e))
        },
        min(...e) {
          return this.check(Mr(...e))
        },
        max(...e) {
          return this.check(jr(...e))
        },
        length(...e) {
          return this.check(Nr(...e))
        },
        nonempty(...e) {
          return this.check(Mr(1, ...e))
        },
        lowercase(e) {
          return this.check(Fr(e))
        },
        uppercase(e) {
          return this.check(Ir(e))
        },
        trim() {
          return this.check(Vr())
        },
        normalize(...e) {
          return this.check(Br(...e))
        },
        toLowerCase() {
          return this.check(Hr())
        },
        toUpperCase() {
          return this.check(Ur())
        },
        slugify() {
          return this.check(Wr())
        }
      }))
  }),
  Wi = i(`ZodString`, (e, t) => {
    ;(Nt.init(e, t),
      Ui.init(e, t),
      (e.email = (t) => e.check(Yn(Gi, t))),
      (e.url = (t) => e.check(tr(Ji, t))),
      (e.jwt = (t) => e.check(gr(la, t))),
      (e.emoji = (t) => e.check(nr(Yi, t))),
      (e.guid = (t) => e.check(Xn(Ki, t))),
      (e.uuid = (t) => e.check(Zn(qi, t))),
      (e.uuidv4 = (t) => e.check(Qn(qi, t))),
      (e.uuidv6 = (t) => e.check($n(qi, t))),
      (e.uuidv7 = (t) => e.check(er(qi, t))),
      (e.nanoid = (t) => e.check(rr(Xi, t))),
      (e.guid = (t) => e.check(Xn(Ki, t))),
      (e.cuid = (t) => e.check(ir(Zi, t))),
      (e.cuid2 = (t) => e.check(ar(Qi, t))),
      (e.ulid = (t) => e.check(or($i, t))),
      (e.base64 = (t) => e.check(pr(oa, t))),
      (e.base64url = (t) => e.check(mr(sa, t))),
      (e.xid = (t) => e.check(sr(ea, t))),
      (e.ksuid = (t) => e.check(cr(ta, t))),
      (e.ipv4 = (t) => e.check(lr(na, t))),
      (e.ipv6 = (t) => e.check(ur(ra, t))),
      (e.cidrv4 = (t) => e.check(dr(ia, t))),
      (e.cidrv6 = (t) => e.check(fr(aa, t))),
      (e.e164 = (t) => e.check(hr(ca, t))),
      (e.datetime = (t) => e.check(Ci(t))),
      (e.date = (t) => e.check(Ti(t))),
      (e.time = (t) => e.check(Di(t))),
      (e.duration = (t) => e.check(ki(t))))
  })
function I(e) {
  return Jn(Wi, e)
}
const L = i(`ZodStringFormat`, (e, t) => {
    ;(O.init(e, t), Ui.init(e, t))
  }),
  Gi = i(`ZodEmail`, (e, t) => {
    ;(It.init(e, t), L.init(e, t))
  }),
  Ki = i(`ZodGUID`, (e, t) => {
    ;(Pt.init(e, t), L.init(e, t))
  }),
  qi = i(`ZodUUID`, (e, t) => {
    ;(Ft.init(e, t), L.init(e, t))
  }),
  Ji = i(`ZodURL`, (e, t) => {
    ;(Lt.init(e, t), L.init(e, t))
  })
function R(e) {
  return tr(Ji, e)
}
const Yi = i(`ZodEmoji`, (e, t) => {
    ;(Rt.init(e, t), L.init(e, t))
  }),
  Xi = i(`ZodNanoID`, (e, t) => {
    ;(zt.init(e, t), L.init(e, t))
  }),
  Zi = i(`ZodCUID`, (e, t) => {
    ;(Bt.init(e, t), L.init(e, t))
  }),
  Qi = i(`ZodCUID2`, (e, t) => {
    ;(Vt.init(e, t), L.init(e, t))
  }),
  $i = i(`ZodULID`, (e, t) => {
    ;(Ht.init(e, t), L.init(e, t))
  }),
  ea = i(`ZodXID`, (e, t) => {
    ;(Ut.init(e, t), L.init(e, t))
  }),
  ta = i(`ZodKSUID`, (e, t) => {
    ;(Wt.init(e, t), L.init(e, t))
  }),
  na = i(`ZodIPv4`, (e, t) => {
    ;(Yt.init(e, t), L.init(e, t))
  }),
  ra = i(`ZodIPv6`, (e, t) => {
    ;(Xt.init(e, t), L.init(e, t))
  }),
  ia = i(`ZodCIDRv4`, (e, t) => {
    ;(Zt.init(e, t), L.init(e, t))
  }),
  aa = i(`ZodCIDRv6`, (e, t) => {
    ;(Qt.init(e, t), L.init(e, t))
  }),
  oa = i(`ZodBase64`, (e, t) => {
    ;(en.init(e, t), L.init(e, t))
  }),
  sa = i(`ZodBase64URL`, (e, t) => {
    ;(nn.init(e, t), L.init(e, t))
  }),
  ca = i(`ZodE164`, (e, t) => {
    ;(rn.init(e, t), L.init(e, t))
  }),
  la = i(`ZodJWT`, (e, t) => {
    ;(on.init(e, t), L.init(e, t))
  }),
  ua = i(`ZodNumber`, (e, t) => {
    ;(sn.init(e, t),
      F.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => ni(e, t, n, r)),
      P(e, `ZodNumber`, {
        gt(e, t) {
          return this.check(Or(e, t))
        },
        gte(e, t) {
          return this.check(kr(e, t))
        },
        min(e, t) {
          return this.check(kr(e, t))
        },
        lt(e, t) {
          return this.check(Er(e, t))
        },
        lte(e, t) {
          return this.check(Dr(e, t))
        },
        max(e, t) {
          return this.check(Dr(e, t))
        },
        int(e) {
          return this.check(fa(e))
        },
        safe(e) {
          return this.check(fa(e))
        },
        positive(e) {
          return this.check(Or(0, e))
        },
        nonnegative(e) {
          return this.check(kr(0, e))
        },
        negative(e) {
          return this.check(Er(0, e))
        },
        nonpositive(e) {
          return this.check(Dr(0, e))
        },
        multipleOf(e, t) {
          return this.check(Ar(e, t))
        },
        step(e, t) {
          return this.check(Ar(e, t))
        },
        finite() {
          return this
        }
      }))
    let n = e._zod.bag
    ;((e.minValue = Math.max(n.minimum ?? -1 / 0, n.exclusiveMinimum ?? -1 / 0) ?? null),
      (e.maxValue = Math.min(n.maximum ?? 1 / 0, n.exclusiveMaximum ?? 1 / 0) ?? null),
      (e.isInt = (n.format ?? ``).includes(`int`) || Number.isSafeInteger(n.multipleOf ?? 0.5)),
      (e.isFinite = !0),
      (e.format = n.format ?? null))
  })
function z(e) {
  return xr(ua, e)
}
const da = i(`ZodNumberFormat`, (e, t) => {
  ;(cn.init(e, t), ua.init(e, t))
})
function fa(e) {
  return Sr(da, e)
}
const pa = i(`ZodBoolean`, (e, t) => {
  ;(ln.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => ri(e, t, n, r)))
})
function B(e) {
  return Cr(pa, e)
}
const ma = i(`ZodUnknown`, (e, t) => {
  ;(un.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (e, t, n) => void 0))
})
function ha() {
  return wr(ma)
}
const ga = i(`ZodNever`, (e, t) => {
  ;(dn.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => ii(e, t, n, r)))
})
function _a(e) {
  return Tr(ga, e)
}
const va = i(`ZodArray`, (e, t) => {
  ;(pn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => li(e, t, n, r)),
    (e.element = t.element),
    P(e, `ZodArray`, {
      min(e, t) {
        return this.check(Mr(e, t))
      },
      nonempty(e) {
        return this.check(Mr(1, e))
      },
      max(e, t) {
        return this.check(jr(e, t))
      },
      length(e, t) {
        return this.check(Nr(e, t))
      },
      unwrap() {
        return this.element
      }
    }))
})
function V(e, t) {
  return Gr(va, e, t)
}
const ya = i(`ZodObject`, (e, t) => {
  ;(vn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ui(e, t, n, r)),
    m(e, `shape`, () => t.shape),
    P(e, `ZodObject`, {
      keyof() {
        return G(Object.keys(this._zod.def.shape))
      },
      catchall(e) {
        return this.clone({ ...this._zod.def, catchall: e })
      },
      passthrough() {
        return this.clone({ ...this._zod.def, catchall: ha() })
      },
      loose() {
        return this.clone({ ...this._zod.def, catchall: ha() })
      },
      strict() {
        return this.clone({ ...this._zod.def, catchall: _a() })
      },
      strip() {
        return this.clone({ ...this._zod.def, catchall: void 0 })
      },
      extend(e) {
        return fe(this, e)
      },
      safeExtend(e) {
        return pe(this, e)
      },
      merge(e) {
        return me(this, e)
      },
      pick(e) {
        return ue(this, e)
      },
      omit(e) {
        return de(this, e)
      },
      partial(...e) {
        return he(ja, this, e[0])
      },
      required(...e) {
        return ge(Va, this, e[0])
      }
    }))
})
function H(e, t) {
  let n = { type: `object`, shape: e ?? {}, ...x(t) }
  return new ya(n)
}
const ba = i(`ZodUnion`, (e, t) => {
  ;(bn.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => di(e, t, n, r)), (e.options = t.options))
})
function xa(e, t) {
  return new ba({ type: `union`, options: e, ...x(t) })
}
const Sa = i(`ZodDiscriminatedUnion`, (e, t) => {
  ;(ba.init(e, t), xn.init(e, t))
})
function U(e, t, n) {
  return new Sa({ type: `union`, options: t, discriminator: e, ...x(n) })
}
const Ca = i(`ZodIntersection`, (e, t) => {
  ;(Sn.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => fi(e, t, n, r)))
})
function wa(e, t) {
  return new Ca({ type: `intersection`, left: e, right: t })
}
const Ta = i(`ZodRecord`, (e, t) => {
  ;(Tn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => pi(e, t, n, r)),
    (e.keyType = t.keyType),
    (e.valueType = t.valueType))
})
function Ea(e, t, n) {
  return !t || !t._zod
    ? new Ta({ type: `record`, keyType: I(), valueType: e, ...x(t) })
    : new Ta({ type: `record`, keyType: e, valueType: t, ...x(n) })
}
function W(e, t, n) {
  let r = b(e)
  return ((r._zod.values = void 0), new Ta({ type: `record`, keyType: r, valueType: t, ...x(n) }))
}
const Da = i(`ZodEnum`, (e, t) => {
  ;(En.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ai(e, t, n, r)),
    (e.enum = t.entries),
    (e.options = Object.values(t.entries)))
  let n = new Set(Object.keys(t.entries))
  ;((e.extract = (e, r) => {
    let i = {}
    for (let r of e)
      if (n.has(r)) i[r] = t.entries[r]
      else throw Error(`Key ${r} not found in enum`)
    return new Da({ ...t, checks: [], ...x(r), entries: i })
  }),
    (e.exclude = (e, r) => {
      let i = { ...t.entries }
      for (let t of e)
        if (n.has(t)) delete i[t]
        else throw Error(`Key ${t} not found in enum`)
      return new Da({ ...t, checks: [], ...x(r), entries: i })
    }))
})
function G(e, t) {
  let n = Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e
  return new Da({ type: `enum`, entries: n, ...x(t) })
}
const Oa = i(`ZodLiteral`, (e, t) => {
  ;(Dn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => oi(e, t, n, r)),
    (e.values = new Set(t.values)),
    Object.defineProperty(e, 'value', {
      get() {
        if (t.values.length > 1)
          throw Error('This schema contains multiple valid literal values. Use `.values` instead.')
        return t.values[0]
      }
    }))
})
function K(e, t) {
  return new Oa({ type: `literal`, values: Array.isArray(e) ? e : [e], ...x(t) })
}
const ka = i(`ZodTransform`, (e, t) => {
  ;(On.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ci(e, t, n, r)),
    (e._zod.parse = (n, r) => {
      if (r.direction === `backward`) throw new o(e.constructor.name)
      n.addIssue = (r) => {
        if (typeof r == `string`) n.issues.push(T(r, n.value, t))
        else {
          let t = r
          ;(t.fatal && (t.continue = !1),
            (t.code ??= `custom`),
            (t.input ??= n.value),
            (t.inst ??= e),
            n.issues.push(T(t)))
        }
      }
      let i = t.transform(n.value, n)
      return i instanceof Promise
        ? i.then((e) => ((n.value = e), (n.fallback = !0), n))
        : ((n.value = i), (n.fallback = !0), n)
    }))
})
function Aa(e) {
  return new ka({ type: `transform`, transform: e })
}
const ja = i(`ZodOptional`, (e, t) => {
  ;(An.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => xi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Ma(e) {
  return new ja({ type: `optional`, innerType: e })
}
const Na = i(`ZodExactOptional`, (e, t) => {
  ;(jn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => xi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Pa(e) {
  return new Na({ type: `optional`, innerType: e })
}
const Fa = i(`ZodNullable`, (e, t) => {
  ;(Mn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => mi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Ia(e) {
  return new Fa({ type: `nullable`, innerType: e })
}
const La = i(`ZodDefault`, (e, t) => {
  ;(Nn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => gi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeDefault = e.unwrap))
})
function Ra(e, t) {
  return new La({
    type: `default`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : oe(t)
    }
  })
}
const za = i(`ZodPrefault`, (e, t) => {
  ;(Fn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => _i(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Ba(e, t) {
  return new za({
    type: `prefault`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : oe(t)
    }
  })
}
const Va = i(`ZodNonOptional`, (e, t) => {
  ;(In.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => hi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Ha(e, t) {
  return new Va({ type: `nonoptional`, innerType: e, ...x(t) })
}
const Ua = i(`ZodCatch`, (e, t) => {
  ;(Rn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => vi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeCatch = e.unwrap))
})
function Wa(e, t) {
  return new Ua({ type: `catch`, innerType: e, catchValue: typeof t == `function` ? t : () => t })
}
const Ga = i(`ZodPipe`, (e, t) => {
  ;(zn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => yi(e, t, n, r)),
    (e.in = t.in),
    (e.out = t.out))
})
function Ka(e, t) {
  return new Ga({ type: `pipe`, in: e, out: t })
}
const qa = i(`ZodReadonly`, (e, t) => {
  ;(Vn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => bi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Ja(e) {
  return new qa({ type: `readonly`, innerType: e })
}
const Ya = i(`ZodCustom`, (e, t) => {
  ;(Un.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => si(e, t, n, r)))
})
function Xa(e, t = {}) {
  return Kr(Ya, e, t)
}
function Za(e, t) {
  return qr(e, t)
}
const Qa = [`models.json`, `providers.json`, `provider-models.json`]
H({
  minAppVersion: I().min(1),
  sourceAppVersion: I().min(1),
  revision: z().int().nonnegative(),
  schemaVersion: z().int(),
  files: Ea(I(), I())
})
const q = {
    ANTHROPIC_MESSAGES: `anthropic-messages`,
    GOOGLE_GENERATE_CONTENT: `google-generate-content`,
    GOOGLE_INTERACTIONS: `google-interactions`,
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
  $a = {
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
  eo = { WEB_SEARCH: `web-search`, URL_CONTEXT: `url-context` },
  to = { ALL_CHAT_MODELS: `all-chat-models`, MODEL_DEPENDENT: `model-dependent` },
  J = {
    ADD_WATERMARK: `addWatermark`,
    ASPECT_RATIO: `aspectRatio`,
    BACKGROUND: `background`,
    BOTTOM_SCALE: `bottomScale`,
    CFG: `cfg`,
    CUSTOM_SIZE: `customSize`,
    DETAIL: `detail`,
    ENABLE_INTERLEAVE: `enableInterleave`,
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
  no = { TEXT: `text`, IMAGE: `image`, AUDIO: `audio`, VIDEO: `video`, VECTOR: `vector` },
  ro = { USD: `USD`, CNY: `CNY` },
  io = {
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
function Y(e) {
  return Object.values(e)
}
const ao = G(Y(q)),
  oo = I().min(1),
  so = I().min(1),
  co = I().min(1),
  lo = H({ min: z(), max: z() }).refine((e) => e.min <= e.max, { message: `min must be less than or equal to max` })
H({ min: I(), max: I() })
const uo = G(Y(ro)).optional(),
  X = H({ perMillionTokens: z().nonnegative().nullable(), currency: uo }),
  fo = Ea(I(), ha()).optional()
function Z(e, { min: t } = {}) {
  let n = V(ha()).transform((t) =>
    t.reduce((t, n) => {
      let r = e.safeParse(n)
      return (r.success && t.push(r.data), t)
    }, [])
  )
  return t === void 0 ? n : n.refine((e) => e.length >= t, { message: `expected at least ${t} recognized value(s)` })
}
const po = G(Y(no)),
  mo = G(Y($a)),
  ho = G(Y(J)),
  go = H({ min: z().nonnegative().optional(), max: z().positive().optional(), default: z().nonnegative().optional() })
    .refine((e) => (e.min == null) == (e.max == null), { message: `min and max must be both present or both absent` })
    .refine((e) => e.min == null || e.max == null || e.min <= e.max, {
      message: `min must be less than or equal to max`
    }),
  _o = G(Y(io)),
  vo = U(`kind`, [
    H({ kind: K(`effort`), values: Z(_o, { min: 1 }), default: _o.optional() }),
    H({ kind: K(`budget`), min: z().nonnegative(), max: z().positive(), default: z().nonnegative().optional() }),
    H({ kind: K(`toggle`), default: B().optional() })
  ]),
  yo = G([`effort`, `budget`, `adaptive-always`, `adaptive-between-tools`])
H({
  pattern: I().refine(
    (e) => {
      try {
        return (new RegExp(e, `i`), !0)
      } catch {
        return !1
      }
    },
    { message: `pattern must be a valid regular expression` }
  ),
  effort: Z(_o, { min: 1 }).optional(),
  toggle: B().optional(),
  budget: H({ min: z().nonnegative(), max: z().positive() })
    .refine((e) => e.min <= e.max, { message: `budget min must be <= max` })
    .optional(),
  template: K(!0).optional(),
  wireDialect: yo.optional()
}).refine(
  (e) =>
    e.template !== !0 || e.effort !== void 0 || e.toggle !== void 0 || e.budget !== void 0 || e.wireDialect !== void 0,
  { message: `a template rule with no knobs declares nothing — drop it or make it a profile` }
)
const bo = H({
    controls: Z(vo).optional(),
    thinkingTokenLimits: go.optional(),
    supportedEfforts: Z(_o).optional(),
    defaultEffort: _o.optional(),
    wireDialect: yo.optional()
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
  xo = G([`generate`, `edit`, `remix`, `upscale`, `merge`]),
  So = H({ type: K(`switch`), default: B().optional() }),
  Co = H({
    type: K(`enum`),
    options: V(I()).min(1),
    default: I().optional(),
    render: G([`select`, `chips`]).optional(),
    columns: z().int().positive().optional()
  }),
  wo = H({ type: K(`range`), min: z(), max: z(), default: z().optional(), step: z().optional() }).refine(
    (e) => e.min <= e.max,
    { message: `min must be ≤ max` }
  ),
  To = H({
    type: K(`range`),
    min: z().int(),
    max: z().int(),
    default: z().int().optional(),
    step: z().int().positive().default(1)
  }).refine((e) => e.min <= e.max, { message: `min must be ≤ max` }),
  Eo = U(`type`, [
    So,
    Co,
    wo,
    H({ type: K(`size`), minSide: z(), maxSide: z(), pairedEnumKey: I().optional() }),
    H({ type: K(`text`), multiline: B().optional() })
  ]),
  Do = [J.NUM_IMAGES, J.MAX_IMAGES, J.NUM_INFERENCE_STEPS, J.SAFETY_TOLERANCE, J.OUTPUT_COMPRESSION],
  Oo = H({
    modes: W(
      xo,
      H({
        supports: W(ho, Eo).transform((e, t) => {
          let n = { ...e }
          for (let r of Do) {
            let i = e[r]
            if (i === void 0) continue
            let a = To.safeParse(i)
            if (a.success) n[r] = a.data
            else for (let e of a.error.issues) t.addIssue({ ...e, path: [r, ...e.path] })
          }
          return n
        }),
        maxInputImages: z().int().positive().optional(),
        vendorTransport: H({
          endpoint: I().regex(/^\/(?!\/)/, `vendor transport endpoint must be a root-relative path, not a URL`),
          isSync: B().optional()
        }).optional(),
        requirePrompt: B().optional()
      })
    )
  }),
  ko = H({
    temperature: H({ supported: B(), range: lo.optional() }).default({ supported: !0 }),
    topP: H({ supported: B(), range: lo.optional() }).default({ supported: !0 }),
    topK: H({ supported: B(), range: lo.optional() }).default({ supported: !1 }),
    frequencyPenalty: B().default(!0),
    presencePenalty: B().default(!0),
    maxTokens: B().default(!0),
    stopSequences: B().default(!0),
    systemMessage: B().default(!0)
  }),
  Ao = H({
    input: X,
    output: X,
    cacheRead: X.optional(),
    cacheWrite: X.optional(),
    inputTokenTiers: V(
      H({
        minInputTokens: z().int().positive().refine(Number.isSafeInteger),
        input: X,
        output: X,
        cacheRead: X.optional(),
        cacheWrite: X.optional()
      })
    ).optional(),
    perImage: H({ price: z(), currency: uo, unit: G([`image`, `pixel`]).optional() }).optional(),
    perMinute: H({ price: z(), currency: uo }).optional()
  })
function jo(e, t) {
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
    r = n[0]?.rate.currency ?? ro.USD
  for (let { rate: e, path: i } of n)
    (e.currency ?? ro.USD) !== r &&
      t.addIssue({ code: `custom`, path: [...i, `currency`], message: `pricing currencies must match` })
}
const Mo = Ao.superRefine(jo),
  No = Ao.partial().superRefine(jo),
  Po = H({
    id: oo,
    name: I(),
    description: I().optional(),
    capabilities: Z(mo)
      .refine((e) => new Set(e).size === e.length, { message: `Capabilities must be unique` })
      .optional(),
    inputModalities: Z(po)
      .refine((e) => new Set(e).size === e.length, { message: `Input modalities must be unique` })
      .optional(),
    outputModalities: Z(po)
      .refine((e) => new Set(e).size === e.length, { message: `Output modalities must be unique` })
      .optional(),
    endpointTypes: Z(ao).optional(),
    contextWindow: z().optional(),
    maxOutputTokens: z().optional(),
    maxInputTokens: z().optional(),
    pricing: Mo.optional(),
    reasoning: bo.optional(),
    parameterSupport: ko.optional(),
    imageGeneration: Oo.optional(),
    family: I().optional(),
    ownedBy: I().optional(),
    openWeights: B().optional(),
    metadata: fo
  }),
  Fo = H({ version: co, models: Z(Po) }),
  Io = {
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
  Lo = G(
    `reasoningEffort,reasoningSummary,reasoning_effort,reasoning.effort,reasoning.enabled,reasoning.exclude,reasoning.max_tokens,thinking.type,thinking.budget_tokens,thinking.budgetTokens,thinking.display,effort,sendReasoning,enable_thinking,thinking_budget,incremental_output,disable_reasoning,reasoning_budget,chat_template_kwargs.enable_thinking,chat_template_kwargs.thinking,chat_template_kwargs.thinking_mode,chat_template_kwargs.thinking_budget,extra_body.google.thinking_config.thinking_budget,extra_body.google.thinking_config.include_thoughts,extra_body.thinking.type,extra_body.thinking_budget,extra_body.reasoning_effort,thinkingConfig.includeThoughts,thinkingConfig.thinkingBudget,thinkingConfig.thinkingLevel,reasoningConfig.type,reasoningConfig.budgetTokens,reasoningConfig.maxReasoningEffort,think`.split(
      `,`
    )
  ),
  Ro = G(Y(io)),
  zo = H({
    target: Lo,
    value: U(`source`, [
      H({ source: K(`literal`), value: xa([I(), z(), B()]) }),
      H({ source: K(`effort`) }),
      H({ source: K(`budget`) }),
      H({ source: K(`assistant-summary`) })
    ])
  }),
  Bo = H({
    target: Lo,
    value: U(`source`, [
      H({ source: K(`literal`), value: xa([I(), z(), B()]) }),
      H({ source: K(`effort`) }),
      H({ source: K(`assistant-summary`) })
    ])
  }),
  Vo = H({
    min: z().nonnegative().optional(),
    autoValue: z().optional(),
    clampToMaxTokens: B().optional(),
    missing: U(`type`, [
      H({ type: K(`omit-value`) }),
      H({ type: K(`omit-mode`) }),
      H({ type: K(`fallback`), value: z() })
    ])
  }),
  Ho = W(Ro, Ro).optional(),
  Uo = xa([
    H({ operations: V(Bo).min(1), effortMap: Ho }),
    H({
      operations: V(zo)
        .min(1)
        .refine((e) => e.some((e) => e.value.source === `budget`), {
          message: `reasoning budget mode must contain a budget operation`
        }),
      effortMap: Ho,
      budget: Vo
    })
  ]),
  Q = H({
    disabled: K(!0).optional(),
    default: Uo.optional(),
    off: Uo.optional(),
    auto: Uo.optional(),
    effort: Uo.optional()
  }).refine((e) => e.disabled === !0 || e.default || e.off || e.auto || e.effort, {
    message: `reasoning wire profile must declare a mode or be disabled`
  })
H({ wire: Q, budgetWire: Q.optional(), alwaysOnWire: Q.optional(), betweenToolsWire: Q.optional() })
const Wo = Y(q),
  Go = G([`global`, `cn`]),
  Ko = G([`openai-priority`, `claude-code`]),
  qo = G([`standard`, `auto`, `fast`, `flex`]),
  Jo = V(qo)
    .min(1)
    .refine((e) => new Set(e).size === e.length, { message: `service tier options must be unique` })
    .refine((e) => e.includes(`standard`), { message: `service tier options must include standard` }),
  Yo = H({
    default: qo,
    options: Jo,
    wire: H({
      delivery: U(`type`, [
        H({ type: K(`provider-option`), key: I().min(1) }),
        H({ type: K(`request-body`), key: I().min(1) })
      ]),
      values: W(qo, I().min(1))
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
  Xo = H({
    id: G(Y(eo)),
    modelScope: G(Y(to)).default(to.MODEL_DEPENDENT),
    endpointTypes: Z(ao).optional(),
    vendors: Z(G(Object.keys(Io))).optional()
  }),
  $ = (e) => H({ type: K(e), wire: Q.optional() }),
  Zo = U(`type`, [$(`openai-chat`), $(`openai-responses`), $(`anthropic`), $(`gemini`), $(`ollama`), $(`none`)])
Zo.options.map((e) => e.shape.type.value)
const Qo = H({
    website: H({ official: R().optional(), docs: R().optional(), apiKey: R().optional(), models: R().optional() })
  }),
  $o = H({ streamOptions: B().optional(), developerRole: B().optional(), reasoningSummary: B().optional() }),
  es = H({
    baseUrl: R().optional(),
    modelsApiUrls: H({
      default: R().optional(),
      embedding: R().optional(),
      image: R().optional(),
      reranker: R().optional()
    }).optional(),
    reasoningFormat: Zo.optional(),
    adapterFamily: I().optional(),
    dialect: $o.optional(),
    requestControls: H({ serviceTier: Yo.optional() }).optional()
  }),
  ts = H({
    version: co,
    providers: Z(
      H({
        id: so,
        presetProviderId: so.optional(),
        name: I(),
        availableInEditions: Z(Go, { min: 1 }).optional(),
        description: I().optional(),
        endpointConfigs: Ea(
          I().refine((e) => Wo.includes(e), {
            message: `Invalid endpoint type key, must be one of: ${Y(q).join(`, `)}`
          }),
          es
        ).optional(),
        defaultChatEndpoint: ao.nullable().default(null),
        modelListSource: G([`api`, `registry`]).default(`api`),
        supplementModelsFromRegistry: B().optional(),
        modelResolution: U(`source`, [
          H({ source: K(`catalog`) }),
          H({
            source: K(`provider`),
            defaults: Po.pick({
              capabilities: !0,
              inputModalities: !0,
              outputModalities: !0,
              endpointTypes: !0,
              imageGeneration: !0
            })
              .required({ capabilities: !0, inputModalities: !0, outputModalities: !0, endpointTypes: !0 })
              .extend({ supportsStreaming: B() })
          })
        ]).optional(),
        authMethods: Z(G([`api-key`, `oauth`, `external-cli`])).optional(),
        authOptional: B().default(!1),
        serverTools: Z(Xo).default([]),
        reportsActualCost: B().default(!1),
        reportedCostCurrency: uo,
        fastMode: H({ transport: Ko, serviceTier: I().optional() }).optional(),
        metadata: fo.and(Qo)
      }).refine((e) => (e.endpointConfigs && e.defaultChatEndpoint ? e.defaultChatEndpoint in e.endpointConfigs : !0), {
        message: `defaultChatEndpoint must exist as a key in endpointConfigs`
      })
    )
  }),
  ns = H({ add: Z(mo).optional(), remove: Z(mo).optional(), force: Z(mo).optional() }),
  rs = G([
    q.OPENAI_RESPONSES,
    q.OPENAI_CHAT_COMPLETIONS,
    q.ANTHROPIC_MESSAGES,
    q.GOOGLE_GENERATE_CONTENT,
    q.OLLAMA_CHAT,
    q.OLLAMA_GENERATE,
    q.OPENAI_TEXT_COMPLETIONS
  ]),
  is = H({ support: bo.optional(), wire: Q.optional() }).refine((e) => e.support || e.wire, {
    message: `provider-model reasoning contract must declare support or wire`
  }),
  as = {
    'models.json': Fo,
    'providers.json': ts,
    'provider-models.json': H({
      version: co,
      overrides: Z(
        H({
          providerId: so,
          modelId: oo,
          apiModelId: I().optional(),
          modelVariants: V(I().min(1)).optional(),
          capabilities: ns.optional(),
          limits: H({
            contextWindow: z().optional(),
            maxOutputTokens: z().optional(),
            maxInputTokens: z().optional()
          }).optional(),
          pricing: No.optional(),
          reasoningContracts: W(rs, is).optional(),
          supportsFastMode: B().optional(),
          requestControls: H({ serviceTier: H({ options: Jo }).optional() }).optional(),
          parameterSupport: ko.partial().optional(),
          endpointTypes: Z(ao).optional(),
          inputModalities: Z(po).optional(),
          outputModalities: Z(po).optional(),
          name: I().optional(),
          description: I().optional(),
          family: I().optional(),
          ownedBy: I().optional(),
          imageGeneration: Oo.optional(),
          disabled: B().optional(),
          replaceWith: oo.optional(),
          reason: I().optional()
        })
      )
    })
  },
  os = 4
function ss(e) {
  return e && typeof e == `object` && `issues` in e
    ? JSON.stringify(e.issues)
    : e instanceof Error
      ? e.message
      : String(e)
}
function cs(e, t) {
  as[e].parse(t)
}
function ls(n) {
  for (let r of Qa)
    try {
      cs(r, JSON.parse(e(t.join(n, r), `utf8`)))
    } catch (e) {
      throw Error(`${r} is not compatible with registry schema v4: ${ss(e)}`)
    }
}
if (process.argv[1] && t.resolve(process.argv[1]) === n(import.meta.url)) {
  let e = process.argv[2]
  if (!e) (console.error(`Usage: node vN-validator.mjs <catalog-data-directory>`), (process.exitCode = 1))
  else
    try {
      ;(ls(t.resolve(e)), console.log(`Catalog is compatible with frozen registry schema v4`))
    } catch (e) {
      ;(console.error(e instanceof Error ? e.message : e), (process.exitCode = 1))
    }
}
export { os as schemaVersion, ls as validateCatalogDirectory, cs as validateCatalogFile }
