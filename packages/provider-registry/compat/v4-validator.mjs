/* eslint-disable */
// AUTO-GENERATED compatibility contract. Never edit or replace this file.
import { readFileSync as e } from 'node:fs'
import t from 'node:path'
import { fileURLToPath as n } from 'node:url'
var r = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), (e = null)), t.exports),
  i
function a(e, t, n) {
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
var o = class extends Error {
    constructor() {
      super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`)
    }
  },
  s = class extends Error {
    constructor(e) {
      ;(super(`Encountered unidirectional transform during encode: ${e}`), (this.name = `ZodEncodeError`))
    }
  }
;(i = globalThis).__zod_globalConfig ?? (i.__zod_globalConfig = {})
const c = globalThis.__zod_globalConfig
function l(e) {
  return (e && Object.assign(c, e), c)
}
function u(e) {
  let t = Object.values(e).filter((e) => typeof e == `number`)
  return Object.entries(e)
    .filter(([e, n]) => t.indexOf(+e) === -1)
    .map(([e, t]) => t)
}
function d(e, t) {
  return typeof t == `bigint` ? t.toString() : t
}
function f(e) {
  return {
    get value() {
      {
        let t = e()
        return (Object.defineProperty(this, 'value', { value: t }), t)
      }
    }
  }
}
function p(e) {
  return e == null
}
function m(e) {
  let t = +!!e.startsWith(`^`),
    n = e.endsWith(`$`) ? e.length - 1 : e.length
  return e.slice(t, n)
}
function h(e, t) {
  let n = e / t,
    r = Math.round(n),
    i = 2 ** -52 * Math.max(Math.abs(n), 1)
  return Math.abs(n - r) < i ? 0 : n - r
}
const g = Symbol(`evaluating`)
function _(e, t, n) {
  let r
  Object.defineProperty(e, t, {
    get() {
      if (r !== g) return (r === void 0 && ((r = g), (r = n())), r)
    },
    set(n) {
      Object.defineProperty(e, t, { value: n })
    },
    configurable: !0
  })
}
function v(e, t, n) {
  Object.defineProperty(e, t, { value: n, writable: !0, enumerable: !0, configurable: !0 })
}
function y(...e) {
  let t = {}
  for (let n of e) {
    let e = Object.getOwnPropertyDescriptors(n)
    Object.assign(t, e)
  }
  return Object.defineProperties({}, t)
}
function ee(e) {
  return JSON.stringify(e)
}
function te(e) {
  return e
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, ``)
    .replace(/[\s_-]+/g, `-`)
    .replace(/^-+|-+$/g, ``)
}
const ne = `captureStackTrace` in Error ? Error.captureStackTrace : (...e) => {}
function re(e) {
  return typeof e == `object` && !!e && !Array.isArray(e)
}
const ie = f(() => {
  if (c.jitless || (typeof navigator < `u` && navigator?.userAgent?.includes(`Cloudflare`))) return !1
  try {
    return (Function(``), !0)
  } catch {
    return !1
  }
})
function b(e) {
  if (re(e) === !1) return !1
  let t = e.constructor
  if (t === void 0 || typeof t != `function`) return !0
  let n = t.prototype
  return re(n) !== !1 && Object.prototype.hasOwnProperty.call(n, `isPrototypeOf`) !== !1
}
function ae(e) {
  return b(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e
}
const oe = new Set([`string`, `number`, `symbol`]),
  se = new Set([`string`, `number`, `bigint`, `boolean`, `symbol`, `undefined`])
function x(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
}
function S(e, t, n) {
  let r = new e._zod.constr(t ?? e._zod.def)
  return ((!t || n?.parent) && (r._zod.parent = e), r)
}
function C(e) {
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
  return S(
    e,
    y(e._zod.def, {
      get shape() {
        let e = {}
        for (let r in t) {
          if (!(r in n.shape)) throw Error(`Unrecognized key: "${r}"`)
          t[r] && (e[r] = n.shape[r])
        }
        return (v(this, `shape`, e), e)
      },
      checks: []
    })
  )
}
function de(e, t) {
  let n = e._zod.def,
    r = n.checks
  if (r && r.length > 0) throw Error(`.omit() cannot be used on object schemas containing refinements`)
  return S(
    e,
    y(e._zod.def, {
      get shape() {
        let r = { ...e._zod.def.shape }
        for (let e in t) {
          if (!(e in n.shape)) throw Error(`Unrecognized key: "${e}"`)
          t[e] && delete r[e]
        }
        return (v(this, `shape`, r), r)
      },
      checks: []
    })
  )
}
function fe(e, t) {
  if (!b(t)) throw Error(`Invalid input to extend: expected a plain object`)
  let n = e._zod.def.checks
  if (n && n.length > 0) {
    let n = e._zod.def.shape
    for (let e in t)
      if (Object.getOwnPropertyDescriptor(n, e) !== void 0)
        throw Error('Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.')
  }
  return S(
    e,
    y(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t }
        return (v(this, `shape`, n), n)
      }
    })
  )
}
function pe(e, t) {
  if (!b(t)) throw Error(`Invalid input to safeExtend: expected a plain object`)
  return S(
    e,
    y(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t }
        return (v(this, `shape`, n), n)
      }
    })
  )
}
function me(e, t) {
  if (e._zod.def.checks?.length)
    throw Error(`.merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.`)
  return S(
    e,
    y(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t._zod.def.shape }
        return (v(this, `shape`, n), n)
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
  return S(
    t,
    y(t._zod.def, {
      get shape() {
        let r = t._zod.def.shape,
          i = { ...r }
        if (n)
          for (let t in n) {
            if (!(t in r)) throw Error(`Unrecognized key: "${t}"`)
            n[t] && (i[t] = e ? new e({ type: `optional`, innerType: r[t] }) : r[t])
          }
        else for (let t in r) i[t] = e ? new e({ type: `optional`, innerType: r[t] }) : r[t]
        return (v(this, `shape`, i), i)
      },
      checks: []
    })
  )
}
function ge(e, t, n) {
  return S(
    t,
    y(t._zod.def, {
      get shape() {
        let r = t._zod.def.shape,
          i = { ...r }
        if (n)
          for (let t in n) {
            if (!(t in i)) throw Error(`Unrecognized key: "${t}"`)
            n[t] && (i[t] = new e({ type: `nonoptional`, innerType: r[t] }))
          }
        else for (let t in r) i[t] = new e({ type: `nonoptional`, innerType: r[t] })
        return (v(this, `shape`, i), i)
      }
    })
  )
}
function _e(e, t = 0) {
  if (e.aborted === !0) return !0
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0
  return !1
}
function ve(e, t = 0) {
  if (e.aborted === !0) return !0
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0
  return !1
}
function ye(e, t) {
  return t.map((t) => {
    var n
    return ((n = t).path ?? (n.path = []), t.path.unshift(e), t)
  })
}
function be(e) {
  return typeof e == `string` ? e : e?.message
}
function w(e, t, n) {
  let r = e.message
      ? e.message
      : (be(e.inst?._zod.def?.error?.(e)) ??
        be(t?.error?.(e)) ??
        be(n.customError?.(e)) ??
        be(n.localeError?.(e)) ??
        `Invalid input`),
    { inst: i, continue: a, input: o, ...s } = e
  return ((s.path ??= []), (s.message = r), t?.reportInput && (s.input = o), s)
}
function xe(e) {
  return Array.isArray(e) ? `array` : typeof e == `string` ? `string` : `unknown`
}
function Se(...e) {
  let [t, n, r] = e
  return typeof t == `string` ? { message: t, code: `custom`, input: n, inst: r } : { ...t }
}
const Ce = (e, t) => {
    ;((e.name = `$ZodError`),
      Object.defineProperty(e, '_zod', { value: e._zod, enumerable: !1 }),
      Object.defineProperty(e, 'issues', { value: t, enumerable: !1 }),
      (e.message = JSON.stringify(t, d, 2)),
      Object.defineProperty(e, 'toString', { value: () => e.message, enumerable: !1 }))
  },
  we = a(`$ZodError`, Ce),
  Te = a(`$ZodError`, Ce, { Parent: Error })
function Ee(e, t = (e) => e.message) {
  let n = {},
    r = []
  for (let i of e.issues)
    i.path.length > 0 ? ((n[i.path[0]] = n[i.path[0]] || []), n[i.path[0]].push(t(i))) : r.push(t(i))
  return { formErrors: r, fieldErrors: n }
}
function De(e, t = (e) => e.message) {
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
const Oe = (e) => (t, n, r, i) => {
    let a = r ? { ...r, async: !1 } : { async: !1 },
      s = t._zod.run({ value: n, issues: [] }, a)
    if (s instanceof Promise) throw new o()
    if (s.issues.length) {
      let t = new (i?.Err ?? e)(s.issues.map((e) => w(e, a, l())))
      throw (ne(t, i?.callee), t)
    }
    return s.value
  },
  ke = (e) => async (t, n, r, i) => {
    let a = r ? { ...r, async: !0 } : { async: !0 },
      o = t._zod.run({ value: n, issues: [] }, a)
    if ((o instanceof Promise && (o = await o), o.issues.length)) {
      let t = new (i?.Err ?? e)(o.issues.map((e) => w(e, a, l())))
      throw (ne(t, i?.callee), t)
    }
    return o.value
  },
  Ae = (e) => (t, n, r) => {
    let i = r ? { ...r, async: !1 } : { async: !1 },
      a = t._zod.run({ value: n, issues: [] }, i)
    if (a instanceof Promise) throw new o()
    return a.issues.length
      ? { success: !1, error: new (e ?? we)(a.issues.map((e) => w(e, i, l()))) }
      : { success: !0, data: a.value }
  },
  je = Ae(Te),
  Me = (e) => async (t, n, r) => {
    let i = r ? { ...r, async: !0 } : { async: !0 },
      a = t._zod.run({ value: n, issues: [] }, i)
    return (
      a instanceof Promise && (a = await a),
      a.issues.length
        ? { success: !1, error: new e(a.issues.map((e) => w(e, i, l()))) }
        : { success: !0, data: a.value }
    )
  },
  Ne = Me(Te),
  Pe = (e) => (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` }
    return Oe(e)(t, n, i)
  },
  Fe = (e) => (t, n, r) => Oe(e)(t, n, r),
  Ie = (e) => async (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` }
    return ke(e)(t, n, i)
  },
  Le = (e) => async (t, n, r) => ke(e)(t, n, r),
  Re = (e) => (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` }
    return Ae(e)(t, n, i)
  },
  ze = (e) => (t, n, r) => Ae(e)(t, n, r),
  Be = (e) => async (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` }
    return Me(e)(t, n, i)
  },
  Ve = (e) => async (t, n, r) => Me(e)(t, n, r),
  He = /^[cC][0-9a-z]{6,}$/,
  Ue = /^[0-9a-z]+$/,
  We = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/,
  Ge = /^[0-9a-vA-V]{20}$/,
  Ke = /^[A-Za-z0-9]{27}$/,
  qe = /^[a-zA-Z0-9_-]{21}$/,
  Je = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/,
  Ye = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  Xe = (e) =>
    e
      ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`)
      : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/,
  Ze = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/
function Qe() {
  return RegExp(`^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`, `u`)
}
const $e =
    /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
  et =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/,
  tt =
    /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/,
  nt =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
  rt = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/,
  it = /^[A-Za-z0-9_-]*$/,
  at = /^https?$/,
  ot = /^\+[1-9]\d{6,14}$/,
  st = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`,
  ct = RegExp(`^${st}$`)
function lt(e) {
  let t = `(?:[01]\\d|2[0-3]):[0-5]\\d`
  return typeof e.precision == `number`
    ? e.precision === -1
      ? `${t}`
      : e.precision === 0
        ? `${t}:[0-5]\\d`
        : `${t}:[0-5]\\d\\.\\d{${e.precision}}`
    : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`
}
function ut(e) {
  return RegExp(`^${lt(e)}$`)
}
function dt(e) {
  let t = lt({ precision: e.precision }),
    n = [`Z`]
  ;(e.local && n.push(``), e.offset && n.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`))
  let r = `${t}(?:${n.join(`|`)})`
  return RegExp(`^${st}T(?:${r})$`)
}
const ft = (e) => {
    let t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ``}}` : `[\\s\\S]*`
    return RegExp(`^${t}$`)
  },
  pt = /^-?\d+$/,
  mt = /^-?\d+(?:\.\d+)?$/,
  ht = /^(?:true|false)$/i,
  gt = /^[^A-Z]*$/,
  _t = /^[^a-z]*$/,
  T = a(`$ZodCheck`, (e, t) => {
    var n
    ;((e._zod ??= {}), (e._zod.def = t), (n = e._zod).onattach ?? (n.onattach = []))
  }),
  vt = { number: `number`, bigint: `bigint`, object: `date` },
  yt = a(`$ZodCheckLessThan`, (e, t) => {
    T.init(e, t)
    let n = vt[typeof t.value]
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
  bt = a(`$ZodCheckGreaterThan`, (e, t) => {
    T.init(e, t)
    let n = vt[typeof t.value]
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
  xt = a(`$ZodCheckMultipleOf`, (e, t) => {
    ;(T.init(e, t),
      e._zod.onattach.push((e) => {
        var n
        ;(n = e._zod.bag).multipleOf ?? (n.multipleOf = t.value)
      }),
      (e._zod.check = (n) => {
        if (typeof n.value != typeof t.value) throw Error(`Cannot mix number and bigint in multiple_of check.`)
        ;(typeof n.value == `bigint` ? n.value % t.value === BigInt(0) : h(n.value, t.value) === 0) ||
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
  St = a(`$ZodCheckNumberFormat`, (e, t) => {
    ;(T.init(e, t), (t.format = t.format || `float64`))
    let n = t.format?.includes(`int`),
      r = n ? `int` : `number`,
      [i, a] = le[t.format]
    ;(e._zod.onattach.push((e) => {
      let r = e._zod.bag
      ;((r.format = t.format), (r.minimum = i), (r.maximum = a), n && (r.pattern = pt))
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
  Ct = a(`$ZodCheckMaxLength`, (e, t) => {
    var n
    ;(T.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !p(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag.maximum ?? 1 / 0
        t.maximum < n && (e._zod.bag.maximum = t.maximum)
      }),
      (e._zod.check = (n) => {
        let r = n.value
        if (r.length <= t.maximum) return
        let i = xe(r)
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
  wt = a(`$ZodCheckMinLength`, (e, t) => {
    var n
    ;(T.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !p(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag.minimum ?? -1 / 0
        t.minimum > n && (e._zod.bag.minimum = t.minimum)
      }),
      (e._zod.check = (n) => {
        let r = n.value
        if (r.length >= t.minimum) return
        let i = xe(r)
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
  Tt = a(`$ZodCheckLengthEquals`, (e, t) => {
    var n
    ;(T.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !p(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag
        ;((n.minimum = t.length), (n.maximum = t.length), (n.length = t.length))
      }),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length
        if (i === t.length) return
        let a = xe(r),
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
  Et = a(`$ZodCheckStringFormat`, (e, t) => {
    var n, r
    ;(T.init(e, t),
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
  Dt = a(`$ZodCheckRegex`, (e, t) => {
    ;(Et.init(e, t),
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
  Ot = a(`$ZodCheckLowerCase`, (e, t) => {
    ;((t.pattern ??= gt), Et.init(e, t))
  }),
  kt = a(`$ZodCheckUpperCase`, (e, t) => {
    ;((t.pattern ??= _t), Et.init(e, t))
  }),
  At = a(`$ZodCheckIncludes`, (e, t) => {
    T.init(e, t)
    let n = x(t.includes),
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
  jt = a(`$ZodCheckStartsWith`, (e, t) => {
    T.init(e, t)
    let n = RegExp(`^${x(t.prefix)}.*`)
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
  Mt = a(`$ZodCheckEndsWith`, (e, t) => {
    T.init(e, t)
    let n = RegExp(`.*${x(t.suffix)}$`)
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
  Nt = a(`$ZodCheckOverwrite`, (e, t) => {
    ;(T.init(e, t),
      (e._zod.check = (e) => {
        e.value = t.tx(e.value)
      }))
  })
var Pt = class {
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
const Ft = { major: 4, minor: 4, patch: 3 },
  E = a(`$ZodType`, (e, t) => {
    var n
    ;((e ??= {}), (e._zod.def = t), (e._zod.bag = e._zod.bag || {}), (e._zod.version = Ft))
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
          let r = _e(e),
            i
          for (let a of t) {
            if (a._zod.def.when) {
              if (ve(e) || !a._zod.def.when(e)) continue
            } else if (r) continue
            let t = e.issues.length,
              s = a._zod.check(e)
            if (s instanceof Promise && n?.async === !1) throw new o()
            if (i || s instanceof Promise)
              i = (i ?? Promise.resolve()).then(async () => {
                ;(await s, e.issues.length !== t && (r ||= _e(e, t)))
              })
            else {
              if (e.issues.length === t) continue
              r ||= _e(e, t)
            }
          }
          return i ? i.then(() => e) : e
        },
        n = (n, i, a) => {
          if (_e(n)) return ((n.aborted = !0), n)
          let s = t(i, r, a)
          if (s instanceof Promise) {
            if (a.async === !1) throw new o()
            return s.then((t) => e._zod.parse(t, a))
          }
          return e._zod.parse(s, a)
        }
      e._zod.run = (i, a) => {
        if (a.skipChecks) return e._zod.parse(i, a)
        if (a.direction === `backward`) {
          let t = e._zod.parse({ value: i.value, issues: [] }, { ...a, skipChecks: !0 })
          return t instanceof Promise ? t.then((e) => n(e, i, a)) : n(t, i, a)
        }
        let s = e._zod.parse(i, a)
        if (s instanceof Promise) {
          if (a.async === !1) throw new o()
          return s.then((e) => t(e, r, a))
        }
        return t(s, r, a)
      }
    }
    _(e, `~standard`, () => ({
      validate: (t) => {
        try {
          let n = je(e, t)
          return n.success ? { value: n.data } : { issues: n.error?.issues }
        } catch {
          return Ne(e, t).then((e) => (e.success ? { value: e.data } : { issues: e.error?.issues }))
        }
      },
      vendor: `zod`,
      version: 1
    }))
  }),
  It = a(`$ZodString`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.pattern = [...(e?._zod.bag?.patterns ?? [])].pop() ?? ft(e._zod.bag)),
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
  D = a(`$ZodStringFormat`, (e, t) => {
    ;(Et.init(e, t), It.init(e, t))
  }),
  Lt = a(`$ZodGUID`, (e, t) => {
    ;((t.pattern ??= Ye), D.init(e, t))
  }),
  Rt = a(`$ZodUUID`, (e, t) => {
    if (t.version) {
      let e = { v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7, v8: 8 }[t.version]
      if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`)
      t.pattern ??= Xe(e)
    } else t.pattern ??= Xe()
    D.init(e, t)
  }),
  zt = a(`$ZodEmail`, (e, t) => {
    ;((t.pattern ??= Ze), D.init(e, t))
  }),
  Bt = a(`$ZodURL`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.check = (n) => {
        try {
          let r = n.value.trim()
          if (!t.normalize && t.protocol?.source === at.source && !/^https?:\/\//i.test(r)) {
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
  Vt = a(`$ZodEmoji`, (e, t) => {
    ;((t.pattern ??= Qe()), D.init(e, t))
  }),
  Ht = a(`$ZodNanoID`, (e, t) => {
    ;((t.pattern ??= qe), D.init(e, t))
  }),
  Ut = a(`$ZodCUID`, (e, t) => {
    ;((t.pattern ??= He), D.init(e, t))
  }),
  Wt = a(`$ZodCUID2`, (e, t) => {
    ;((t.pattern ??= Ue), D.init(e, t))
  }),
  Gt = a(`$ZodULID`, (e, t) => {
    ;((t.pattern ??= We), D.init(e, t))
  }),
  Kt = a(`$ZodXID`, (e, t) => {
    ;((t.pattern ??= Ge), D.init(e, t))
  }),
  qt = a(`$ZodKSUID`, (e, t) => {
    ;((t.pattern ??= Ke), D.init(e, t))
  }),
  Jt = a(`$ZodISODateTime`, (e, t) => {
    ;((t.pattern ??= dt(t)), D.init(e, t))
  }),
  Yt = a(`$ZodISODate`, (e, t) => {
    ;((t.pattern ??= ct), D.init(e, t))
  }),
  Xt = a(`$ZodISOTime`, (e, t) => {
    ;((t.pattern ??= ut(t)), D.init(e, t))
  }),
  Zt = a(`$ZodISODuration`, (e, t) => {
    ;((t.pattern ??= Je), D.init(e, t))
  }),
  Qt = a(`$ZodIPv4`, (e, t) => {
    ;((t.pattern ??= $e), D.init(e, t), (e._zod.bag.format = `ipv4`))
  }),
  $t = a(`$ZodIPv6`, (e, t) => {
    ;((t.pattern ??= et),
      D.init(e, t),
      (e._zod.bag.format = `ipv6`),
      (e._zod.check = (n) => {
        try {
          new URL(`http://[${n.value}]`)
        } catch {
          n.issues.push({ code: `invalid_format`, format: `ipv6`, input: n.value, inst: e, continue: !t.abort })
        }
      }))
  }),
  en = a(`$ZodCIDRv4`, (e, t) => {
    ;((t.pattern ??= tt), D.init(e, t))
  }),
  tn = a(`$ZodCIDRv6`, (e, t) => {
    ;((t.pattern ??= nt),
      D.init(e, t),
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
function nn(e) {
  if (e === ``) return !0
  if (/\s/.test(e) || e.length % 4 != 0) return !1
  try {
    return (atob(e), !0)
  } catch {
    return !1
  }
}
const rn = a(`$ZodBase64`, (e, t) => {
  ;((t.pattern ??= rt),
    D.init(e, t),
    (e._zod.bag.contentEncoding = `base64`),
    (e._zod.check = (n) => {
      nn(n.value) ||
        n.issues.push({ code: `invalid_format`, format: `base64`, input: n.value, inst: e, continue: !t.abort })
    }))
})
function an(e) {
  if (!it.test(e)) return !1
  let t = e.replace(/[-_]/g, (e) => (e === `-` ? `+` : `/`))
  return nn(t.padEnd(Math.ceil(t.length / 4) * 4, `=`))
}
const on = a(`$ZodBase64URL`, (e, t) => {
    ;((t.pattern ??= it),
      D.init(e, t),
      (e._zod.bag.contentEncoding = `base64url`),
      (e._zod.check = (n) => {
        an(n.value) ||
          n.issues.push({ code: `invalid_format`, format: `base64url`, input: n.value, inst: e, continue: !t.abort })
      }))
  }),
  sn = a(`$ZodE164`, (e, t) => {
    ;((t.pattern ??= ot), D.init(e, t))
  })
function cn(e, t = null) {
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
const ln = a(`$ZodJWT`, (e, t) => {
    ;(D.init(e, t),
      (e._zod.check = (n) => {
        cn(n.value, t.alg) ||
          n.issues.push({ code: `invalid_format`, format: `jwt`, input: n.value, inst: e, continue: !t.abort })
      }))
  }),
  un = a(`$ZodNumber`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.pattern = e._zod.bag.pattern ?? mt),
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
  dn = a(`$ZodNumberFormat`, (e, t) => {
    ;(St.init(e, t), un.init(e, t))
  }),
  fn = a(`$ZodBoolean`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.pattern = ht),
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
  pn = a(`$ZodUnknown`, (e, t) => {
    ;(E.init(e, t), (e._zod.parse = (e) => e))
  }),
  mn = a(`$ZodNever`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.parse = (t, n) => (
        t.issues.push({ expected: `never`, code: `invalid_type`, input: t.value, inst: e }),
        t
      )))
  })
function hn(e, t, n) {
  ;(e.issues.length && t.issues.push(...ye(n, e.issues)), (t.value[n] = e.value))
}
const gn = a(`$ZodArray`, (e, t) => {
  ;(E.init(e, t),
    (e._zod.parse = (n, r) => {
      let i = n.value
      if (!Array.isArray(i)) return (n.issues.push({ expected: `array`, code: `invalid_type`, input: i, inst: e }), n)
      n.value = Array(i.length)
      let a = []
      for (let e = 0; e < i.length; e++) {
        let o = i[e],
          s = t.element._zod.run({ value: o, issues: [] }, r)
        s instanceof Promise ? a.push(s.then((t) => hn(t, n, e))) : hn(s, n, e)
      }
      return a.length ? Promise.all(a).then(() => n) : n
    }))
})
function _n(e, t, n, r, i, a) {
  let o = n in r
  if (e.issues.length) {
    if (i && a && !o) return
    t.issues.push(...ye(n, e.issues))
  }
  if (!o && !i) {
    e.issues.length || t.issues.push({ code: `invalid_type`, expected: `nonoptional`, input: void 0, path: [n] })
    return
  }
  e.value === void 0 ? o && (t.value[n] = void 0) : (t.value[n] = e.value)
}
function vn(e) {
  let t = Object.keys(e.shape)
  for (let n of t)
    if (!e.shape?.[n]?._zod?.traits?.has(`$ZodType`))
      throw Error(`Invalid element at key "${n}": expected a Zod schema`)
  let n = ce(e.shape)
  return { ...e, keys: t, keySet: new Set(t), numKeys: t.length, optionalKeys: new Set(n) }
}
function yn(e, t, n, r, i, a) {
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
    a instanceof Promise ? e.push(a.then((e) => _n(e, n, i, t, u, d))) : _n(a, n, i, t, u, d)
  }
  return (
    o.length && n.issues.push({ code: `unrecognized_keys`, keys: o, input: t, inst: a }),
    e.length ? Promise.all(e).then(() => n) : n
  )
}
const bn = a(`$ZodObject`, (e, t) => {
    if ((E.init(e, t), !Object.getOwnPropertyDescriptor(t, `shape`)?.get)) {
      let e = t.shape
      Object.defineProperty(t, 'shape', {
        get: () => {
          let n = { ...e }
          return (Object.defineProperty(t, 'shape', { value: n }), n)
        }
      })
    }
    let n = f(() => vn(t))
    _(e._zod, `propValues`, () => {
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
    let r = re,
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
        a instanceof Promise ? c.push(a.then((n) => _n(n, t, e, s, r, i))) : _n(a, t, e, s, r, i)
      }
      return i ? yn(c, s, t, o, n.value, e) : c.length ? Promise.all(c).then(() => t) : t
    }
  }),
  xn = a(`$ZodObjectJIT`, (e, t) => {
    bn.init(e, t)
    let n = e._zod.parse,
      r = f(() => vn(t)),
      i = (e) => {
        let t = new Pt([`shape`, `payload`, `ctx`]),
          n = r.value,
          i = (e) => {
            let t = ee(e)
            return `shape[${t}]._zod.run({ value: input[${t}], issues: [] }, ctx)`
          }
        t.write(`const input = payload.value;`)
        let a = Object.create(null),
          o = 0
        for (let e of n.keys) a[e] = `key_${o++}`
        t.write(`const newResult = {};`)
        for (let r of n.keys) {
          let n = a[r],
            o = ee(r),
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
      o = re,
      s = !c.jitless,
      l = s && ie.value,
      u = t.catchall,
      d
    e._zod.parse = (c, f) => {
      d ??= r.value
      let p = c.value
      return o(p)
        ? s && l && f?.async === !1 && f.jitless !== !0
          ? ((a ||= i(t.shape)), (c = a(c, f)), u ? yn([], p, c, f, d, e) : c)
          : n(c, f)
        : (c.issues.push({ expected: `object`, code: `invalid_type`, input: p, inst: e }), c)
    }
  })
function Sn(e, t, n, r) {
  for (let n of e) if (n.issues.length === 0) return ((t.value = n.value), t)
  let i = e.filter((e) => !_e(e))
  return i.length === 1
    ? ((t.value = i[0].value), i[0])
    : (t.issues.push({
        code: `invalid_union`,
        input: t.value,
        inst: n,
        errors: e.map((e) => e.issues.map((e) => w(e, r, l())))
      }),
      t)
}
const Cn = a(`$ZodUnion`, (e, t) => {
    ;(E.init(e, t),
      _(e._zod, `optin`, () => (t.options.some((e) => e._zod.optin === `optional`) ? `optional` : void 0)),
      _(e._zod, `optout`, () => (t.options.some((e) => e._zod.optout === `optional`) ? `optional` : void 0)),
      _(e._zod, `values`, () => {
        if (t.options.every((e) => e._zod.values)) return new Set(t.options.flatMap((e) => Array.from(e._zod.values)))
      }),
      _(e._zod, `pattern`, () => {
        if (t.options.every((e) => e._zod.pattern)) {
          let e = t.options.map((e) => e._zod.pattern)
          return RegExp(`^(${e.map((e) => m(e.source)).join(`|`)})$`)
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
      return a ? Promise.all(o).then((t) => Sn(t, r, e, i)) : Sn(o, r, e, i)
    }
  }),
  wn = a(`$ZodDiscriminatedUnion`, (e, t) => {
    ;((t.inclusive = !1), Cn.init(e, t))
    let n = e._zod.parse
    _(e._zod, `propValues`, () => {
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
    let r = f(() => {
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
      if (!re(o)) return (i.issues.push({ code: `invalid_type`, expected: `object`, input: o, inst: e }), i)
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
  Tn = a(`$ZodIntersection`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.parse = (e, n) => {
        let r = e.value,
          i = t.left._zod.run({ value: r, issues: [] }, n),
          a = t.right._zod.run({ value: r, issues: [] }, n)
        return i instanceof Promise || a instanceof Promise
          ? Promise.all([i, a]).then(([t, n]) => Dn(e, t, n))
          : Dn(e, i, a)
      }))
  })
function En(e, t) {
  if (e === t || (e instanceof Date && t instanceof Date && +e == +t)) return { valid: !0, data: e }
  if (b(e) && b(t)) {
    let n = Object.keys(t),
      r = Object.keys(e).filter((e) => n.indexOf(e) !== -1),
      i = { ...e, ...t }
    for (let n of r) {
      let r = En(e[n], t[n])
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
        o = En(i, a)
      if (!o.valid) return { valid: !1, mergeErrorPath: [r, ...o.mergeErrorPath] }
      n.push(o.data)
    }
    return { valid: !0, data: n }
  }
  return { valid: !1, mergeErrorPath: [] }
}
function Dn(e, t, n) {
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
  if ((a.length && i && e.issues.push({ ...i, keys: a }), _e(e))) return e
  let o = En(t.value, n.value)
  if (!o.valid) throw Error(`Unmergable intersection. Error path: ${JSON.stringify(o.mergeErrorPath)}`)
  return ((e.value = o.data), e)
}
const On = a(`$ZodRecord`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.parse = (n, r) => {
        let i = n.value
        if (!b(i)) return (n.issues.push({ expected: `record`, code: `invalid_type`, input: i, inst: e }), n)
        let a = [],
          o = t.keyType._zod.values
        if (o) {
          n.value = {}
          let s = new Set()
          for (let c of o)
            if (typeof c == `string` || typeof c == `number` || typeof c == `symbol`) {
              s.add(typeof c == `number` ? c.toString() : c)
              let o = t.keyType._zod.run({ value: c, issues: [] }, r)
              if (o instanceof Promise) throw Error(`Async schemas not supported in object keys currently`)
              if (o.issues.length) {
                n.issues.push({
                  code: `invalid_key`,
                  origin: `record`,
                  issues: o.issues.map((e) => w(e, r, l())),
                  input: c,
                  path: [c],
                  inst: e
                })
                continue
              }
              let u = o.value,
                d = t.valueType._zod.run({ value: i[c], issues: [] }, r)
              d instanceof Promise
                ? a.push(
                    d.then((e) => {
                      ;(e.issues.length && n.issues.push(...ye(c, e.issues)), (n.value[u] = e.value))
                    })
                  )
                : (d.issues.length && n.issues.push(...ye(c, d.issues)), (n.value[u] = d.value))
            }
          let c
          for (let e in i) s.has(e) || ((c ??= []), c.push(e))
          c && c.length > 0 && n.issues.push({ code: `unrecognized_keys`, input: i, inst: e, keys: c })
        } else {
          n.value = {}
          for (let o of Reflect.ownKeys(i)) {
            if (o === `__proto__` || !Object.prototype.propertyIsEnumerable.call(i, o)) continue
            let s = t.keyType._zod.run({ value: o, issues: [] }, r)
            if (s instanceof Promise) throw Error(`Async schemas not supported in object keys currently`)
            if (typeof o == `string` && mt.test(o) && s.issues.length) {
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
                    issues: s.issues.map((e) => w(e, r, l())),
                    input: o,
                    path: [o],
                    inst: e
                  })
              continue
            }
            let c = t.valueType._zod.run({ value: i[o], issues: [] }, r)
            c instanceof Promise
              ? a.push(
                  c.then((e) => {
                    ;(e.issues.length && n.issues.push(...ye(o, e.issues)), (n.value[s.value] = e.value))
                  })
                )
              : (c.issues.length && n.issues.push(...ye(o, c.issues)), (n.value[s.value] = c.value))
          }
        }
        return a.length ? Promise.all(a).then(() => n) : n
      }))
  }),
  kn = a(`$ZodEnum`, (e, t) => {
    E.init(e, t)
    let n = u(t.entries),
      r = new Set(n)
    ;((e._zod.values = r),
      (e._zod.pattern = RegExp(
        `^(${n
          .filter((e) => oe.has(typeof e))
          .map((e) => (typeof e == `string` ? x(e) : e.toString()))
          .join(`|`)})$`
      )),
      (e._zod.parse = (t, i) => {
        let a = t.value
        return (r.has(a) || t.issues.push({ code: `invalid_value`, values: n, input: a, inst: e }), t)
      }))
  }),
  An = a(`$ZodLiteral`, (e, t) => {
    if ((E.init(e, t), t.values.length === 0)) throw Error(`Cannot create literal schema with no valid values`)
    let n = new Set(t.values)
    ;((e._zod.values = n),
      (e._zod.pattern = RegExp(
        `^(${t.values.map((e) => (typeof e == `string` ? x(e) : e ? x(e.toString()) : String(e))).join(`|`)})$`
      )),
      (e._zod.parse = (r, i) => {
        let a = r.value
        return (n.has(a) || r.issues.push({ code: `invalid_value`, values: t.values, input: a, inst: e }), r)
      }))
  }),
  jn = a(`$ZodTransform`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.optin = `optional`),
      (e._zod.parse = (n, r) => {
        if (r.direction === `backward`) throw new s(e.constructor.name)
        let i = t.transform(n.value, n)
        if (r.async)
          return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => ((n.value = e), (n.fallback = !0), n))
        if (i instanceof Promise) throw new o()
        return ((n.value = i), (n.fallback = !0), n)
      }))
  })
function Mn(e, t) {
  return t === void 0 && (e.issues.length || e.fallback) ? { issues: [], value: void 0 } : e
}
const Nn = a(`$ZodOptional`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.optin = `optional`),
      (e._zod.optout = `optional`),
      _(e._zod, `values`, () => (t.innerType._zod.values ? new Set([...t.innerType._zod.values, void 0]) : void 0)),
      _(e._zod, `pattern`, () => {
        let e = t.innerType._zod.pattern
        return e ? RegExp(`^(${m(e.source)})?$`) : void 0
      }),
      (e._zod.parse = (e, n) => {
        if (t.innerType._zod.optin === `optional`) {
          let r = e.value,
            i = t.innerType._zod.run(e, n)
          return i instanceof Promise ? i.then((e) => Mn(e, r)) : Mn(i, r)
        }
        return e.value === void 0 ? e : t.innerType._zod.run(e, n)
      }))
  }),
  Pn = a(`$ZodExactOptional`, (e, t) => {
    ;(Nn.init(e, t),
      _(e._zod, `values`, () => t.innerType._zod.values),
      _(e._zod, `pattern`, () => t.innerType._zod.pattern),
      (e._zod.parse = (e, n) => t.innerType._zod.run(e, n)))
  }),
  Fn = a(`$ZodNullable`, (e, t) => {
    ;(E.init(e, t),
      _(e._zod, `optin`, () => t.innerType._zod.optin),
      _(e._zod, `optout`, () => t.innerType._zod.optout),
      _(e._zod, `pattern`, () => {
        let e = t.innerType._zod.pattern
        return e ? RegExp(`^(${m(e.source)}|null)$`) : void 0
      }),
      _(e._zod, `values`, () => (t.innerType._zod.values ? new Set([...t.innerType._zod.values, null]) : void 0)),
      (e._zod.parse = (e, n) => (e.value === null ? e : t.innerType._zod.run(e, n))))
  }),
  In = a(`$ZodDefault`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.optin = `optional`),
      _(e._zod, `values`, () => t.innerType._zod.values),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n)
        if (e.value === void 0) return ((e.value = t.defaultValue), e)
        let r = t.innerType._zod.run(e, n)
        return r instanceof Promise ? r.then((e) => Ln(e, t)) : Ln(r, t)
      }))
  })
function Ln(e, t) {
  return (e.value === void 0 && (e.value = t.defaultValue), e)
}
const Rn = a(`$ZodPrefault`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.optin = `optional`),
      _(e._zod, `values`, () => t.innerType._zod.values),
      (e._zod.parse = (e, n) => (
        n.direction === `backward` || (e.value === void 0 && (e.value = t.defaultValue)),
        t.innerType._zod.run(e, n)
      )))
  }),
  zn = a(`$ZodNonOptional`, (e, t) => {
    ;(E.init(e, t),
      _(e._zod, `values`, () => {
        let e = t.innerType._zod.values
        return e ? new Set([...e].filter((e) => e !== void 0)) : void 0
      }),
      (e._zod.parse = (n, r) => {
        let i = t.innerType._zod.run(n, r)
        return i instanceof Promise ? i.then((t) => Bn(t, e)) : Bn(i, e)
      }))
  })
function Bn(e, t) {
  return (
    !e.issues.length &&
      e.value === void 0 &&
      e.issues.push({ code: `invalid_type`, expected: `nonoptional`, input: e.value, inst: t }),
    e
  )
}
const Vn = a(`$ZodCatch`, (e, t) => {
    ;(E.init(e, t),
      (e._zod.optin = `optional`),
      _(e._zod, `optout`, () => t.innerType._zod.optout),
      _(e._zod, `values`, () => t.innerType._zod.values),
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
                    error: { issues: r.issues.map((e) => w(e, n, l())) },
                    input: e.value
                  })),
                  (e.issues = []),
                  (e.fallback = !0)),
                e
              )
            )
          : ((e.value = r.value),
            r.issues.length &&
              ((e.value = t.catchValue({ ...e, error: { issues: r.issues.map((e) => w(e, n, l())) }, input: e.value })),
              (e.issues = []),
              (e.fallback = !0)),
            e)
      }))
  }),
  Hn = a(`$ZodPipe`, (e, t) => {
    ;(E.init(e, t),
      _(e._zod, `values`, () => t.in._zod.values),
      _(e._zod, `optin`, () => t.in._zod.optin),
      _(e._zod, `optout`, () => t.out._zod.optout),
      _(e._zod, `propValues`, () => t.in._zod.propValues),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) {
          let r = t.out._zod.run(e, n)
          return r instanceof Promise ? r.then((e) => Un(e, t.in, n)) : Un(r, t.in, n)
        }
        let r = t.in._zod.run(e, n)
        return r instanceof Promise ? r.then((e) => Un(e, t.out, n)) : Un(r, t.out, n)
      }))
  })
function Un(e, t, n) {
  return e.issues.length
    ? ((e.aborted = !0), e)
    : t._zod.run({ value: e.value, issues: e.issues, fallback: e.fallback }, n)
}
const Wn = a(`$ZodPreprocess`, (e, t) => {
    Hn.init(e, t)
  }),
  Gn = a(`$ZodReadonly`, (e, t) => {
    ;(E.init(e, t),
      _(e._zod, `propValues`, () => t.innerType._zod.propValues),
      _(e._zod, `values`, () => t.innerType._zod.values),
      _(e._zod, `optin`, () => t.innerType?._zod?.optin),
      _(e._zod, `optout`, () => t.innerType?._zod?.optout),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n)
        let r = t.innerType._zod.run(e, n)
        return r instanceof Promise ? r.then(Kn) : Kn(r)
      }))
  })
function Kn(e) {
  return ((e.value = Object.freeze(e.value)), e)
}
const qn = a(`$ZodTemplateLiteral`, (e, t) => {
    E.init(e, t)
    let n = []
    for (let e of t.parts)
      if (typeof e == `object` && e) {
        if (!e._zod.pattern)
          throw Error(`Invalid template literal part, no pattern found: ${[...e._zod.traits].shift()}`)
        let t = e._zod.pattern instanceof RegExp ? e._zod.pattern.source : e._zod.pattern
        if (!t) throw Error(`Invalid template literal part: ${e._zod.traits}`)
        let r = +!!t.startsWith(`^`),
          i = t.endsWith(`$`) ? t.length - 1 : t.length
        n.push(t.slice(r, i))
      } else if (e === null || se.has(typeof e)) n.push(x(`${e}`))
      else throw Error(`Invalid template literal part: ${e}`)
    ;((e._zod.pattern = RegExp(`^${n.join(``)}$`)),
      (e._zod.parse = (n, r) =>
        typeof n.value == `string`
          ? ((e._zod.pattern.lastIndex = 0),
            e._zod.pattern.test(n.value) ||
              n.issues.push({
                input: n.value,
                inst: e,
                code: `invalid_format`,
                format: t.format ?? `template_literal`,
                pattern: e._zod.pattern.source
              }),
            n)
          : (n.issues.push({ input: n.value, inst: e, expected: `string`, code: `invalid_type` }), n)))
  }),
  Jn = a(`$ZodCustom`, (e, t) => {
    ;(T.init(e, t),
      E.init(e, t),
      (e._zod.parse = (e, t) => e),
      (e._zod.check = (n) => {
        let r = n.value,
          i = t.fn(r)
        if (i instanceof Promise) return i.then((t) => Yn(t, n, r, e))
        Yn(i, n, r, e)
      }))
  })
function Yn(e, t, n, r) {
  if (!e) {
    let e = { code: `custom`, input: n, inst: r, path: [...(r._zod.def.path ?? [])], continue: !r._zod.def.abort }
    ;(r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(Se(e)))
  }
}
var Xn,
  Zn = class {
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
function Qn() {
  return new Zn()
}
;(Xn = globalThis).__zod_globalRegistry ?? (Xn.__zod_globalRegistry = Qn())
const $n = globalThis.__zod_globalRegistry
function er(e, t) {
  return new e({ type: `string`, ...C(t) })
}
function tr(e, t) {
  return new e({ type: `string`, format: `email`, check: `string_format`, abort: !1, ...C(t) })
}
function nr(e, t) {
  return new e({ type: `string`, format: `guid`, check: `string_format`, abort: !1, ...C(t) })
}
function rr(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, ...C(t) })
}
function ir(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v4`, ...C(t) })
}
function ar(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v6`, ...C(t) })
}
function or(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v7`, ...C(t) })
}
function sr(e, t) {
  return new e({ type: `string`, format: `url`, check: `string_format`, abort: !1, ...C(t) })
}
function cr(e, t) {
  return new e({ type: `string`, format: `emoji`, check: `string_format`, abort: !1, ...C(t) })
}
function lr(e, t) {
  return new e({ type: `string`, format: `nanoid`, check: `string_format`, abort: !1, ...C(t) })
}
function ur(e, t) {
  return new e({ type: `string`, format: `cuid`, check: `string_format`, abort: !1, ...C(t) })
}
function dr(e, t) {
  return new e({ type: `string`, format: `cuid2`, check: `string_format`, abort: !1, ...C(t) })
}
function fr(e, t) {
  return new e({ type: `string`, format: `ulid`, check: `string_format`, abort: !1, ...C(t) })
}
function pr(e, t) {
  return new e({ type: `string`, format: `xid`, check: `string_format`, abort: !1, ...C(t) })
}
function mr(e, t) {
  return new e({ type: `string`, format: `ksuid`, check: `string_format`, abort: !1, ...C(t) })
}
function hr(e, t) {
  return new e({ type: `string`, format: `ipv4`, check: `string_format`, abort: !1, ...C(t) })
}
function gr(e, t) {
  return new e({ type: `string`, format: `ipv6`, check: `string_format`, abort: !1, ...C(t) })
}
function _r(e, t) {
  return new e({ type: `string`, format: `cidrv4`, check: `string_format`, abort: !1, ...C(t) })
}
function vr(e, t) {
  return new e({ type: `string`, format: `cidrv6`, check: `string_format`, abort: !1, ...C(t) })
}
function yr(e, t) {
  return new e({ type: `string`, format: `base64`, check: `string_format`, abort: !1, ...C(t) })
}
function br(e, t) {
  return new e({ type: `string`, format: `base64url`, check: `string_format`, abort: !1, ...C(t) })
}
function xr(e, t) {
  return new e({ type: `string`, format: `e164`, check: `string_format`, abort: !1, ...C(t) })
}
function Sr(e, t) {
  return new e({ type: `string`, format: `jwt`, check: `string_format`, abort: !1, ...C(t) })
}
function Cr(e, t) {
  return new e({
    type: `string`,
    format: `datetime`,
    check: `string_format`,
    offset: !1,
    local: !1,
    precision: null,
    ...C(t)
  })
}
function wr(e, t) {
  return new e({ type: `string`, format: `date`, check: `string_format`, ...C(t) })
}
function Tr(e, t) {
  return new e({ type: `string`, format: `time`, check: `string_format`, precision: null, ...C(t) })
}
function Er(e, t) {
  return new e({ type: `string`, format: `duration`, check: `string_format`, ...C(t) })
}
function Dr(e, t) {
  return new e({ type: `number`, checks: [], ...C(t) })
}
function Or(e, t) {
  return new e({ type: `number`, check: `number_format`, abort: !1, format: `safeint`, ...C(t) })
}
function kr(e, t) {
  return new e({ type: `boolean`, ...C(t) })
}
function Ar(e) {
  return new e({ type: `unknown` })
}
function jr(e, t) {
  return new e({ type: `never`, ...C(t) })
}
function Mr(e, t) {
  return new yt({ check: `less_than`, ...C(t), value: e, inclusive: !1 })
}
function Nr(e, t) {
  return new yt({ check: `less_than`, ...C(t), value: e, inclusive: !0 })
}
function Pr(e, t) {
  return new bt({ check: `greater_than`, ...C(t), value: e, inclusive: !1 })
}
function Fr(e, t) {
  return new bt({ check: `greater_than`, ...C(t), value: e, inclusive: !0 })
}
function Ir(e, t) {
  return new xt({ check: `multiple_of`, ...C(t), value: e })
}
function Lr(e, t) {
  return new Ct({ check: `max_length`, ...C(t), maximum: e })
}
function Rr(e, t) {
  return new wt({ check: `min_length`, ...C(t), minimum: e })
}
function zr(e, t) {
  return new Tt({ check: `length_equals`, ...C(t), length: e })
}
function Br(e, t) {
  return new Dt({ check: `string_format`, format: `regex`, ...C(t), pattern: e })
}
function Vr(e) {
  return new Ot({ check: `string_format`, format: `lowercase`, ...C(e) })
}
function Hr(e) {
  return new kt({ check: `string_format`, format: `uppercase`, ...C(e) })
}
function Ur(e, t) {
  return new At({ check: `string_format`, format: `includes`, ...C(t), includes: e })
}
function Wr(e, t) {
  return new jt({ check: `string_format`, format: `starts_with`, ...C(t), prefix: e })
}
function Gr(e, t) {
  return new Mt({ check: `string_format`, format: `ends_with`, ...C(t), suffix: e })
}
function Kr(e) {
  return new Nt({ check: `overwrite`, tx: e })
}
function qr(e) {
  return Kr((t) => t.normalize(e))
}
function Jr() {
  return Kr((e) => e.trim())
}
function Yr() {
  return Kr((e) => e.toLowerCase())
}
function Xr() {
  return Kr((e) => e.toUpperCase())
}
function Zr() {
  return Kr((e) => te(e))
}
function Qr(e, t, n) {
  return new e({ type: `array`, element: t, ...C(n) })
}
function $r(e, t, n) {
  return new e({ type: `custom`, check: `custom`, fn: t, ...C(n) })
}
function ei(e, t) {
  let n = ti(
    (t) => (
      (t.addIssue = (e) => {
        if (typeof e == `string`) t.issues.push(Se(e, t.value, n._zod.def))
        else {
          let r = e
          ;(r.fatal && (r.continue = !1),
            (r.code ??= `custom`),
            (r.input ??= t.value),
            (r.inst ??= n),
            (r.continue ??= !n._zod.def.abort),
            t.issues.push(Se(r)))
        }
      }),
      e(t.value, t)
    ),
    t
  )
  return n
}
function ti(e, t) {
  let n = new T({ check: `custom`, ...C(t) })
  return ((n._zod.check = e), n)
}
function ni(e) {
  let t = e?.target ?? `draft-2020-12`
  return (
    t === `draft-4` && (t = `draft-04`),
    t === `draft-7` && (t = `draft-07`),
    {
      processors: e.processors ?? {},
      metadataRegistry: e?.metadata ?? $n,
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
function O(e, t, n = { path: [], schemaPath: [] }) {
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
    a && ((o.ref ||= a), O(a, t, r), (t.seen.get(a).isParent = !0))
  }
  let c = t.metadataRegistry.get(e)
  return (
    c && Object.assign(o.schema, c),
    t.io === `input` && k(e) && (delete o.schema.examples, delete o.schema.default),
    t.io === `input` && `_prefault` in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)),
    delete o.schema._prefault,
    t.seen.get(e).schema
  )
}
function ri(e, t) {
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
function ii(e, t) {
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
          jsonSchema: { input: oi(t, `input`, e.processors), output: oi(t, `output`, e.processors) }
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
function k(e, t) {
  let n = t ?? { seen: new Set() }
  if (n.seen.has(e)) return !1
  n.seen.add(e)
  let r = e._zod.def
  if (r.type === `transform`) return !0
  if (r.type === `array`) return k(r.element, n)
  if (r.type === `set`) return k(r.valueType, n)
  if (r.type === `lazy`) return k(r.getter(), n)
  if (
    r.type === `promise` ||
    r.type === `optional` ||
    r.type === `nonoptional` ||
    r.type === `nullable` ||
    r.type === `readonly` ||
    r.type === 'default' ||
    r.type === `prefault`
  )
    return k(r.innerType, n)
  if (r.type === `intersection`) return k(r.left, n) || k(r.right, n)
  if (r.type === `record` || r.type === `map`) return k(r.keyType, n) || k(r.valueType, n)
  if (r.type === `pipe`) return e._zod.traits.has(`$ZodCodec`) ? !0 : k(r.in, n) || k(r.out, n)
  if (r.type === `object`) {
    for (let e in r.shape) if (k(r.shape[e], n)) return !0
    return !1
  }
  if (r.type === `union`) {
    for (let e of r.options) if (k(e, n)) return !0
    return !1
  }
  if (r.type === `tuple`) {
    for (let e of r.items) if (k(e, n)) return !0
    return !!(r.rest && k(r.rest, n))
  }
  return !1
}
const ai =
    (e, t = {}) =>
    (n) => {
      let r = ni({ ...n, processors: t })
      return (O(e, r), ri(r, e), ii(r, e))
    },
  oi =
    (e, t, n = {}) =>
    (r) => {
      let { libraryOptions: i, target: a } = r ?? {},
        o = ni({ ...(i ?? {}), target: a, io: t, processors: n })
      return (O(e, o), ri(o, e), ii(o, e))
    },
  si = { guid: `uuid`, url: `uri`, datetime: `date-time`, json_string: `json-string`, regex: `` },
  ci = (e, t, n, r) => {
    let i = n
    i.type = `string`
    let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l } = e._zod.bag
    if (
      (typeof a == `number` && (i.minLength = a),
      typeof o == `number` && (i.maxLength = o),
      s && ((i.format = si[s] ?? s), i.format === `` && delete i.format, s === `time` && delete i.format),
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
  li = (e, t, n, r) => {
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
  ui = (e, t, n, r) => {
    n.type = `boolean`
  },
  di = (e, t, n, r) => {
    n.not = {}
  },
  fi = (e, t, n, r) => {
    let i = e._zod.def,
      a = u(i.entries)
    ;(a.every((e) => typeof e == `number`) && (n.type = `number`),
      a.every((e) => typeof e == `string`) && (n.type = `string`),
      (n.enum = a))
  },
  pi = (e, t, n, r) => {
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
  mi = (e, t, n, r) => {
    let i = n,
      a = e._zod.pattern
    if (!a) throw Error(`Pattern not found in template literal`)
    ;((i.type = `string`), (i.pattern = a.source))
  },
  hi = (e, t, n, r) => {
    if (t.unrepresentable === `throw`) throw Error(`Custom types cannot be represented in JSON Schema`)
  },
  gi = (e, t, n, r) => {
    if (t.unrepresentable === `throw`) throw Error(`Transforms cannot be represented in JSON Schema`)
  },
  _i = (e, t, n, r) => {
    let i = n,
      a = e._zod.def,
      { minimum: o, maximum: s } = e._zod.bag
    ;(typeof o == `number` && (i.minItems = o),
      typeof s == `number` && (i.maxItems = s),
      (i.type = `array`),
      (i.items = O(a.element, t, { ...r, path: [...r.path, `items`] })))
  },
  vi = (e, t, n, r) => {
    let i = n,
      a = e._zod.def
    ;((i.type = `object`), (i.properties = {}))
    let o = a.shape
    for (let e in o) i.properties[e] = O(o[e], t, { ...r, path: [...r.path, `properties`, e] })
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
            (i.additionalProperties = O(a.catchall, t, { ...r, path: [...r.path, `additionalProperties`] }))
          : t.io === `output` && (i.additionalProperties = !1))
  },
  yi = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.inclusive === !1,
      o = i.options.map((e, n) => O(e, t, { ...r, path: [...r.path, a ? `oneOf` : `anyOf`, n] }))
    a ? (n.oneOf = o) : (n.anyOf = o)
  },
  bi = (e, t, n, r) => {
    let i = e._zod.def,
      a = O(i.left, t, { ...r, path: [...r.path, `allOf`, 0] }),
      o = O(i.right, t, { ...r, path: [...r.path, `allOf`, 1] }),
      s = (e) => `allOf` in e && Object.keys(e).length === 1
    n.allOf = [...(s(a) ? a.allOf : [a]), ...(s(o) ? o.allOf : [o])]
  },
  xi = (e, t, n, r) => {
    let i = n,
      a = e._zod.def
    i.type = `object`
    let o = a.keyType,
      s = o._zod.bag?.patterns
    if (a.mode === `loose` && s && s.size > 0) {
      let e = O(a.valueType, t, { ...r, path: [...r.path, `patternProperties`, `*`] })
      i.patternProperties = {}
      for (let t of s) i.patternProperties[t.source] = e
    } else
      ((t.target === `draft-07` || t.target === `draft-2020-12`) &&
        (i.propertyNames = O(a.keyType, t, { ...r, path: [...r.path, `propertyNames`] })),
        (i.additionalProperties = O(a.valueType, t, { ...r, path: [...r.path, `additionalProperties`] })))
    let c = o._zod.values
    if (c) {
      let e = [...c].filter((e) => typeof e == `string` || typeof e == `number`)
      e.length > 0 && (i.required = e)
    }
  },
  Si = (e, t, n, r) => {
    let i = e._zod.def,
      a = O(i.innerType, t, r),
      o = t.seen.get(e)
    t.target === `openapi-3.0` ? ((o.ref = i.innerType), (n.nullable = !0)) : (n.anyOf = [a, { type: `null` }])
  },
  Ci = (e, t, n, r) => {
    let i = e._zod.def
    O(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
  },
  wi = (e, t, n, r) => {
    let i = e._zod.def
    O(i.innerType, t, r)
    let a = t.seen.get(e)
    ;((a.ref = i.innerType), (n.default = JSON.parse(JSON.stringify(i.defaultValue))))
  },
  Ti = (e, t, n, r) => {
    let i = e._zod.def
    O(i.innerType, t, r)
    let a = t.seen.get(e)
    ;((a.ref = i.innerType), t.io === `input` && (n._prefault = JSON.parse(JSON.stringify(i.defaultValue))))
  },
  Ei = (e, t, n, r) => {
    let i = e._zod.def
    O(i.innerType, t, r)
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
  Di = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.in._zod.traits.has(`$ZodTransform`),
      o = t.io === `input` ? (a ? i.out : i.in) : i.out
    O(o, t, r)
    let s = t.seen.get(e)
    s.ref = o
  },
  Oi = (e, t, n, r) => {
    let i = e._zod.def
    O(i.innerType, t, r)
    let a = t.seen.get(e)
    ;((a.ref = i.innerType), (n.readOnly = !0))
  },
  ki = (e, t, n, r) => {
    let i = e._zod.def
    O(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
  },
  Ai = a(`ZodISODateTime`, (e, t) => {
    ;(Jt.init(e, t), N.init(e, t))
  })
function ji(e) {
  return Cr(Ai, e)
}
const Mi = a(`ZodISODate`, (e, t) => {
  ;(Yt.init(e, t), N.init(e, t))
})
function Ni(e) {
  return wr(Mi, e)
}
const Pi = a(`ZodISOTime`, (e, t) => {
  ;(Xt.init(e, t), N.init(e, t))
})
function Fi(e) {
  return Tr(Pi, e)
}
const Ii = a(`ZodISODuration`, (e, t) => {
  ;(Zt.init(e, t), N.init(e, t))
})
function Li(e) {
  return Er(Ii, e)
}
const Ri = (e, t) => {
    ;(we.init(e, t),
      (e.name = `ZodError`),
      Object.defineProperties(e, {
        format: { value: (t) => De(e, t) },
        flatten: { value: (t) => Ee(e, t) },
        addIssue: {
          value: (t) => {
            ;(e.issues.push(t), (e.message = JSON.stringify(e.issues, d, 2)))
          }
        },
        addIssues: {
          value: (t) => {
            ;(e.issues.push(...t), (e.message = JSON.stringify(e.issues, d, 2)))
          }
        },
        isEmpty: {
          get() {
            return e.issues.length === 0
          }
        }
      }))
  },
  zi = a(`ZodError`, Ri),
  A = a(`ZodError`, Ri, { Parent: Error }),
  Bi = Oe(A),
  Vi = ke(A),
  Hi = Ae(A),
  Ui = Me(A),
  Wi = Pe(A),
  Gi = Fe(A),
  Ki = Ie(A),
  qi = Le(A),
  Ji = Re(A),
  Yi = ze(A),
  Xi = Be(A),
  Zi = Ve(A),
  Qi = new WeakMap()
function $i(e, t, n) {
  let r = Object.getPrototypeOf(e),
    i = Qi.get(r)
  if ((i || ((i = new Set()), Qi.set(r, i)), !i.has(t))) {
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
const j = a(
    `ZodType`,
    (e, t) => (
      E.init(e, t),
      Object.assign(e[`~standard`], { jsonSchema: { input: oi(e, `input`), output: oi(e, `output`) } }),
      (e.toJSONSchema = ai(e, {})),
      (e.def = t),
      (e.type = t.type),
      Object.defineProperty(e, '_def', { value: t }),
      (e.parse = (t, n) => Bi(e, t, n, { callee: e.parse })),
      (e.safeParse = (t, n) => Hi(e, t, n)),
      (e.parseAsync = async (t, n) => Vi(e, t, n, { callee: e.parseAsync })),
      (e.safeParseAsync = async (t, n) => Ui(e, t, n)),
      (e.spa = e.safeParseAsync),
      (e.encode = (t, n) => Wi(e, t, n)),
      (e.decode = (t, n) => Gi(e, t, n)),
      (e.encodeAsync = async (t, n) => Ki(e, t, n)),
      (e.decodeAsync = async (t, n) => qi(e, t, n)),
      (e.safeEncode = (t, n) => Ji(e, t, n)),
      (e.safeDecode = (t, n) => Yi(e, t, n)),
      (e.safeEncodeAsync = async (t, n) => Xi(e, t, n)),
      (e.safeDecodeAsync = async (t, n) => Zi(e, t, n)),
      $i(e, `ZodType`, {
        check(...e) {
          let t = this.def
          return this.clone(
            y(t, {
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
          return S(this, e, t)
        },
        brand() {
          return this
        },
        register(e, t) {
          return (e.add(this, t), this)
        },
        refine(e, t) {
          return this.check(uo(e, t))
        },
        superRefine(e, t) {
          return this.check(fo(e, t))
        },
        overwrite(e) {
          return this.check(Kr(e))
        },
        optional() {
          return Ua(this)
        },
        exactOptional() {
          return Ga(this)
        },
        nullable() {
          return qa(this)
        },
        nullish() {
          return Ua(qa(this))
        },
        nonoptional(e) {
          return $a(this, e)
        },
        array() {
          return L(this)
        },
        or(e) {
          return Ma([this, e])
        },
        and(e) {
          return Fa(this, e)
        },
        transform(e) {
          return ro(this, Va(e))
        },
        default(e) {
          return Ya(this, e)
        },
        prefault(e) {
          return Za(this, e)
        },
        catch(e) {
          return to(this, e)
        },
        pipe(e) {
          return ro(this, e)
        },
        readonly() {
          return oo(this)
        },
        describe(e) {
          let t = this.clone()
          return ($n.add(t, { description: e }), t)
        },
        meta(...e) {
          if (e.length === 0) return $n.get(this)
          let t = this.clone()
          return ($n.add(t, e[0]), t)
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
          return $n.get(e)?.description
        },
        configurable: !0
      }),
      e
    )
  ),
  ea = a(`_ZodString`, (e, t) => {
    ;(It.init(e, t), j.init(e, t), (e._zod.processJSONSchema = (t, n, r) => ci(e, t, n, r)))
    let n = e._zod.bag
    ;((e.format = n.format ?? null),
      (e.minLength = n.minimum ?? null),
      (e.maxLength = n.maximum ?? null),
      $i(e, `_ZodString`, {
        regex(...e) {
          return this.check(Br(...e))
        },
        includes(...e) {
          return this.check(Ur(...e))
        },
        startsWith(...e) {
          return this.check(Wr(...e))
        },
        endsWith(...e) {
          return this.check(Gr(...e))
        },
        min(...e) {
          return this.check(Rr(...e))
        },
        max(...e) {
          return this.check(Lr(...e))
        },
        length(...e) {
          return this.check(zr(...e))
        },
        nonempty(...e) {
          return this.check(Rr(1, ...e))
        },
        lowercase(e) {
          return this.check(Vr(e))
        },
        uppercase(e) {
          return this.check(Hr(e))
        },
        trim() {
          return this.check(Jr())
        },
        normalize(...e) {
          return this.check(qr(...e))
        },
        toLowerCase() {
          return this.check(Yr())
        },
        toUpperCase() {
          return this.check(Xr())
        },
        slugify() {
          return this.check(Zr())
        }
      }))
  }),
  ta = a(`ZodString`, (e, t) => {
    ;(It.init(e, t),
      ea.init(e, t),
      (e.email = (t) => e.check(tr(na, t))),
      (e.url = (t) => e.check(sr(aa, t))),
      (e.jwt = (t) => e.check(Sr(ba, t))),
      (e.emoji = (t) => e.check(cr(oa, t))),
      (e.guid = (t) => e.check(nr(ra, t))),
      (e.uuid = (t) => e.check(rr(ia, t))),
      (e.uuidv4 = (t) => e.check(ir(ia, t))),
      (e.uuidv6 = (t) => e.check(ar(ia, t))),
      (e.uuidv7 = (t) => e.check(or(ia, t))),
      (e.nanoid = (t) => e.check(lr(sa, t))),
      (e.guid = (t) => e.check(nr(ra, t))),
      (e.cuid = (t) => e.check(ur(ca, t))),
      (e.cuid2 = (t) => e.check(dr(la, t))),
      (e.ulid = (t) => e.check(fr(ua, t))),
      (e.base64 = (t) => e.check(yr(_a, t))),
      (e.base64url = (t) => e.check(br(va, t))),
      (e.xid = (t) => e.check(pr(da, t))),
      (e.ksuid = (t) => e.check(mr(fa, t))),
      (e.ipv4 = (t) => e.check(hr(pa, t))),
      (e.ipv6 = (t) => e.check(gr(ma, t))),
      (e.cidrv4 = (t) => e.check(_r(ha, t))),
      (e.cidrv6 = (t) => e.check(vr(ga, t))),
      (e.e164 = (t) => e.check(xr(ya, t))),
      (e.datetime = (t) => e.check(ji(t))),
      (e.date = (t) => e.check(Ni(t))),
      (e.time = (t) => e.check(Fi(t))),
      (e.duration = (t) => e.check(Li(t))))
  })
function M(e) {
  return er(ta, e)
}
const N = a(`ZodStringFormat`, (e, t) => {
    ;(D.init(e, t), ea.init(e, t))
  }),
  na = a(`ZodEmail`, (e, t) => {
    ;(zt.init(e, t), N.init(e, t))
  }),
  ra = a(`ZodGUID`, (e, t) => {
    ;(Lt.init(e, t), N.init(e, t))
  }),
  ia = a(`ZodUUID`, (e, t) => {
    ;(Rt.init(e, t), N.init(e, t))
  }),
  aa = a(`ZodURL`, (e, t) => {
    ;(Bt.init(e, t), N.init(e, t))
  })
function P(e) {
  return sr(aa, e)
}
const oa = a(`ZodEmoji`, (e, t) => {
    ;(Vt.init(e, t), N.init(e, t))
  }),
  sa = a(`ZodNanoID`, (e, t) => {
    ;(Ht.init(e, t), N.init(e, t))
  }),
  ca = a(`ZodCUID`, (e, t) => {
    ;(Ut.init(e, t), N.init(e, t))
  }),
  la = a(`ZodCUID2`, (e, t) => {
    ;(Wt.init(e, t), N.init(e, t))
  }),
  ua = a(`ZodULID`, (e, t) => {
    ;(Gt.init(e, t), N.init(e, t))
  }),
  da = a(`ZodXID`, (e, t) => {
    ;(Kt.init(e, t), N.init(e, t))
  }),
  fa = a(`ZodKSUID`, (e, t) => {
    ;(qt.init(e, t), N.init(e, t))
  }),
  pa = a(`ZodIPv4`, (e, t) => {
    ;(Qt.init(e, t), N.init(e, t))
  }),
  ma = a(`ZodIPv6`, (e, t) => {
    ;($t.init(e, t), N.init(e, t))
  }),
  ha = a(`ZodCIDRv4`, (e, t) => {
    ;(en.init(e, t), N.init(e, t))
  }),
  ga = a(`ZodCIDRv6`, (e, t) => {
    ;(tn.init(e, t), N.init(e, t))
  }),
  _a = a(`ZodBase64`, (e, t) => {
    ;(rn.init(e, t), N.init(e, t))
  }),
  va = a(`ZodBase64URL`, (e, t) => {
    ;(on.init(e, t), N.init(e, t))
  }),
  ya = a(`ZodE164`, (e, t) => {
    ;(sn.init(e, t), N.init(e, t))
  }),
  ba = a(`ZodJWT`, (e, t) => {
    ;(ln.init(e, t), N.init(e, t))
  }),
  xa = a(`ZodNumber`, (e, t) => {
    ;(un.init(e, t),
      j.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => li(e, t, n, r)),
      $i(e, `ZodNumber`, {
        gt(e, t) {
          return this.check(Pr(e, t))
        },
        gte(e, t) {
          return this.check(Fr(e, t))
        },
        min(e, t) {
          return this.check(Fr(e, t))
        },
        lt(e, t) {
          return this.check(Mr(e, t))
        },
        lte(e, t) {
          return this.check(Nr(e, t))
        },
        max(e, t) {
          return this.check(Nr(e, t))
        },
        int(e) {
          return this.check(Ca(e))
        },
        safe(e) {
          return this.check(Ca(e))
        },
        positive(e) {
          return this.check(Pr(0, e))
        },
        nonnegative(e) {
          return this.check(Fr(0, e))
        },
        negative(e) {
          return this.check(Mr(0, e))
        },
        nonpositive(e) {
          return this.check(Nr(0, e))
        },
        multipleOf(e, t) {
          return this.check(Ir(e, t))
        },
        step(e, t) {
          return this.check(Ir(e, t))
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
function F(e) {
  return Dr(xa, e)
}
const Sa = a(`ZodNumberFormat`, (e, t) => {
  ;(dn.init(e, t), xa.init(e, t))
})
function Ca(e) {
  return Or(Sa, e)
}
const wa = a(`ZodBoolean`, (e, t) => {
  ;(fn.init(e, t), j.init(e, t), (e._zod.processJSONSchema = (t, n, r) => ui(e, t, n, r)))
})
function I(e) {
  return kr(wa, e)
}
const Ta = a(`ZodUnknown`, (e, t) => {
  ;(pn.init(e, t), j.init(e, t), (e._zod.processJSONSchema = (e, t, n) => void 0))
})
function Ea() {
  return Ar(Ta)
}
const Da = a(`ZodNever`, (e, t) => {
  ;(mn.init(e, t), j.init(e, t), (e._zod.processJSONSchema = (t, n, r) => di(e, t, n, r)))
})
function Oa(e) {
  return jr(Da, e)
}
const ka = a(`ZodArray`, (e, t) => {
  ;(gn.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => _i(e, t, n, r)),
    (e.element = t.element),
    $i(e, `ZodArray`, {
      min(e, t) {
        return this.check(Rr(e, t))
      },
      nonempty(e) {
        return this.check(Rr(1, e))
      },
      max(e, t) {
        return this.check(Lr(e, t))
      },
      length(e, t) {
        return this.check(zr(e, t))
      },
      unwrap() {
        return this.element
      }
    }))
})
function L(e, t) {
  return Qr(ka, e, t)
}
const Aa = a(`ZodObject`, (e, t) => {
  ;(xn.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => vi(e, t, n, r)),
    _(e, `shape`, () => t.shape),
    $i(e, `ZodObject`, {
      keyof() {
        return H(Object.keys(this._zod.def.shape))
      },
      catchall(e) {
        return this.clone({ ...this._zod.def, catchall: e })
      },
      passthrough() {
        return this.clone({ ...this._zod.def, catchall: Ea() })
      },
      loose() {
        return this.clone({ ...this._zod.def, catchall: Ea() })
      },
      strict() {
        return this.clone({ ...this._zod.def, catchall: Oa() })
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
        return he(Ha, this, e[0])
      },
      required(...e) {
        return ge(Qa, this, e[0])
      }
    }))
})
function R(e, t) {
  let n = { type: `object`, shape: e ?? {}, ...C(t) }
  return new Aa(n)
}
function z(e, t) {
  return new Aa({ type: `object`, shape: e, catchall: Oa(), ...C(t) })
}
const ja = a(`ZodUnion`, (e, t) => {
  ;(Cn.init(e, t), j.init(e, t), (e._zod.processJSONSchema = (t, n, r) => yi(e, t, n, r)), (e.options = t.options))
})
function Ma(e, t) {
  return new ja({ type: `union`, options: e, ...C(t) })
}
const Na = a(`ZodDiscriminatedUnion`, (e, t) => {
  ;(ja.init(e, t), wn.init(e, t))
})
function B(e, t, n) {
  return new Na({ type: `union`, options: t, discriminator: e, ...C(n) })
}
const Pa = a(`ZodIntersection`, (e, t) => {
  ;(Tn.init(e, t), j.init(e, t), (e._zod.processJSONSchema = (t, n, r) => bi(e, t, n, r)))
})
function Fa(e, t) {
  return new Pa({ type: `intersection`, left: e, right: t })
}
const Ia = a(`ZodRecord`, (e, t) => {
  ;(On.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => xi(e, t, n, r)),
    (e.keyType = t.keyType),
    (e.valueType = t.valueType))
})
function La(e, t, n) {
  return !t || !t._zod
    ? new Ia({ type: `record`, keyType: M(), valueType: e, ...C(t) })
    : new Ia({ type: `record`, keyType: e, valueType: t, ...C(n) })
}
function V(e, t, n) {
  let r = S(e)
  return ((r._zod.values = void 0), new Ia({ type: `record`, keyType: r, valueType: t, ...C(n) }))
}
const Ra = a(`ZodEnum`, (e, t) => {
  ;(kn.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => fi(e, t, n, r)),
    (e.enum = t.entries),
    (e.options = Object.values(t.entries)))
  let n = new Set(Object.keys(t.entries))
  ;((e.extract = (e, r) => {
    let i = {}
    for (let r of e)
      if (n.has(r)) i[r] = t.entries[r]
      else throw Error(`Key ${r} not found in enum`)
    return new Ra({ ...t, checks: [], ...C(r), entries: i })
  }),
    (e.exclude = (e, r) => {
      let i = { ...t.entries }
      for (let t of e)
        if (n.has(t)) delete i[t]
        else throw Error(`Key ${t} not found in enum`)
      return new Ra({ ...t, checks: [], ...C(r), entries: i })
    }))
})
function H(e, t) {
  let n = Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e
  return new Ra({ type: `enum`, entries: n, ...C(t) })
}
const za = a(`ZodLiteral`, (e, t) => {
  ;(An.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => pi(e, t, n, r)),
    (e.values = new Set(t.values)),
    Object.defineProperty(e, 'value', {
      get() {
        if (t.values.length > 1)
          throw Error('This schema contains multiple valid literal values. Use `.values` instead.')
        return t.values[0]
      }
    }))
})
function U(e, t) {
  return new za({ type: `literal`, values: Array.isArray(e) ? e : [e], ...C(t) })
}
const Ba = a(`ZodTransform`, (e, t) => {
  ;(jn.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => gi(e, t, n, r)),
    (e._zod.parse = (n, r) => {
      if (r.direction === `backward`) throw new s(e.constructor.name)
      n.addIssue = (r) => {
        if (typeof r == `string`) n.issues.push(Se(r, n.value, t))
        else {
          let t = r
          ;(t.fatal && (t.continue = !1),
            (t.code ??= `custom`),
            (t.input ??= n.value),
            (t.inst ??= e),
            n.issues.push(Se(t)))
        }
      }
      let i = t.transform(n.value, n)
      return i instanceof Promise
        ? i.then((e) => ((n.value = e), (n.fallback = !0), n))
        : ((n.value = i), (n.fallback = !0), n)
    }))
})
function Va(e) {
  return new Ba({ type: `transform`, transform: e })
}
const Ha = a(`ZodOptional`, (e, t) => {
  ;(Nn.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ki(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Ua(e) {
  return new Ha({ type: `optional`, innerType: e })
}
const Wa = a(`ZodExactOptional`, (e, t) => {
  ;(Pn.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ki(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Ga(e) {
  return new Wa({ type: `optional`, innerType: e })
}
const Ka = a(`ZodNullable`, (e, t) => {
  ;(Fn.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Si(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function qa(e) {
  return new Ka({ type: `nullable`, innerType: e })
}
const Ja = a(`ZodDefault`, (e, t) => {
  ;(In.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => wi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeDefault = e.unwrap))
})
function Ya(e, t) {
  return new Ja({
    type: `default`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : ae(t)
    }
  })
}
const Xa = a(`ZodPrefault`, (e, t) => {
  ;(Rn.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Ti(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function Za(e, t) {
  return new Xa({
    type: `prefault`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : ae(t)
    }
  })
}
const Qa = a(`ZodNonOptional`, (e, t) => {
  ;(zn.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Ci(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType))
})
function $a(e, t) {
  return new Qa({ type: `nonoptional`, innerType: e, ...C(t) })
}
const eo = a(`ZodCatch`, (e, t) => {
  ;(Vn.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Ei(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeCatch = e.unwrap))
})
function to(e, t) {
  return new eo({ type: `catch`, innerType: e, catchValue: typeof t == `function` ? t : () => t })
}
const no = a(`ZodPipe`, (e, t) => {
  ;(Hn.init(e, t),
    j.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Di(e, t, n, r)),
    (e.in = t.in),
    (e.out = t.out))
})
function ro(e, t) {
  return new no({ type: `pipe`, in: e, out: t })
}
const io = a(`ZodPreprocess`, (e, t) => {
    ;(no.init(e, t), Wn.init(e, t))
  }),
  ao = a(`ZodReadonly`, (e, t) => {
    ;(Gn.init(e, t),
      j.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => Oi(e, t, n, r)),
      (e.unwrap = () => e._zod.def.innerType))
  })
function oo(e) {
  return new ao({ type: `readonly`, innerType: e })
}
const so = a(`ZodTemplateLiteral`, (e, t) => {
  ;(qn.init(e, t), j.init(e, t), (e._zod.processJSONSchema = (t, n, r) => mi(e, t, n, r)))
})
function co(e, t) {
  return new so({ type: `template_literal`, parts: e, ...C(t) })
}
const lo = a(`ZodCustom`, (e, t) => {
  ;(Jn.init(e, t), j.init(e, t), (e._zod.processJSONSchema = (t, n, r) => hi(e, t, n, r)))
})
function uo(e, t = {}) {
  return $r(lo, e, t)
}
function fo(e, t) {
  return ei(e, t)
}
function po(e, t) {
  return new io({ type: `pipe`, in: Va(e), out: t })
}
var mo = r((e, t) => {
    t.exports = {
      MAX_LENGTH: 256,
      MAX_SAFE_COMPONENT_LENGTH: 16,
      MAX_SAFE_BUILD_LENGTH: 250,
      MAX_SAFE_INTEGER: 2 ** 53 - 1 || 9007199254740991,
      RELEASE_TYPES: [`major`, `premajor`, `minor`, `preminor`, `patch`, `prepatch`, `prerelease`],
      SEMVER_SPEC_VERSION: `2.0.0`,
      FLAG_INCLUDE_PRERELEASE: 1,
      FLAG_LOOSE: 2
    }
  }),
  ho = r((e, t) => {
    t.exports =
      typeof process == `object` && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG)
        ? (...e) => console.error(`SEMVER`, ...e)
        : () => {}
  }),
  go = r((e, t) => {
    let { MAX_SAFE_COMPONENT_LENGTH: n, MAX_SAFE_BUILD_LENGTH: r, MAX_LENGTH: i } = mo(),
      a = ho()
    e = t.exports = {}
    let o = (e.re = []),
      s = (e.safeRe = []),
      c = (e.src = []),
      l = (e.safeSrc = []),
      u = (e.t = {}),
      d = 0,
      f = `[a-zA-Z0-9-]`,
      p = [
        [`\\s`, 1],
        [`\\d`, i],
        [f, r]
      ],
      m = (e) => {
        for (let [t, n] of p) e = e.split(`${t}*`).join(`${t}{0,${n}}`).split(`${t}+`).join(`${t}{1,${n}}`)
        return e
      },
      h = (e, t, n) => {
        let r = m(t),
          i = d++
        ;(a(e, i, t),
          (u[e] = i),
          (c[i] = t),
          (l[i] = r),
          (o[i] = new RegExp(t, n ? `g` : void 0)),
          (s[i] = new RegExp(r, n ? `g` : void 0)))
      }
    ;(h(`NUMERICIDENTIFIER`, `0|[1-9]\\d*`),
      h(`NUMERICIDENTIFIERLOOSE`, `\\d+`),
      h(`NONNUMERICIDENTIFIER`, `\\d*[a-zA-Z-]${f}*`),
      h(`MAINVERSION`, `(${c[u.NUMERICIDENTIFIER]})\\.(${c[u.NUMERICIDENTIFIER]})\\.(${c[u.NUMERICIDENTIFIER]})`),
      h(
        `MAINVERSIONLOOSE`,
        `(${c[u.NUMERICIDENTIFIERLOOSE]})\\.(${c[u.NUMERICIDENTIFIERLOOSE]})\\.(${c[u.NUMERICIDENTIFIERLOOSE]})`
      ),
      h(`PRERELEASEIDENTIFIER`, `(?:${c[u.NUMERICIDENTIFIER]}|${c[u.NONNUMERICIDENTIFIER]})`),
      h(`PRERELEASEIDENTIFIERLOOSE`, `(?:${c[u.NUMERICIDENTIFIERLOOSE]}|${c[u.NONNUMERICIDENTIFIER]})`),
      h(`PRERELEASE`, `(?:-(${c[u.PRERELEASEIDENTIFIER]}(?:\\.${c[u.PRERELEASEIDENTIFIER]})*))`),
      h(`PRERELEASELOOSE`, `(?:-?(${c[u.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${c[u.PRERELEASEIDENTIFIERLOOSE]})*))`),
      h(`BUILDIDENTIFIER`, `${f}+`),
      h(`BUILD`, `(?:\\+(${c[u.BUILDIDENTIFIER]}(?:\\.${c[u.BUILDIDENTIFIER]})*))`),
      h(`FULLPLAIN`, `v?${c[u.MAINVERSION]}${c[u.PRERELEASE]}?${c[u.BUILD]}?`),
      h(`FULL`, `^${c[u.FULLPLAIN]}$`),
      h(`LOOSEPLAIN`, `[v=\\s]*${c[u.MAINVERSIONLOOSE]}${c[u.PRERELEASELOOSE]}?${c[u.BUILD]}?`),
      h(`LOOSE`, `^${c[u.LOOSEPLAIN]}$`),
      h(`GTLT`, `((?:<|>)?=?)`),
      h(`XRANGEIDENTIFIERLOOSE`, `${c[u.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`),
      h(`XRANGEIDENTIFIER`, `${c[u.NUMERICIDENTIFIER]}|x|X|\\*`),
      h(
        `XRANGEPLAIN`,
        `[v=\\s]*(${c[u.XRANGEIDENTIFIER]})(?:\\.(${c[u.XRANGEIDENTIFIER]})(?:\\.(${c[u.XRANGEIDENTIFIER]})(?:${c[u.PRERELEASE]})?${c[u.BUILD]}?)?)?`
      ),
      h(
        `XRANGEPLAINLOOSE`,
        `[v=\\s]*(${c[u.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[u.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[u.XRANGEIDENTIFIERLOOSE]})(?:${c[u.PRERELEASELOOSE]})?${c[u.BUILD]}?)?)?`
      ),
      h(`XRANGE`, `^${c[u.GTLT]}\\s*${c[u.XRANGEPLAIN]}$`),
      h(`XRANGELOOSE`, `^${c[u.GTLT]}\\s*${c[u.XRANGEPLAINLOOSE]}$`),
      h(`COERCEPLAIN`, `(^|[^\\d])(\\d{1,${n}})(?:\\.(\\d{1,${n}}))?(?:\\.(\\d{1,${n}}))?`),
      h(`COERCE`, `${c[u.COERCEPLAIN]}(?:$|[^\\d])`),
      h(`COERCEFULL`, c[u.COERCEPLAIN] + `(?:${c[u.PRERELEASE]})?(?:${c[u.BUILD]})?(?:$|[^\\d])`),
      h(`COERCERTL`, c[u.COERCE], !0),
      h(`COERCERTLFULL`, c[u.COERCEFULL], !0),
      h(`LONETILDE`, `(?:~>?)`),
      h(`TILDETRIM`, `(\\s*)${c[u.LONETILDE]}\\s+`, !0),
      (e.tildeTrimReplace = `$1~`),
      h(`TILDE`, `^${c[u.LONETILDE]}${c[u.XRANGEPLAIN]}$`),
      h(`TILDELOOSE`, `^${c[u.LONETILDE]}${c[u.XRANGEPLAINLOOSE]}$`),
      h(`LONECARET`, `(?:\\^)`),
      h(`CARETTRIM`, `(\\s*)${c[u.LONECARET]}\\s+`, !0),
      (e.caretTrimReplace = `$1^`),
      h(`CARET`, `^${c[u.LONECARET]}${c[u.XRANGEPLAIN]}$`),
      h(`CARETLOOSE`, `^${c[u.LONECARET]}${c[u.XRANGEPLAINLOOSE]}$`),
      h(`COMPARATORLOOSE`, `^${c[u.GTLT]}\\s*(${c[u.LOOSEPLAIN]})$|^$`),
      h(`COMPARATOR`, `^${c[u.GTLT]}\\s*(${c[u.FULLPLAIN]})$|^$`),
      h(`COMPARATORTRIM`, `(\\s*)${c[u.GTLT]}\\s*(${c[u.LOOSEPLAIN]}|${c[u.XRANGEPLAIN]})`, !0),
      (e.comparatorTrimReplace = `$1$2$3`),
      h(`HYPHENRANGE`, `^\\s*(${c[u.XRANGEPLAIN]})\\s+-\\s+(${c[u.XRANGEPLAIN]})\\s*$`),
      h(`HYPHENRANGELOOSE`, `^\\s*(${c[u.XRANGEPLAINLOOSE]})\\s+-\\s+(${c[u.XRANGEPLAINLOOSE]})\\s*$`),
      h(`STAR`, `(<|>)?=?\\s*\\*`),
      h(`GTE0`, `^\\s*>=\\s*0\\.0\\.0\\s*$`),
      h(`GTE0PRE`, `^\\s*>=\\s*0\\.0\\.0-0\\s*$`))
  }),
  _o = r((e, t) => {
    let n = Object.freeze({ loose: !0 }),
      r = Object.freeze({})
    t.exports = (e) => (e ? (typeof e == `object` ? e : n) : r)
  }),
  vo = r((e, t) => {
    let n = /^[0-9]+$/,
      r = (e, t) => {
        let r = n.test(e),
          i = n.test(t)
        return (r && i && ((e = +e), (t = +t)), e === t ? 0 : r && !i ? -1 : i && !r ? 1 : e < t ? -1 : 1)
      }
    t.exports = { compareIdentifiers: r, rcompareIdentifiers: (e, t) => r(t, e) }
  }),
  W = r((e, t) => {
    let n = ho(),
      { MAX_LENGTH: r, MAX_SAFE_INTEGER: i } = mo(),
      { safeRe: a, safeSrc: o, t: s } = go(),
      c = _o(),
      { compareIdentifiers: l } = vo()
    t.exports = class e {
      constructor(t, o) {
        if (((o = c(o)), t instanceof e)) {
          if (t.loose === !!o.loose && t.includePrerelease === !!o.includePrerelease) return t
          t = t.version
        } else if (typeof t != `string`) throw TypeError(`Invalid version. Must be a string. Got type "${typeof t}".`)
        if (t.length > r) throw TypeError(`version is longer than ${r} characters`)
        ;(n(`SemVer`, t, o),
          (this.options = o),
          (this.loose = !!o.loose),
          (this.includePrerelease = !!o.includePrerelease))
        let l = t.trim().match(o.loose ? a[s.LOOSE] : a[s.FULL])
        if (!l) throw TypeError(`Invalid Version: ${t}`)
        if (
          ((this.raw = t),
          (this.major = +l[1]),
          (this.minor = +l[2]),
          (this.patch = +l[3]),
          this.major > i || this.major < 0)
        )
          throw TypeError(`Invalid major version`)
        if (this.minor > i || this.minor < 0) throw TypeError(`Invalid minor version`)
        if (this.patch > i || this.patch < 0) throw TypeError(`Invalid patch version`)
        ;((this.prerelease = l[4]
          ? l[4].split(`.`).map((e) => {
              if (/^[0-9]+$/.test(e)) {
                let t = +e
                if (t >= 0 && t < i) return t
              }
              return e
            })
          : []),
          (this.build = l[5] ? l[5].split(`.`) : []),
          this.format())
      }
      format() {
        return (
          (this.version = `${this.major}.${this.minor}.${this.patch}`),
          this.prerelease.length && (this.version += `-${this.prerelease.join(`.`)}`),
          this.version
        )
      }
      toString() {
        return this.version
      }
      compare(t) {
        if ((n(`SemVer.compare`, this.version, this.options, t), !(t instanceof e))) {
          if (typeof t == `string` && t === this.version) return 0
          t = new e(t, this.options)
        }
        return t.version === this.version ? 0 : this.compareMain(t) || this.comparePre(t)
      }
      compareMain(t) {
        return (
          t instanceof e || (t = new e(t, this.options)),
          l(this.major, t.major) || l(this.minor, t.minor) || l(this.patch, t.patch)
        )
      }
      comparePre(t) {
        if ((t instanceof e || (t = new e(t, this.options)), this.prerelease.length && !t.prerelease.length)) return -1
        if (!this.prerelease.length && t.prerelease.length) return 1
        if (!this.prerelease.length && !t.prerelease.length) return 0
        let r = 0
        do {
          let e = this.prerelease[r],
            i = t.prerelease[r]
          if ((n(`prerelease compare`, r, e, i), e === void 0 && i === void 0)) return 0
          if (i === void 0) return 1
          if (e === void 0) return -1
          if (e !== i) return l(e, i)
        } while (++r)
      }
      compareBuild(t) {
        t instanceof e || (t = new e(t, this.options))
        let r = 0
        do {
          let e = this.build[r],
            i = t.build[r]
          if ((n(`build compare`, r, e, i), e === void 0 && i === void 0)) return 0
          if (i === void 0) return 1
          if (e === void 0) return -1
          if (e !== i) return l(e, i)
        } while (++r)
      }
      inc(e, t, n) {
        if (e.startsWith(`pre`)) {
          if (!t && n === !1) throw Error(`invalid increment argument: identifier is empty`)
          if (t) {
            let e = RegExp(`^${this.options.loose ? o[s.PRERELEASELOOSE] : o[s.PRERELEASE]}$`),
              n = `-${t}`.match(e)
            if (!n || n[1] !== t) throw Error(`invalid identifier: ${t}`)
          }
        }
        switch (e) {
          case `premajor`:
            ;((this.prerelease.length = 0), (this.patch = 0), (this.minor = 0), this.major++, this.inc(`pre`, t, n))
            break
          case `preminor`:
            ;((this.prerelease.length = 0), (this.patch = 0), this.minor++, this.inc(`pre`, t, n))
            break
          case `prepatch`:
            ;((this.prerelease.length = 0), this.inc(`patch`, t, n), this.inc(`pre`, t, n))
            break
          case `prerelease`:
            ;(this.prerelease.length === 0 && this.inc(`patch`, t, n), this.inc(`pre`, t, n))
            break
          case `release`:
            if (this.prerelease.length === 0) throw Error(`version ${this.raw} is not a prerelease`)
            this.prerelease.length = 0
            break
          case `major`:
            ;((this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) && this.major++,
              (this.minor = 0),
              (this.patch = 0),
              (this.prerelease = []))
            break
          case `minor`:
            ;((this.patch !== 0 || this.prerelease.length === 0) && this.minor++,
              (this.patch = 0),
              (this.prerelease = []))
            break
          case `patch`:
            ;(this.prerelease.length === 0 && this.patch++, (this.prerelease = []))
            break
          case `pre`: {
            let e = +!!Number(n)
            if (this.prerelease.length === 0) this.prerelease = [e]
            else {
              let r = this.prerelease.length
              for (; --r >= 0;) typeof this.prerelease[r] == `number` && (this.prerelease[r]++, (r = -2))
              if (r === -1) {
                if (t === this.prerelease.join(`.`) && n === !1)
                  throw Error(`invalid increment argument: identifier already exists`)
                this.prerelease.push(e)
              }
            }
            if (t) {
              let r = [t, e]
              ;(n === !1 && (r = [t]),
                l(this.prerelease[0], t) === 0
                  ? isNaN(this.prerelease[1]) && (this.prerelease = r)
                  : (this.prerelease = r))
            }
            break
          }
          default:
            throw Error(`invalid increment argument: ${e}`)
        }
        return ((this.raw = this.format()), this.build.length && (this.raw += `+${this.build.join(`.`)}`), this)
      }
    }
  }),
  yo = r((e, t) => {
    let n = W()
    t.exports = (e, t, r = !1) => {
      if (e instanceof n) return e
      try {
        return new n(e, t)
      } catch (e) {
        if (!r) return null
        throw e
      }
    }
  }),
  bo = r((e, t) => {
    let n = yo()
    t.exports = (e, t) => {
      let r = n(e, t)
      return r ? r.version : null
    }
  }),
  xo = r((e, t) => {
    let n = yo()
    t.exports = (e, t) => {
      let r = n(e.trim().replace(/^[=v]+/, ``), t)
      return r ? r.version : null
    }
  }),
  So = r((e, t) => {
    let n = W()
    t.exports = (e, t, r, i, a) => {
      typeof r == `string` && ((a = i), (i = r), (r = void 0))
      try {
        return new n(e instanceof n ? e.version : e, r).inc(t, i, a).version
      } catch {
        return null
      }
    }
  }),
  Co = r((e, t) => {
    let n = yo()
    t.exports = (e, t) => {
      let r = n(e, null, !0),
        i = n(t, null, !0),
        a = r.compare(i)
      if (a === 0) return null
      let o = a > 0,
        s = o ? r : i,
        c = o ? i : r,
        l = !!s.prerelease.length
      if (c.prerelease.length && !l) {
        if (!c.patch && !c.minor) return `major`
        if (c.compareMain(s) === 0) return c.minor && !c.patch ? `minor` : `patch`
      }
      let u = l ? `pre` : ``
      return r.major === i.major
        ? r.minor === i.minor
          ? r.patch === i.patch
            ? `prerelease`
            : u + `patch`
          : u + `minor`
        : u + `major`
    }
  }),
  wo = r((e, t) => {
    let n = W()
    t.exports = (e, t) => new n(e, t).major
  }),
  To = r((e, t) => {
    let n = W()
    t.exports = (e, t) => new n(e, t).minor
  }),
  Eo = r((e, t) => {
    let n = W()
    t.exports = (e, t) => new n(e, t).patch
  }),
  Do = r((e, t) => {
    let n = yo()
    t.exports = (e, t) => {
      let r = n(e, t)
      return r && r.prerelease.length ? r.prerelease : null
    }
  }),
  G = r((e, t) => {
    let n = W()
    t.exports = (e, t, r) => new n(e, r).compare(new n(t, r))
  }),
  Oo = r((e, t) => {
    let n = G()
    t.exports = (e, t, r) => n(t, e, r)
  }),
  ko = r((e, t) => {
    let n = G()
    t.exports = (e, t) => n(e, t, !0)
  }),
  Ao = r((e, t) => {
    let n = W()
    t.exports = (e, t, r) => {
      let i = new n(e, r),
        a = new n(t, r)
      return i.compare(a) || i.compareBuild(a)
    }
  }),
  jo = r((e, t) => {
    let n = Ao()
    t.exports = (e, t) => e.sort((e, r) => n(e, r, t))
  }),
  Mo = r((e, t) => {
    let n = Ao()
    t.exports = (e, t) => e.sort((e, r) => n(r, e, t))
  }),
  No = r((e, t) => {
    let n = G()
    t.exports = (e, t, r) => n(e, t, r) > 0
  }),
  Po = r((e, t) => {
    let n = G()
    t.exports = (e, t, r) => n(e, t, r) < 0
  }),
  Fo = r((e, t) => {
    let n = G()
    t.exports = (e, t, r) => n(e, t, r) === 0
  }),
  Io = r((e, t) => {
    let n = G()
    t.exports = (e, t, r) => n(e, t, r) !== 0
  }),
  Lo = r((e, t) => {
    let n = G()
    t.exports = (e, t, r) => n(e, t, r) >= 0
  }),
  Ro = r((e, t) => {
    let n = G()
    t.exports = (e, t, r) => n(e, t, r) <= 0
  }),
  zo = r((e, t) => {
    let n = Fo(),
      r = Io(),
      i = No(),
      a = Lo(),
      o = Po(),
      s = Ro()
    t.exports = (e, t, c, l) => {
      switch (t) {
        case `===`:
          return (typeof e == `object` && (e = e.version), typeof c == `object` && (c = c.version), e === c)
        case `!==`:
          return (typeof e == `object` && (e = e.version), typeof c == `object` && (c = c.version), e !== c)
        case ``:
        case `=`:
        case `==`:
          return n(e, c, l)
        case `!=`:
          return r(e, c, l)
        case `>`:
          return i(e, c, l)
        case `>=`:
          return a(e, c, l)
        case `<`:
          return o(e, c, l)
        case `<=`:
          return s(e, c, l)
        default:
          throw TypeError(`Invalid operator: ${t}`)
      }
    }
  }),
  Bo = r((e, t) => {
    let n = W(),
      r = yo(),
      { safeRe: i, t: a } = go()
    t.exports = (e, t) => {
      if (e instanceof n) return e
      if ((typeof e == `number` && (e = String(e)), typeof e != `string`)) return null
      t ||= {}
      let o = null
      if (!t.rtl) o = e.match(t.includePrerelease ? i[a.COERCEFULL] : i[a.COERCE])
      else {
        let n = t.includePrerelease ? i[a.COERCERTLFULL] : i[a.COERCERTL],
          r
        for (; (r = n.exec(e)) && (!o || o.index + o[0].length !== e.length);)
          ((!o || r.index + r[0].length !== o.index + o[0].length) && (o = r),
            (n.lastIndex = r.index + r[1].length + r[2].length))
        n.lastIndex = -1
      }
      if (o === null) return null
      let s = o[2],
        c = o[3] || `0`,
        l = o[4] || `0`,
        u = t.includePrerelease && o[5] ? `-${o[5]}` : ``,
        d = t.includePrerelease && o[6] ? `+${o[6]}` : ``
      return r(`${s}.${c}.${l}${u}${d}`, t)
    }
  }),
  Vo = r((e, t) => {
    t.exports = class {
      constructor() {
        ;((this.max = 1e3), (this.map = new Map()))
      }
      get(e) {
        let t = this.map.get(e)
        if (t !== void 0) return (this.map.delete(e), this.map.set(e, t), t)
      }
      delete(e) {
        return this.map.delete(e)
      }
      set(e, t) {
        if (!this.delete(e) && t !== void 0) {
          if (this.map.size >= this.max) {
            let e = this.map.keys().next().value
            this.delete(e)
          }
          this.map.set(e, t)
        }
        return this
      }
    }
  }),
  K = r((e, t) => {
    let n = /\s+/g
    t.exports = class e {
      constructor(t, r) {
        if (((r = i(r)), t instanceof e))
          return t.loose === !!r.loose && t.includePrerelease === !!r.includePrerelease ? t : new e(t.raw, r)
        if (t instanceof a) return ((this.raw = t.value), (this.set = [[t]]), (this.formatted = void 0), this)
        if (
          ((this.options = r),
          (this.loose = !!r.loose),
          (this.includePrerelease = !!r.includePrerelease),
          (this.raw = t.trim().replace(n, ` `)),
          (this.set = this.raw
            .split(`||`)
            .map((e) => this.parseRange(e.trim()))
            .filter((e) => e.length)),
          !this.set.length)
        )
          throw TypeError(`Invalid SemVer Range: ${this.raw}`)
        if (this.set.length > 1) {
          let e = this.set[0]
          if (((this.set = this.set.filter((e) => !h(e[0]))), this.set.length === 0)) this.set = [e]
          else if (this.set.length > 1) {
            for (let e of this.set)
              if (e.length === 1 && g(e[0])) {
                this.set = [e]
                break
              }
          }
        }
        this.formatted = void 0
      }
      get range() {
        if (this.formatted === void 0) {
          this.formatted = ``
          for (let e = 0; e < this.set.length; e++) {
            e > 0 && (this.formatted += `||`)
            let t = this.set[e]
            for (let e = 0; e < t.length; e++)
              (e > 0 && (this.formatted += ` `), (this.formatted += t[e].toString().trim()))
          }
        }
        return this.formatted
      }
      format() {
        return this.range
      }
      toString() {
        return this.range
      }
      parseRange(e) {
        let t = ((this.options.includePrerelease && p) | (this.options.loose && m)) + `:` + e,
          n = r.get(t)
        if (n) return n
        let i = this.options.loose,
          s = i ? c[l.HYPHENRANGELOOSE] : c[l.HYPHENRANGE]
        ;((e = e.replace(s, se(this.options.includePrerelease))),
          o(`hyphen replace`, e),
          (e = e.replace(c[l.COMPARATORTRIM], u)),
          o(`comparator trim`, e),
          (e = e.replace(c[l.TILDETRIM], d)),
          o(`tilde trim`, e),
          (e = e.replace(c[l.CARETTRIM], f)),
          o(`caret trim`, e))
        let g = e
          .split(` `)
          .map((e) => v(e, this.options))
          .join(` `)
          .split(/\s+/)
          .map((e) => oe(e, this.options))
        ;(i && (g = g.filter((e) => (o(`loose invalid filter`, e, this.options), !!e.match(c[l.COMPARATORLOOSE])))),
          o(`range list`, g))
        let _ = new Map(),
          y = g.map((e) => new a(e, this.options))
        for (let e of y) {
          if (h(e)) return [e]
          _.set(e.value, e)
        }
        _.size > 1 && _.has(``) && _.delete(``)
        let ee = [..._.values()]
        return (r.set(t, ee), ee)
      }
      intersects(t, n) {
        if (!(t instanceof e)) throw TypeError(`a Range is required`)
        return this.set.some(
          (e) => _(e, n) && t.set.some((t) => _(t, n) && e.every((e) => t.every((t) => e.intersects(t, n))))
        )
      }
      test(e) {
        if (!e) return !1
        if (typeof e == `string`)
          try {
            e = new s(e, this.options)
          } catch {
            return !1
          }
        for (let t = 0; t < this.set.length; t++) if (x(this.set[t], e, this.options)) return !0
        return !1
      }
    }
    let r = new (Vo())(),
      i = _o(),
      a = Ho(),
      o = ho(),
      s = W(),
      { safeRe: c, t: l, comparatorTrimReplace: u, tildeTrimReplace: d, caretTrimReplace: f } = go(),
      { FLAG_INCLUDE_PRERELEASE: p, FLAG_LOOSE: m } = mo(),
      h = (e) => e.value === `<0.0.0-0`,
      g = (e) => e.value === ``,
      _ = (e, t) => {
        let n = !0,
          r = e.slice(),
          i = r.pop()
        for (; n && r.length;) ((n = r.every((e) => i.intersects(e, t))), (i = r.pop()))
        return n
      },
      v = (e, t) => (
        o(`comp`, e, t),
        (e = ne(e, t)),
        o(`caret`, e),
        (e = ee(e, t)),
        o(`tildes`, e),
        (e = ie(e, t)),
        o(`xrange`, e),
        (e = ae(e, t)),
        o(`stars`, e),
        e
      ),
      y = (e) => !e || e.toLowerCase() === `x` || e === `*`,
      ee = (e, t) =>
        e
          .trim()
          .split(/\s+/)
          .map((e) => te(e, t))
          .join(` `),
      te = (e, t) => {
        let n = t.loose ? c[l.TILDELOOSE] : c[l.TILDE]
        return e.replace(n, (t, n, r, i, a) => {
          o(`tilde`, e, t, n, r, i, a)
          let s
          return (
            y(n)
              ? (s = ``)
              : y(r)
                ? (s = `>=${n}.0.0 <${+n + 1}.0.0-0`)
                : y(i)
                  ? (s = `>=${n}.${r}.0 <${n}.${+r + 1}.0-0`)
                  : a
                    ? (o(`replaceTilde pr`, a), (s = `>=${n}.${r}.${i}-${a} <${n}.${+r + 1}.0-0`))
                    : (s = `>=${n}.${r}.${i} <${n}.${+r + 1}.0-0`),
            o(`tilde return`, s),
            s
          )
        })
      },
      ne = (e, t) =>
        e
          .trim()
          .split(/\s+/)
          .map((e) => re(e, t))
          .join(` `),
      re = (e, t) => {
        o(`caret`, e, t)
        let n = t.loose ? c[l.CARETLOOSE] : c[l.CARET],
          r = t.includePrerelease ? `-0` : ``
        return e.replace(n, (t, n, i, a, s) => {
          o(`caret`, e, t, n, i, a, s)
          let c
          return (
            y(n)
              ? (c = ``)
              : y(i)
                ? (c = `>=${n}.0.0${r} <${+n + 1}.0.0-0`)
                : y(a)
                  ? (c = n === `0` ? `>=${n}.${i}.0${r} <${n}.${+i + 1}.0-0` : `>=${n}.${i}.0${r} <${+n + 1}.0.0-0`)
                  : s
                    ? (o(`replaceCaret pr`, s),
                      (c =
                        n === `0`
                          ? i === `0`
                            ? `>=${n}.${i}.${a}-${s} <${n}.${i}.${+a + 1}-0`
                            : `>=${n}.${i}.${a}-${s} <${n}.${+i + 1}.0-0`
                          : `>=${n}.${i}.${a}-${s} <${+n + 1}.0.0-0`))
                    : (o(`no pr`),
                      (c =
                        n === `0`
                          ? i === `0`
                            ? `>=${n}.${i}.${a}${r} <${n}.${i}.${+a + 1}-0`
                            : `>=${n}.${i}.${a}${r} <${n}.${+i + 1}.0-0`
                          : `>=${n}.${i}.${a} <${+n + 1}.0.0-0`)),
            o(`caret return`, c),
            c
          )
        })
      },
      ie = (e, t) => (
        o(`replaceXRanges`, e, t),
        e
          .split(/\s+/)
          .map((e) => b(e, t))
          .join(` `)
      ),
      b = (e, t) => {
        e = e.trim()
        let n = t.loose ? c[l.XRANGELOOSE] : c[l.XRANGE]
        return e.replace(n, (n, r, i, a, s, c) => {
          o(`xRange`, e, n, r, i, a, s, c)
          let l = y(i),
            u = l || y(a),
            d = u || y(s),
            f = d
          return (
            r === `=` && f && (r = ``),
            (c = t.includePrerelease ? `-0` : ``),
            l
              ? (n = r === `>` || r === `<` ? `<0.0.0-0` : `*`)
              : r && f
                ? (u && (a = 0),
                  (s = 0),
                  r === `>`
                    ? ((r = `>=`), u ? ((i = +i + 1), (a = 0), (s = 0)) : ((a = +a + 1), (s = 0)))
                    : r === `<=` && ((r = `<`), u ? (i = +i + 1) : (a = +a + 1)),
                  r === `<` && (c = `-0`),
                  (n = `${r + i}.${a}.${s}${c}`))
                : u
                  ? (n = `>=${i}.0.0${c} <${+i + 1}.0.0-0`)
                  : d && (n = `>=${i}.${a}.0${c} <${i}.${+a + 1}.0-0`),
            o(`xRange return`, n),
            n
          )
        })
      },
      ae = (e, t) => (o(`replaceStars`, e, t), e.trim().replace(c[l.STAR], ``)),
      oe = (e, t) => (o(`replaceGTE0`, e, t), e.trim().replace(c[t.includePrerelease ? l.GTE0PRE : l.GTE0], ``)),
      se = (e) => (t, n, r, i, a, o, s, c, l, u, d, f) => (
        (n = y(r)
          ? ``
          : y(i)
            ? `>=${r}.0.0${e ? `-0` : ``}`
            : y(a)
              ? `>=${r}.${i}.0${e ? `-0` : ``}`
              : o
                ? `>=${n}`
                : `>=${n}${e ? `-0` : ``}`),
        (c = y(l)
          ? ``
          : y(u)
            ? `<${+l + 1}.0.0-0`
            : y(d)
              ? `<${l}.${+u + 1}.0-0`
              : f
                ? `<=${l}.${u}.${d}-${f}`
                : e
                  ? `<${l}.${u}.${+d + 1}-0`
                  : `<=${c}`),
        `${n} ${c}`.trim()
      ),
      x = (e, t, n) => {
        for (let n = 0; n < e.length; n++) if (!e[n].test(t)) return !1
        if (t.prerelease.length && !n.includePrerelease) {
          for (let n = 0; n < e.length; n++)
            if ((o(e[n].semver), e[n].semver !== a.ANY && e[n].semver.prerelease.length > 0)) {
              let r = e[n].semver
              if (r.major === t.major && r.minor === t.minor && r.patch === t.patch) return !0
            }
          return !1
        }
        return !0
      }
  }),
  Ho = r((e, t) => {
    let n = Symbol(`SemVer ANY`)
    t.exports = class e {
      static get ANY() {
        return n
      }
      constructor(t, i) {
        if (((i = r(i)), t instanceof e)) {
          if (t.loose === !!i.loose) return t
          t = t.value
        }
        ;((t = t.trim().split(/\s+/).join(` `)),
          s(`comparator`, t, i),
          (this.options = i),
          (this.loose = !!i.loose),
          this.parse(t),
          (this.value = this.semver === n ? `` : this.operator + this.semver.version),
          s(`comp`, this))
      }
      parse(e) {
        let t = this.options.loose ? i[a.COMPARATORLOOSE] : i[a.COMPARATOR],
          r = e.match(t)
        if (!r) throw TypeError(`Invalid comparator: ${e}`)
        ;((this.operator = r[1] === void 0 ? `` : r[1]),
          this.operator === `=` && (this.operator = ``),
          (this.semver = r[2] ? new c(r[2], this.options.loose) : n))
      }
      toString() {
        return this.value
      }
      test(e) {
        if ((s(`Comparator.test`, e, this.options.loose), this.semver === n || e === n)) return !0
        if (typeof e == `string`)
          try {
            e = new c(e, this.options)
          } catch {
            return !1
          }
        return o(e, this.operator, this.semver, this.options)
      }
      intersects(t, n) {
        if (!(t instanceof e)) throw TypeError(`a Comparator is required`)
        return this.operator === ``
          ? this.value === `` || new l(t.value, n).test(this.value)
          : t.operator === ``
            ? t.value === `` || new l(this.value, n).test(t.semver)
            : ((n = r(n)),
              (n.includePrerelease && (this.value === `<0.0.0-0` || t.value === `<0.0.0-0`)) ||
              (!n.includePrerelease && (this.value.startsWith(`<0.0.0`) || t.value.startsWith(`<0.0.0`)))
                ? !1
                : !!(
                    (this.operator.startsWith(`>`) && t.operator.startsWith(`>`)) ||
                    (this.operator.startsWith(`<`) && t.operator.startsWith(`<`)) ||
                    (this.semver.version === t.semver.version &&
                      this.operator.includes(`=`) &&
                      t.operator.includes(`=`)) ||
                    (o(this.semver, `<`, t.semver, n) && this.operator.startsWith(`>`) && t.operator.startsWith(`<`)) ||
                    (o(this.semver, `>`, t.semver, n) && this.operator.startsWith(`<`) && t.operator.startsWith(`>`))
                  ))
      }
    }
    let r = _o(),
      { safeRe: i, t: a } = go(),
      o = zo(),
      s = ho(),
      c = W(),
      l = K()
  }),
  Uo = r((e, t) => {
    let n = K()
    t.exports = (e, t, r) => {
      try {
        t = new n(t, r)
      } catch {
        return !1
      }
      return t.test(e)
    }
  }),
  Wo = r((e, t) => {
    let n = K()
    t.exports = (e, t) =>
      new n(e, t).set.map((e) =>
        e
          .map((e) => e.value)
          .join(` `)
          .trim()
          .split(` `)
      )
  }),
  Go = r((e, t) => {
    let n = W(),
      r = K()
    t.exports = (e, t, i) => {
      let a = null,
        o = null,
        s = null
      try {
        s = new r(t, i)
      } catch {
        return null
      }
      return (
        e.forEach((e) => {
          s.test(e) && (!a || o.compare(e) === -1) && ((a = e), (o = new n(a, i)))
        }),
        a
      )
    }
  }),
  Ko = r((e, t) => {
    let n = W(),
      r = K()
    t.exports = (e, t, i) => {
      let a = null,
        o = null,
        s = null
      try {
        s = new r(t, i)
      } catch {
        return null
      }
      return (
        e.forEach((e) => {
          s.test(e) && (!a || o.compare(e) === 1) && ((a = e), (o = new n(a, i)))
        }),
        a
      )
    }
  }),
  qo = r((e, t) => {
    let n = W(),
      r = K(),
      i = No()
    t.exports = (e, t) => {
      e = new r(e, t)
      let a = new n(`0.0.0`)
      if (e.test(a) || ((a = new n(`0.0.0-0`)), e.test(a))) return a
      a = null
      for (let t = 0; t < e.set.length; ++t) {
        let r = e.set[t],
          o = null
        ;(r.forEach((e) => {
          let t = new n(e.semver.version)
          switch (e.operator) {
            case `>`:
              ;(t.prerelease.length === 0 ? t.patch++ : t.prerelease.push(0), (t.raw = t.format()))
            case ``:
            case `>=`:
              ;(!o || i(t, o)) && (o = t)
              break
            case `<`:
            case `<=`:
              break
            default:
              throw Error(`Unexpected operation: ${e.operator}`)
          }
        }),
          o && (!a || i(a, o)) && (a = o))
      }
      return a && e.test(a) ? a : null
    }
  }),
  Jo = r((e, t) => {
    let n = K()
    t.exports = (e, t) => {
      try {
        return new n(e, t).range || `*`
      } catch {
        return null
      }
    }
  }),
  Yo = r((e, t) => {
    let n = W(),
      r = Ho(),
      { ANY: i } = r,
      a = K(),
      o = Uo(),
      s = No(),
      c = Po(),
      l = Ro(),
      u = Lo()
    t.exports = (e, t, d, f) => {
      ;((e = new n(e, f)), (t = new a(t, f)))
      let p, m, h, g, _
      switch (d) {
        case `>`:
          ;((p = s), (m = l), (h = c), (g = `>`), (_ = `>=`))
          break
        case `<`:
          ;((p = c), (m = u), (h = s), (g = `<`), (_ = `<=`))
          break
        default:
          throw TypeError(`Must provide a hilo val of "<" or ">"`)
      }
      if (o(e, t, f)) return !1
      for (let n = 0; n < t.set.length; ++n) {
        let a = t.set[n],
          o = null,
          s = null
        if (
          (a.forEach((e) => {
            ;(e.semver === i && (e = new r(`>=0.0.0`)),
              (o ||= e),
              (s ||= e),
              p(e.semver, o.semver, f) ? (o = e) : h(e.semver, s.semver, f) && (s = e))
          }),
          o.operator === g ||
            o.operator === _ ||
            ((!s.operator || s.operator === g) && m(e, s.semver)) ||
            (s.operator === _ && h(e, s.semver)))
        )
          return !1
      }
      return !0
    }
  }),
  Xo = r((e, t) => {
    let n = Yo()
    t.exports = (e, t, r) => n(e, t, `>`, r)
  }),
  Zo = r((e, t) => {
    let n = Yo()
    t.exports = (e, t, r) => n(e, t, `<`, r)
  }),
  Qo = r((e, t) => {
    let n = K()
    t.exports = (e, t, r) => ((e = new n(e, r)), (t = new n(t, r)), e.intersects(t, r))
  }),
  $o = r((e, t) => {
    let n = Uo(),
      r = G()
    t.exports = (e, t, i) => {
      let a = [],
        o = null,
        s = null,
        c = e.sort((e, t) => r(e, t, i))
      for (let e of c) n(e, t, i) ? ((s = e), (o ||= e)) : (s && a.push([o, s]), (s = null), (o = null))
      o && a.push([o, null])
      let l = []
      for (let [e, t] of a)
        e === t
          ? l.push(e)
          : !t && e === c[0]
            ? l.push(`*`)
            : t
              ? e === c[0]
                ? l.push(`<=${t}`)
                : l.push(`${e} - ${t}`)
              : l.push(`>=${e}`)
      let u = l.join(` || `),
        d = typeof t.raw == `string` ? t.raw : String(t)
      return u.length < d.length ? u : t
    }
  }),
  es = r((e, t) => {
    let n = K(),
      r = Ho(),
      { ANY: i } = r,
      a = Uo(),
      o = G(),
      s = (e, t, r = {}) => {
        if (e === t) return !0
        ;((e = new n(e, r)), (t = new n(t, r)))
        let i = !1
        OUTER: for (let n of e.set) {
          for (let e of t.set) {
            let t = u(n, e, r)
            if (((i ||= t !== null), t)) continue OUTER
          }
          if (i) return !1
        }
        return !0
      },
      c = [new r(`>=0.0.0-0`)],
      l = [new r(`>=0.0.0`)],
      u = (e, t, n) => {
        if (e === t) return !0
        if (e.length === 1 && e[0].semver === i) {
          if (t.length === 1 && t[0].semver === i) return !0
          e = n.includePrerelease ? c : l
        }
        if (t.length === 1 && t[0].semver === i) {
          if (n.includePrerelease) return !0
          t = l
        }
        let r = new Set(),
          s,
          u
        for (let t of e)
          t.operator === `>` || t.operator === `>=`
            ? (s = d(s, t, n))
            : t.operator === `<` || t.operator === `<=`
              ? (u = f(u, t, n))
              : r.add(t.semver)
        if (r.size > 1) return null
        let p
        if (
          s &&
          u &&
          ((p = o(s.semver, u.semver, n)), p > 0 || (p === 0 && (s.operator !== `>=` || u.operator !== `<=`)))
        )
          return null
        for (let e of r) {
          if ((s && !a(e, String(s), n)) || (u && !a(e, String(u), n))) return null
          for (let r of t) if (!a(e, String(r), n)) return !1
          return !0
        }
        let m,
          h,
          g,
          _,
          v = u && !n.includePrerelease && u.semver.prerelease.length ? u.semver : !1,
          y = s && !n.includePrerelease && s.semver.prerelease.length ? s.semver : !1
        v && v.prerelease.length === 1 && u.operator === `<` && v.prerelease[0] === 0 && (v = !1)
        for (let e of t) {
          if (
            ((_ = _ || e.operator === `>` || e.operator === `>=`),
            (g = g || e.operator === `<` || e.operator === `<=`),
            s)
          ) {
            if (
              (y &&
                e.semver.prerelease &&
                e.semver.prerelease.length &&
                e.semver.major === y.major &&
                e.semver.minor === y.minor &&
                e.semver.patch === y.patch &&
                (y = !1),
              e.operator === `>` || e.operator === `>=`)
            ) {
              if (((m = d(s, e, n)), m === e && m !== s)) return !1
            } else if (s.operator === `>=` && !a(s.semver, String(e), n)) return !1
          }
          if (u) {
            if (
              (v &&
                e.semver.prerelease &&
                e.semver.prerelease.length &&
                e.semver.major === v.major &&
                e.semver.minor === v.minor &&
                e.semver.patch === v.patch &&
                (v = !1),
              e.operator === `<` || e.operator === `<=`)
            ) {
              if (((h = f(u, e, n)), h === e && h !== u)) return !1
            } else if (u.operator === `<=` && !a(u.semver, String(e), n)) return !1
          }
          if (!e.operator && (u || s) && p !== 0) return !1
        }
        return !((s && g && !u && p !== 0) || (u && _ && !s && p !== 0) || y || v)
      },
      d = (e, t, n) => {
        if (!e) return t
        let r = o(e.semver, t.semver, n)
        return r > 0 ? e : r < 0 || (t.operator === `>` && e.operator === `>=`) ? t : e
      },
      f = (e, t, n) => {
        if (!e) return t
        let r = o(e.semver, t.semver, n)
        return r < 0 ? e : r > 0 || (t.operator === `<` && e.operator === `<=`) ? t : e
      }
    t.exports = s
  })
r((e, t) => {
  let n = go(),
    r = mo(),
    i = W(),
    a = vo()
  t.exports = {
    parse: yo(),
    valid: bo(),
    clean: xo(),
    inc: So(),
    diff: Co(),
    major: wo(),
    minor: To(),
    patch: Eo(),
    prerelease: Do(),
    compare: G(),
    rcompare: Oo(),
    compareLoose: ko(),
    compareBuild: Ao(),
    sort: jo(),
    rsort: Mo(),
    gt: No(),
    lt: Po(),
    eq: Fo(),
    neq: Io(),
    gte: Lo(),
    lte: Ro(),
    cmp: zo(),
    coerce: Bo(),
    Comparator: Ho(),
    Range: K(),
    satisfies: Uo(),
    toComparators: Wo(),
    maxSatisfying: Go(),
    minSatisfying: Ko(),
    minVersion: qo(),
    validRange: Jo(),
    outside: Yo(),
    gtr: Xo(),
    ltr: Zo(),
    intersects: Qo(),
    simplifyRange: $o(),
    subset: es(),
    SemVer: i,
    re: n.re,
    src: n.src,
    tokens: n.t,
    SEMVER_SPEC_VERSION: r.SEMVER_SPEC_VERSION,
    RELEASE_TYPES: r.RELEASE_TYPES,
    compareIdentifiers: a.compareIdentifiers,
    rcompareIdentifiers: a.rcompareIdentifiers
  }
})()
const q = {
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
  ts = {
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
  ns = { WEB_SEARCH: `web-search`, URL_CONTEXT: `url-context` },
  rs = { ALL_CHAT_MODELS: `all-chat-models`, MODEL_DEPENDENT: `model-dependent` },
  is = {
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
  as = { TEXT: `text`, IMAGE: `image`, AUDIO: `audio`, VIDEO: `video`, VECTOR: `vector` },
  os = { USD: `USD`, CNY: `CNY` },
  ss = {
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
function J(e) {
  return Object.values(e)
}
const cs = H(J(q)),
  ls = M().min(1),
  us = M().min(1),
  ds = M().min(1),
  fs = R({ min: F(), max: F() }).refine((e) => e.min <= e.max, { message: `min must be less than or equal to max` })
R({ min: M(), max: M() })
const ps = H(J(os)).optional(),
  Y = R({ perMillionTokens: F().nonnegative().nullable(), currency: ps }),
  ms = La(M(), Ea()).optional()
function X(e, { min: t } = {}) {
  let n = L(Ea()).transform((t) =>
    t.reduce((t, n) => {
      let r = e.safeParse(n)
      return (r.success && t.push(r.data), t)
    }, [])
  )
  return t === void 0 ? n : n.refine((e) => e.length >= t, { message: `expected at least ${t} recognized value(s)` })
}
function hs(e) {
  if (e == null) return
  if (typeof e == `number` || typeof e != `string`) return e
  let t = e.trim()
  if (!t) return
  let n = Number(t)
  return Number.isFinite(n) ? n : e
}
const Z = M().optional(),
  Q = I().optional(),
  $ = po(hs, F().finite().optional()),
  gs = po(hs, F().finite().int().optional()),
  _s = Ma([
    co([F(), `:`, F()]).refine(
      (e) =>
        /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(e) &&
        e.split(`:`).every((e) => Number.isFinite(Number(e)) && Number(e) > 0),
      `Expected a positive width:height ratio`
    ),
    U(`auto`)
  ]),
  vs = {
    addWatermark: { schema: Q, wire: `watermark` },
    aspectRatio: { schema: _s.optional() },
    background: { schema: Z },
    bottomScale: { schema: $ },
    cfg: { schema: $ },
    customSize: { schema: Z },
    detail: { schema: $ },
    enableInterleave: { schema: Q },
    function: { schema: Z },
    guidanceScale: { schema: $ },
    imageResolution: { schema: Z, wire: `size` },
    imageWeight: { schema: $ },
    isSketch: { schema: Q },
    leftScale: { schema: $ },
    magicPromptOption: { schema: Q },
    maxImages: { schema: gs },
    moderation: { schema: Z },
    negativePrompt: { schema: Z },
    numImages: { schema: gs },
    numInferenceSteps: { schema: gs },
    outputFormat: { schema: Z },
    outputCompression: { schema: gs },
    personGeneration: { schema: Z },
    promptEnhancement: { schema: Q },
    promptExtend: { schema: Q },
    quality: { schema: Z },
    resolution: { schema: Z },
    refMode: { schema: Z },
    refStrength: { schema: $ },
    renderingSpeed: { schema: Z },
    resemblance: { schema: $ },
    rightScale: { schema: $ },
    safetyTolerance: { schema: gs },
    seed: { schema: gs },
    sequentialImageGeneration: { schema: Z },
    size: { schema: Z },
    sourceLang: { schema: Z },
    strength: { schema: $ },
    style: { schema: Z },
    styleType: { schema: Z },
    targetLang: { schema: Z },
    thinkingMode: { schema: Q },
    topScale: { schema: $ },
    upscaleFactor: { schema: $ }
  }
;(R(Object.fromEntries(Object.entries(vs).map(([e, t]) => [e, t.schema]))), Object.keys(vs))
const ys = H(J(as)),
  bs = H(J(ts)),
  xs = H(J(is)),
  Ss = R({ min: F().nonnegative().optional(), max: F().positive().optional(), default: F().nonnegative().optional() })
    .refine((e) => (e.min == null) == (e.max == null), { message: `min and max must be both present or both absent` })
    .refine((e) => e.min == null || e.max == null || e.min <= e.max, {
      message: `min must be less than or equal to max`
    }),
  Cs = H(J(ss)),
  ws = B(`kind`, [
    R({ kind: U(`effort`), values: X(Cs, { min: 1 }), default: Cs.optional() }),
    R({ kind: U(`budget`), min: F().nonnegative(), max: F().positive(), default: F().nonnegative().optional() }),
    R({ kind: U(`toggle`), default: I().optional() })
  ]),
  Ts = H([`effort`, `budget`, `adaptive-always`, `adaptive-between-tools`])
R({
  pattern: M().refine(
    (e) => {
      try {
        return (new RegExp(e, `i`), !0)
      } catch {
        return !1
      }
    },
    { message: `pattern must be a valid regular expression` }
  ),
  effort: X(Cs, { min: 1 }).optional(),
  toggle: I().optional(),
  budget: R({ min: F().nonnegative(), max: F().positive() })
    .refine((e) => e.min <= e.max, { message: `budget min must be <= max` })
    .optional(),
  template: U(!0).optional(),
  wireDialect: Ts.optional()
}).refine(
  (e) =>
    e.template !== !0 || e.effort !== void 0 || e.toggle !== void 0 || e.budget !== void 0 || e.wireDialect !== void 0,
  { message: `a template rule with no knobs declares nothing — drop it or make it a profile` }
)
const Es = R({
    controls: X(ws).optional(),
    thinkingTokenLimits: Ss.optional(),
    supportedEfforts: X(Cs).optional(),
    defaultEffort: Cs.optional(),
    wireDialect: Ts.optional()
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
  Ds = H([`generate`, `remix`, `upscale`]),
  Os = R({ type: U(`switch`), default: I().optional() }),
  ks = R({
    type: U(`enum`),
    options: L(M()).min(1),
    default: M().optional(),
    render: H([`select`, `chips`]).optional(),
    columns: F().int().positive().optional()
  }),
  As = R({ type: U(`range`), min: F(), max: F(), default: F().optional(), step: F().optional() }).refine(
    (e) => e.min <= e.max,
    { message: `min must be ≤ max` }
  ),
  js = R({
    type: U(`range`),
    min: F().int(),
    max: F().int(),
    default: F().int().optional(),
    step: F().int().positive().default(1)
  }).refine((e) => e.min <= e.max, { message: `min must be ≤ max` }),
  Ms = B(`type`, [
    Os,
    ks,
    As,
    R({ type: U(`size`), minSide: F(), maxSide: F(), pairedEnumKey: M().optional() }),
    R({ type: U(`text`), multiline: I().optional() })
  ]),
  Ns = ks
    .extend({ options: L(vs.aspectRatio.schema.unwrap()).min(1), default: vs.aspectRatio.schema })
    .refine((e) => e.default === void 0 || e.options.includes(e.default), {
      path: [`default`],
      message: `Aspect ratio default must be a declared option`
    })
function Ps(e, t) {
  if (e == null) return
  let n = Ns.safeParse(e)
  if (!n.success) for (let e of n.error.issues) t.addIssue({ ...e, path: [`aspectRatio`, ...e.path] })
}
const Fs = [is.NUM_IMAGES, is.MAX_IMAGES, is.NUM_INFERENCE_STEPS, is.SAFETY_TOLERANCE, is.OUTPUT_COMPRESSION],
  Is = V(xs, Ms)
    .superRefine((e, t) => Ps(e.aspectRatio, t))
    .transform((e, t) => {
      let n = { ...e }
      for (let r of Fs) {
        let i = e[r]
        if (i === void 0) continue
        let a = js.safeParse(i)
        if (a.success) n[r] = a.data
        else for (let e of a.error.issues) t.addIssue({ ...e, path: [r, ...e.path] })
      }
      return n
    }),
  Ls = z({
    min: F().int().nonnegative(),
    max: B(`kind`, [z({ kind: U(`known`), value: F().int().nonnegative() }), z({ kind: U(`unknown`) })])
  }),
  Rs = z({
    images: Ls,
    prompt: H([`required`, `optional`]),
    mask: H([`supported`, `unsupported`, `unknown`]),
    mediaTypes: B(`kind`, [z({ kind: U(`known`), values: L(M().regex(/^image\//)).min(1) }), z({ kind: U(`unknown`) })])
  }),
  zs = B(`kind`, [
    z({ kind: U(`sdk`) }),
    z({
      kind: U(`custom`),
      endpoint: M().regex(/^\/(?!\/)/, `image endpoint must be a root-relative path`),
      isSync: I()
    })
  ]),
  Bs = z({ supports: Is, inputs: Rs, protocol: zs.optional() }).superRefine(({ inputs: e }, t) => {
    e.images.max.kind === `known` &&
      e.images.min > e.images.max.value &&
      t.addIssue({ code: `custom`, path: [`inputs`, `images`], message: `minimum image count exceeds maximum` })
  }),
  Vs = z({
    supports: V(xs, Ms.nullable())
      .superRefine((e, t) => Ps(e.aspectRatio, t))
      .optional(),
    inputs: Rs.partial().extend({ images: Ls.partial().optional() }).optional(),
    protocol: zs.nullable().optional()
  })
function Hs(e, t) {
  let n = { ...e.supports }
  for (let e of xs.options) {
    let r = t.supports?.[e]
    r === null ? delete n[e] : r !== void 0 && (n[e] = r)
  }
  let r = t.protocol === void 0 ? e.protocol : t.protocol
  return Bs.parse({
    supports: n,
    inputs: { ...e.inputs, ...t.inputs, images: { ...e.inputs.images, ...t.inputs?.images } },
    ...(r == null ? {} : { protocol: r })
  })
}
const Us = Vs.extend({ withImages: Vs.nullable().optional(), operations: V(Ds, Vs.nullable()).optional() }),
  Ws = z({
    ...Bs.shape,
    withImages: Vs.nullable().optional(),
    operations: V(Ds, Vs.nullable()).optional()
  }).superRefine((e, t) => {
    let n = Bs.safeParse({ supports: e.supports, inputs: e.inputs, protocol: e.protocol })
    if (!n.success) {
      for (let e of n.error.issues) t.addIssue({ ...e })
      return
    }
    let r
    if (e.withImages)
      try {
        r = Hs(n.data, e.withImages)
      } catch (e) {
        if (!(e instanceof zi)) throw e
        for (let n of e.issues) t.addIssue({ ...n, path: [`withImages`, ...n.path] })
      }
    for (let i of Ds.options) {
      let a = e.operations?.[i]
      if (a == null) continue
      let o = i === `generate` && r ? [n.data, r] : [n.data]
      for (let e of o)
        try {
          Hs(e, a)
        } catch (e) {
          if (!(e instanceof zi)) throw e
          for (let n of e.issues) t.addIssue({ ...n, path: [`operations`, i, ...n.path] })
        }
    }
  }),
  Gs = R({
    temperature: R({ supported: I(), range: fs.optional() }).default({ supported: !0 }),
    topP: R({ supported: I(), range: fs.optional() }).default({ supported: !0 }),
    topK: R({ supported: I(), range: fs.optional() }).default({ supported: !1 }),
    frequencyPenalty: I().default(!0),
    presencePenalty: I().default(!0),
    maxTokens: I().default(!0),
    stopSequences: I().default(!0),
    systemMessage: I().default(!0)
  }),
  Ks = R({
    input: Y,
    output: Y,
    cacheRead: Y.optional(),
    cacheWrite: Y.optional(),
    inputTokenTiers: L(
      R({
        minInputTokens: F().int().positive().refine(Number.isSafeInteger),
        input: Y,
        output: Y,
        cacheRead: Y.optional(),
        cacheWrite: Y.optional()
      })
    ).optional(),
    perImage: R({ price: F(), currency: ps, unit: H([`image`, `pixel`]).optional() }).optional(),
    perMinute: R({ price: F(), currency: ps }).optional()
  })
function qs(e, t) {
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
    r = n[0]?.rate.currency ?? os.USD
  for (let { rate: e, path: i } of n)
    (e.currency ?? os.USD) !== r &&
      t.addIssue({ code: `custom`, path: [...i, `currency`], message: `pricing currencies must match` })
}
const Js = Ks.superRefine(qs),
  Ys = Ks.partial().superRefine(qs),
  Xs = R({
    id: ls,
    name: M(),
    description: M().optional(),
    capabilities: X(bs)
      .refine((e) => new Set(e).size === e.length, { message: `Capabilities must be unique` })
      .optional(),
    inputModalities: X(ys)
      .refine((e) => new Set(e).size === e.length, { message: `Input modalities must be unique` })
      .optional(),
    outputModalities: X(ys)
      .refine((e) => new Set(e).size === e.length, { message: `Output modalities must be unique` })
      .optional(),
    endpointTypes: X(cs).optional(),
    contextWindow: F().optional(),
    maxOutputTokens: F().optional(),
    maxInputTokens: F().optional(),
    pricing: Js.optional(),
    reasoning: Es.optional(),
    parameterSupport: Gs.optional(),
    imageGeneration: Ws.optional(),
    family: M().optional(),
    ownedBy: M().optional(),
    openWeights: I().optional(),
    metadata: ms
  }),
  Zs = R({ version: ds, models: X(Xs) }),
  Qs = {
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
  $s = H(
    `reasoningEffort,reasoningSummary,reasoning_effort,reasoning.effort,reasoning.enabled,reasoning.exclude,reasoning.max_tokens,thinking.type,thinking.budget_tokens,thinking.budgetTokens,thinking.display,effort,sendReasoning,enable_thinking,thinking_budget,incremental_output,disable_reasoning,reasoning_budget,chat_template_kwargs.enable_thinking,chat_template_kwargs.thinking,chat_template_kwargs.thinking_mode,chat_template_kwargs.thinking_budget,extra_body.google.thinking_config.thinking_budget,extra_body.google.thinking_config.include_thoughts,extra_body.thinking.type,extra_body.thinking_budget,extra_body.reasoning_effort,thinkingConfig.includeThoughts,thinkingConfig.thinkingBudget,thinkingConfig.thinkingLevel,reasoningConfig.type,reasoningConfig.budgetTokens,reasoningConfig.maxReasoningEffort,think`.split(
      `,`
    )
  ),
  ec = H(J(ss)),
  tc = R({
    target: $s,
    value: B(`source`, [
      R({ source: U(`literal`), value: Ma([M(), F(), I()]) }),
      R({ source: U(`effort`) }),
      R({ source: U(`budget`) }),
      R({ source: U(`assistant-summary`) })
    ])
  }),
  nc = R({
    target: $s,
    value: B(`source`, [
      R({ source: U(`literal`), value: Ma([M(), F(), I()]) }),
      R({ source: U(`effort`) }),
      R({ source: U(`assistant-summary`) })
    ])
  }),
  rc = R({
    min: F().nonnegative().optional(),
    autoValue: F().optional(),
    clampToMaxTokens: I().optional(),
    missing: B(`type`, [
      R({ type: U(`omit-value`) }),
      R({ type: U(`omit-mode`) }),
      R({ type: U(`fallback`), value: F() })
    ])
  }),
  ic = V(ec, ec).optional(),
  ac = Ma([
    R({ operations: L(nc).min(1), effortMap: ic }),
    R({
      operations: L(tc)
        .min(1)
        .refine((e) => e.some((e) => e.value.source === `budget`), {
          message: `reasoning budget mode must contain a budget operation`
        }),
      effortMap: ic,
      budget: rc
    })
  ]),
  oc = R({
    disabled: U(!0).optional(),
    default: ac.optional(),
    off: ac.optional(),
    auto: ac.optional(),
    effort: ac.optional()
  }).refine((e) => e.disabled === !0 || e.default || e.off || e.auto || e.effort, {
    message: `reasoning wire profile must declare a mode or be disabled`
  })
R({ wire: oc, budgetWire: oc.optional(), alwaysOnWire: oc.optional(), betweenToolsWire: oc.optional() })
const sc = J(q),
  cc = H([`global`, `cn`]),
  lc = H([`openai-priority`, `claude-code`]),
  uc = H([`standard`, `auto`, `fast`, `flex`]),
  dc = L(uc)
    .min(1)
    .refine((e) => new Set(e).size === e.length, { message: `service tier options must be unique` })
    .refine((e) => e.includes(`standard`), { message: `service tier options must include standard` }),
  fc = R({
    default: uc,
    options: dc,
    wire: R({
      delivery: B(`type`, [
        R({ type: U(`provider-option`), key: M().min(1) }),
        R({ type: U(`request-body`), key: M().min(1) })
      ]),
      values: V(uc, M().min(1))
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
  pc = R({
    id: H(J(ns)),
    modelScope: H(J(rs)).default(rs.MODEL_DEPENDENT),
    endpointTypes: X(cs).optional(),
    vendors: X(H(Object.keys(Qs))).optional()
  }),
  mc = (e) => R({ type: U(e), wire: oc.optional() }),
  hc = B(`type`, [mc(`openai-chat`), mc(`openai-responses`), mc(`anthropic`), mc(`gemini`), mc(`ollama`), mc(`none`)])
hc.options.map((e) => e.shape.type.value)
const gc = R({
    website: R({ official: P().optional(), docs: P().optional(), apiKey: P().optional(), models: P().optional() })
  }),
  _c = R({ streamOptions: I().optional(), developerRole: I().optional(), reasoningSummary: I().optional() }),
  vc = R({
    baseUrl: P().optional(),
    modelsApiUrls: R({
      default: P().optional(),
      embedding: P().optional(),
      image: P().optional(),
      reranker: P().optional()
    }).optional(),
    reasoningFormat: hc.optional(),
    adapterFamily: M().optional(),
    dialect: _c.optional(),
    requestControls: R({ serviceTier: fc.optional() }).optional()
  }),
  yc = R({
    version: ds,
    providers: X(
      R({
        id: us,
        presetProviderId: us.optional(),
        name: M(),
        availableInEditions: X(cc, { min: 1 }).optional(),
        description: M().optional(),
        endpointConfigs: La(
          M().refine((e) => sc.includes(e), {
            message: `Invalid endpoint type key, must be one of: ${J(q).join(`, `)}`
          }),
          vc
        ).optional(),
        defaultChatEndpoint: cs.nullable().default(null),
        modelListSource: H([`api`, `registry`]).default(`api`),
        supplementModelsFromRegistry: I().optional(),
        modelResolution: B(`source`, [
          R({ source: U(`catalog`) }),
          R({
            source: U(`provider`),
            defaults: Xs.pick({
              capabilities: !0,
              inputModalities: !0,
              outputModalities: !0,
              endpointTypes: !0,
              imageGeneration: !0
            })
              .required({ capabilities: !0, inputModalities: !0, outputModalities: !0, endpointTypes: !0 })
              .extend({ supportsStreaming: I() })
          })
        ]).optional(),
        authMethods: X(H([`api-key`, `oauth`, `external-cli`])).optional(),
        authOptional: I().default(!1),
        serverTools: X(pc).default([]),
        reportsActualCost: I().default(!1),
        reportedCostCurrency: ps,
        fastMode: R({ transport: lc, serviceTier: M().optional() }).optional(),
        metadata: ms.and(gc)
      }).refine((e) => (e.endpointConfigs && e.defaultChatEndpoint ? e.defaultChatEndpoint in e.endpointConfigs : !0), {
        message: `defaultChatEndpoint must exist as a key in endpointConfigs`
      })
    )
  }),
  bc = R({ add: X(bs).optional(), remove: X(bs).optional(), force: X(bs).optional() }),
  xc = H([
    q.OPENAI_RESPONSES,
    q.OPENAI_CHAT_COMPLETIONS,
    q.ANTHROPIC_MESSAGES,
    q.GOOGLE_GENERATE_CONTENT,
    q.OLLAMA_CHAT,
    q.OLLAMA_GENERATE,
    q.OPENAI_TEXT_COMPLETIONS
  ]),
  Sc = R({ support: Es.optional(), wire: oc.optional() }).refine((e) => e.support || e.wire, {
    message: `provider-model reasoning contract must declare support or wire`
  }),
  Cc = R({
    providerId: us,
    modelId: ls,
    apiModelId: M().optional(),
    modelVariants: L(M().min(1)).optional(),
    capabilities: bc.optional(),
    limits: R({
      contextWindow: F().optional(),
      maxOutputTokens: F().optional(),
      maxInputTokens: F().optional()
    }).optional(),
    pricing: Ys.optional(),
    reasoningContracts: V(xc, Sc).optional(),
    supportsFastMode: I().optional(),
    requestControls: R({ serviceTier: R({ options: dc }).optional() }).optional(),
    parameterSupport: Gs.partial().optional(),
    endpointTypes: X(cs).optional(),
    inputModalities: X(ys).optional(),
    outputModalities: X(ys).optional(),
    name: M().optional(),
    description: M().optional(),
    family: M().optional(),
    ownedBy: M().optional(),
    imageGeneration: Us.optional(),
    disabled: I().optional(),
    replaceWith: ls.optional(),
    reason: M().optional()
  }),
  wc = R({ version: ds, overrides: X(Cc) }),
  Tc = `anthropic|amazon|meta|google|mistralai|cohere|openai|ai21|microsoft|nvidia`
;(RegExp(`^(?:[a-z]+\\.)*(?:${`${Tc}|deepseek|minimax|mistral|moonshot|moonshotai|qwen|writer|xai|zai`})\\.`),
  RegExp(`^(?:${Tc})-{1,2}`),
  R({
    minAppVersion: M().min(1),
    sourceAppVersion: M().min(1),
    revision: F().int().nonnegative(),
    schemaVersion: F().int(),
    files: La(M(), M())
  }))
function Ec(e, t) {
  return t === null
    ? null
    : {
        ...e,
        ...t,
        supports: { ...e?.supports, ...t.supports },
        inputs: { ...e?.inputs, ...t.inputs, images: { ...e?.inputs?.images, ...t.inputs?.images } }
      }
}
function Dc(e, t) {
  let n = e?.imageGeneration,
    r = t?.imageGeneration
  if (r === void 0) return n
  if (n === void 0) {
    let e = Ws.parse({ ...r, supports: {} })
    return Ws.parse({ ...e, ...Hs(e, r) })
  }
  let i = Hs(n, r),
    a = { ...n.operations }
  for (let e of Ds.options) {
    let t = r.operations?.[e]
    t !== void 0 && (a[e] = Ec(a[e], t))
  }
  return Ws.parse({
    ...i,
    withImages: r.withImages === void 0 ? n.withImages : Ec(n.withImages, r.withImages),
    operations: a
  })
}
function Oc(e, t) {
  let n = new Map(e.map((e) => [e.id, e]))
  for (let e of t)
    try {
      Dc(n.get(e.modelId) ?? null, e)
    } catch (t) {
      let n = t instanceof Error ? t.message : String(t)
      throw Error(`Invalid image capability for ${e.providerId}/${e.modelId}: ${n}`, { cause: t })
    }
}
const kc = {
    'models.json': Zs.extend({ models: L(Xs.pick({ imageGeneration: !0 }).loose()) }).transform((e) => Zs.parse(e)),
    'providers.json': yc,
    'provider-models.json': wc
      .extend({ overrides: L(Cc.pick({ imageGeneration: !0 }).loose()) })
      .transform((e) => wc.parse(e))
  },
  Ac = 4
function jc(e) {
  return e && typeof e == `object` && `issues` in e
    ? JSON.stringify(e.issues)
    : e instanceof Error
      ? e.message
      : String(e)
}
function Mc(e, t) {
  kc[e].parse(t)
}
function Nc(n) {
  function r(r, i) {
    try {
      return i.parse(JSON.parse(e(t.join(n, r), `utf8`)))
    } catch (e) {
      throw Error(`${r} is not compatible with registry schema v4: ${jc(e)}`)
    }
  }
  let { models: i } = r(`models.json`, kc[`models.json`])
  r(`providers.json`, kc[`providers.json`])
  let { overrides: a } = r(`provider-models.json`, kc[`provider-models.json`])
  Oc(i, a)
}
if (process.argv[1] && t.resolve(process.argv[1]) === n(import.meta.url)) {
  let e = process.argv[2]
  if (!e) (console.error(`Usage: node vN-validator.mjs <catalog-data-directory>`), (process.exitCode = 1))
  else
    try {
      ;(Nc(t.resolve(e)), console.log(`Catalog is compatible with frozen registry schema v4`))
    } catch (e) {
      ;(console.error(e instanceof Error ? e.message : e), (process.exitCode = 1))
    }
}
export { Ac as schemaVersion, Nc as validateCatalogDirectory, Mc as validateCatalogFile }
