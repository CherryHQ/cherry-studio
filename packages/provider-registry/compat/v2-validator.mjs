/* eslint-disable */
// AUTO-GENERATED compatibility contract. Never edit or replace this file.
import { readFileSync as e } from 'node:fs'
import t from 'node:path'
import { fileURLToPath as n } from 'node:url'
import 'semver'
Object.freeze({ status: `aborted` })
function r(e, t, n) {
  function r(n, r) {
    if (
      (n._zod || Object.defineProperty(n, `_zod`, { value: { def: r, constr: o, traits: new Set() }, enumerable: !1 }),
      n._zod.traits.has(e))
    )
      return
    n._zod.traits.add(e), t(n, r)
    let i = o.prototype,
      a = Object.keys(i)
    for (let e = 0; e < a.length; e++) {
      let t = a[e]
      t in n || (n[t] = i[t].bind(n))
    }
  }
  let i = n?.Parent ?? Object
  class a extends i {}
  Object.defineProperty(a, `name`, { value: e })
  function o(e) {
    var t
    let i = n?.Parent ? new a() : this
    r(i, e), (t = i._zod).deferred ?? (t.deferred = [])
    for (let e of i._zod.deferred) e()
    return i
  }
  return (
    Object.defineProperty(o, `init`, { value: r }),
    Object.defineProperty(o, Symbol.hasInstance, {
      value: (t) => (n?.Parent && t instanceof n.Parent ? !0 : t?._zod?.traits?.has(e))
    }),
    Object.defineProperty(o, `name`, { value: e }),
    o
  )
}
var i = class extends Error {
    constructor() {
      super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`)
    }
  },
  a = class extends Error {
    constructor(e) {
      super(`Encountered unidirectional transform during encode: ${e}`), (this.name = `ZodEncodeError`)
    }
  }
const o = {}
function s(e) {
  return e && Object.assign(o, e), o
}
function c(e) {
  let t = Object.values(e).filter((e) => typeof e == `number`)
  return Object.entries(e)
    .filter(([e, n]) => t.indexOf(+e) === -1)
    .map(([e, t]) => t)
}
function l(e, t) {
  return typeof t == `bigint` ? t.toString() : t
}
function u(e) {
  return {
    get value() {
      {
        let t = e()
        return Object.defineProperty(this, `value`, { value: t }), t
      }
      throw Error(`cached value already set`)
    }
  }
}
function ee(e) {
  return e == null
}
function d(e) {
  let t = e.startsWith(`^`) ? 1 : 0,
    n = e.endsWith(`$`) ? e.length - 1 : e.length
  return e.slice(t, n)
}
function f(e, t) {
  let n = (e.toString().split(`.`)[1] || ``).length,
    r = t.toString(),
    i = (r.split(`.`)[1] || ``).length
  if (i === 0 && /\d?e-\d?/.test(r)) {
    let e = r.match(/\d?e-(\d?)/)
    e?.[1] && (i = Number.parseInt(e[1]))
  }
  let a = n > i ? n : i
  return (Number.parseInt(e.toFixed(a).replace(`.`, ``)) % Number.parseInt(t.toFixed(a).replace(`.`, ``))) / 10 ** a
}
const te = Symbol(`evaluating`)
function p(e, t, n) {
  let r
  Object.defineProperty(e, t, {
    get() {
      if (r !== te) return r === void 0 && ((r = te), (r = n())), r
    },
    set(n) {
      Object.defineProperty(e, t, { value: n })
    },
    configurable: !0
  })
}
function m(e, t, n) {
  Object.defineProperty(e, t, { value: n, writable: !0, enumerable: !0, configurable: !0 })
}
function h(...e) {
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
function g(e) {
  return typeof e == `object` && !!e && !Array.isArray(e)
}
const ae = u(() => {
  if (typeof navigator < `u` && navigator?.userAgent?.includes(`Cloudflare`)) return !1
  try {
    return Function(``), !0
  } catch {
    return !1
  }
})
function _(e) {
  if (g(e) === !1) return !1
  let t = e.constructor
  if (t === void 0 || typeof t != `function`) return !0
  let n = t.prototype
  return !(g(n) === !1 || Object.prototype.hasOwnProperty.call(n, `isPrototypeOf`) === !1)
}
function oe(e) {
  return _(e) ? { ...e } : Array.isArray(e) ? [...e] : e
}
const se = new Set([`string`, `number`, `symbol`])
function v(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
}
function y(e, t, n) {
  let r = new e._zod.constr(t ?? e._zod.def)
  return (!t || n?.parent) && (r._zod.parent = e), r
}
function b(e) {
  let t = e
  if (!t) return {}
  if (typeof t == `string`) return { error: () => t }
  if (t?.message !== void 0) {
    if (t?.error !== void 0) throw Error('Cannot specify both `message` and `error` params')
    t.error = t.message
  }
  return delete t.message, typeof t.error == `string` ? { ...t, error: () => t.error } : t
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
  return y(
    e,
    h(e._zod.def, {
      get shape() {
        let e = {}
        for (let r in t) {
          if (!(r in n.shape)) throw Error(`Unrecognized key: "${r}"`)
          t[r] && (e[r] = n.shape[r])
        }
        return m(this, `shape`, e), e
      },
      checks: []
    })
  )
}
function de(e, t) {
  let n = e._zod.def,
    r = n.checks
  if (r && r.length > 0) throw Error(`.omit() cannot be used on object schemas containing refinements`)
  return y(
    e,
    h(e._zod.def, {
      get shape() {
        let r = { ...e._zod.def.shape }
        for (let e in t) {
          if (!(e in n.shape)) throw Error(`Unrecognized key: "${e}"`)
          t[e] && delete r[e]
        }
        return m(this, `shape`, r), r
      },
      checks: []
    })
  )
}
function fe(e, t) {
  if (!_(t)) throw Error(`Invalid input to extend: expected a plain object`)
  let n = e._zod.def.checks
  if (n && n.length > 0) {
    let n = e._zod.def.shape
    for (let e in t)
      if (Object.getOwnPropertyDescriptor(n, e) !== void 0)
        throw Error('Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.')
  }
  return y(
    e,
    h(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t }
        return m(this, `shape`, n), n
      }
    })
  )
}
function pe(e, t) {
  if (!_(t)) throw Error(`Invalid input to safeExtend: expected a plain object`)
  return y(
    e,
    h(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t }
        return m(this, `shape`, n), n
      }
    })
  )
}
function me(e, t) {
  return y(
    e,
    h(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t._zod.def.shape }
        return m(this, `shape`, n), n
      },
      get catchall() {
        return t._zod.def.catchall
      },
      checks: []
    })
  )
}
function he(e, t, n) {
  let r = t._zod.def.checks
  if (r && r.length > 0) throw Error(`.partial() cannot be used on object schemas containing refinements`)
  return y(
    t,
    h(t._zod.def, {
      get shape() {
        let r = t._zod.def.shape,
          i = { ...r }
        if (n)
          for (let t in n) {
            if (!(t in r)) throw Error(`Unrecognized key: "${t}"`)
            n[t] && (i[t] = e ? new e({ type: `optional`, innerType: r[t] }) : r[t])
          }
        else for (let t in r) i[t] = e ? new e({ type: `optional`, innerType: r[t] }) : r[t]
        return m(this, `shape`, i), i
      },
      checks: []
    })
  )
}
function ge(e, t, n) {
  return y(
    t,
    h(t._zod.def, {
      get shape() {
        let r = t._zod.def.shape,
          i = { ...r }
        if (n)
          for (let t in n) {
            if (!(t in i)) throw Error(`Unrecognized key: "${t}"`)
            n[t] && (i[t] = new e({ type: `nonoptional`, innerType: r[t] }))
          }
        else for (let t in r) i[t] = new e({ type: `nonoptional`, innerType: r[t] })
        return m(this, `shape`, i), i
      }
    })
  )
}
function x(e, t = 0) {
  if (e.aborted === !0) return !0
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0
  return !1
}
function S(e, t) {
  return t.map((t) => {
    var n
    return (n = t).path ?? (n.path = []), t.path.unshift(e), t
  })
}
function C(e) {
  return typeof e == `string` ? e : e?.message
}
function w(e, t, n) {
  let r = { ...e, path: e.path ?? [] }
  return (
    e.message ||
      (r.message =
        C(e.inst?._zod.def?.error?.(e)) ??
        C(t?.error?.(e)) ??
        C(n.customError?.(e)) ??
        C(n.localeError?.(e)) ??
        `Invalid input`),
    delete r.inst,
    delete r.continue,
    t?.reportInput || delete r.input,
    r
  )
}
function _e(e) {
  return Array.isArray(e) ? `array` : typeof e == `string` ? `string` : `unknown`
}
function T(...e) {
  let [t, n, r] = e
  return typeof t == `string` ? { message: t, code: `custom`, input: n, inst: r } : { ...t }
}
const ve = (e, t) => {
    ;(e.name = `$ZodError`),
      Object.defineProperty(e, `_zod`, { value: e._zod, enumerable: !1 }),
      Object.defineProperty(e, `issues`, { value: t, enumerable: !1 }),
      (e.message = JSON.stringify(t, l, 2)),
      Object.defineProperty(e, `toString`, { value: () => e.message, enumerable: !1 })
  },
  ye = r(`$ZodError`, ve),
  be = r(`$ZodError`, ve, { Parent: Error })
function xe(e, t = (e) => e.message) {
  let n = {},
    r = []
  for (let i of e.issues)
    i.path.length > 0 ? ((n[i.path[0]] = n[i.path[0]] || []), n[i.path[0]].push(t(i))) : r.push(t(i))
  return { formErrors: r, fieldErrors: n }
}
function Se(e, t = (e) => e.message) {
  let n = { _errors: [] },
    r = (e) => {
      for (let i of e.issues)
        if (i.code === `invalid_union` && i.errors.length) i.errors.map((e) => r({ issues: e }))
        else if (i.code === `invalid_key`) r({ issues: i.issues })
        else if (i.code === `invalid_element`) r({ issues: i.issues })
        else if (i.path.length === 0) n._errors.push(t(i))
        else {
          let e = n,
            r = 0
          for (; r < i.path.length; ) {
            let n = i.path[r]
            r === i.path.length - 1
              ? ((e[n] = e[n] || { _errors: [] }), e[n]._errors.push(t(i)))
              : (e[n] = e[n] || { _errors: [] }),
              (e = e[n]),
              r++
          }
        }
    }
  return r(e), n
}
const Ce = (e) => (t, n, r, a) => {
    let o = r ? Object.assign(r, { async: !1 }) : { async: !1 },
      c = t._zod.run({ value: n, issues: [] }, o)
    if (c instanceof Promise) throw new i()
    if (c.issues.length) {
      let t = new (a?.Err ?? e)(c.issues.map((e) => w(e, o, s())))
      throw (ie(t, a?.callee), t)
    }
    return c.value
  },
  we = (e) => async (t, n, r, i) => {
    let a = r ? Object.assign(r, { async: !0 }) : { async: !0 },
      o = t._zod.run({ value: n, issues: [] }, a)
    if ((o instanceof Promise && (o = await o), o.issues.length)) {
      let t = new (i?.Err ?? e)(o.issues.map((e) => w(e, a, s())))
      throw (ie(t, i?.callee), t)
    }
    return o.value
  },
  Te = (e) => (t, n, r) => {
    let a = r ? { ...r, async: !1 } : { async: !1 },
      o = t._zod.run({ value: n, issues: [] }, a)
    if (o instanceof Promise) throw new i()
    return o.issues.length
      ? { success: !1, error: new (e ?? ye)(o.issues.map((e) => w(e, a, s()))) }
      : { success: !0, data: o.value }
  },
  Ee = Te(be),
  De = (e) => async (t, n, r) => {
    let i = r ? Object.assign(r, { async: !0 }) : { async: !0 },
      a = t._zod.run({ value: n, issues: [] }, i)
    return (
      a instanceof Promise && (a = await a),
      a.issues.length
        ? { success: !1, error: new e(a.issues.map((e) => w(e, i, s()))) }
        : { success: !0, data: a.value }
    )
  },
  Oe = De(be),
  ke = (e) => (t, n, r) => {
    let i = r ? Object.assign(r, { direction: `backward` }) : { direction: `backward` }
    return Ce(e)(t, n, i)
  },
  Ae = (e) => (t, n, r) => Ce(e)(t, n, r),
  je = (e) => async (t, n, r) => {
    let i = r ? Object.assign(r, { direction: `backward` }) : { direction: `backward` }
    return we(e)(t, n, i)
  },
  Me = (e) => async (t, n, r) => we(e)(t, n, r),
  Ne = (e) => (t, n, r) => {
    let i = r ? Object.assign(r, { direction: `backward` }) : { direction: `backward` }
    return Te(e)(t, n, i)
  },
  Pe = (e) => (t, n, r) => Te(e)(t, n, r),
  Fe = (e) => async (t, n, r) => {
    let i = r ? Object.assign(r, { direction: `backward` }) : { direction: `backward` }
    return De(e)(t, n, i)
  },
  Ie = (e) => async (t, n, r) => De(e)(t, n, r),
  Le = /^[cC][^\s-]{8,}$/,
  Re = /^[0-9a-z]+$/,
  ze = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/,
  Be = /^[0-9a-vA-V]{20}$/,
  Ve = /^[A-Za-z0-9]{27}$/,
  He = /^[a-zA-Z0-9_-]{21}$/,
  Ue = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/,
  We = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  Ge = (e) =>
    e
      ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`)
      : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/,
  Ke = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/
function qe() {
  return RegExp(`^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`, `u`)
}
const Je =
    /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
  Ye =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/,
  Xe =
    /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/,
  Ze =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
  Qe = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/,
  $e = /^[A-Za-z0-9_-]*$/,
  et = /^\+[1-9]\d{6,14}$/,
  tt = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`,
  nt = RegExp(`^${tt}$`)
function rt(e) {
  let t = `(?:[01]\\d|2[0-3]):[0-5]\\d`
  return typeof e.precision == `number`
    ? e.precision === -1
      ? `${t}`
      : e.precision === 0
        ? `${t}:[0-5]\\d`
        : `${t}:[0-5]\\d\\.\\d{${e.precision}}`
    : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`
}
function it(e) {
  return RegExp(`^${rt(e)}$`)
}
function at(e) {
  let t = rt({ precision: e.precision }),
    n = [`Z`]
  e.local && n.push(``), e.offset && n.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`)
  let r = `${t}(?:${n.join(`|`)})`
  return RegExp(`^${tt}T(?:${r})$`)
}
const ot = (e) => {
    let t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ``}}` : `[\\s\\S]*`
    return RegExp(`^${t}$`)
  },
  st = /^-?\d+$/,
  ct = /^-?\d+(?:\.\d+)?$/,
  lt = /^(?:true|false)$/i,
  ut = /^[^A-Z]*$/,
  dt = /^[^a-z]*$/,
  E = r(`$ZodCheck`, (e, t) => {
    var n
    ;(e._zod ??= {}), (e._zod.def = t), (n = e._zod).onattach ?? (n.onattach = [])
  }),
  ft = { number: `number`, bigint: `bigint`, object: `date` },
  pt = r(`$ZodCheckLessThan`, (e, t) => {
    E.init(e, t)
    let n = ft[typeof t.value]
    e._zod.onattach.push((e) => {
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
      })
  }),
  mt = r(`$ZodCheckGreaterThan`, (e, t) => {
    E.init(e, t)
    let n = ft[typeof t.value]
    e._zod.onattach.push((e) => {
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
      })
  }),
  ht = r(`$ZodCheckMultipleOf`, (e, t) => {
    E.init(e, t),
      e._zod.onattach.push((e) => {
        var n
        ;(n = e._zod.bag).multipleOf ?? (n.multipleOf = t.value)
      }),
      (e._zod.check = (n) => {
        if (typeof n.value != typeof t.value) throw Error(`Cannot mix number and bigint in multiple_of check.`)
        ;(typeof n.value == `bigint` ? n.value % t.value === BigInt(0) : f(n.value, t.value) === 0) ||
          n.issues.push({
            origin: typeof n.value,
            code: `not_multiple_of`,
            divisor: t.value,
            input: n.value,
            inst: e,
            continue: !t.abort
          })
      })
  }),
  gt = r(`$ZodCheckNumberFormat`, (e, t) => {
    E.init(e, t), (t.format = t.format || `float64`)
    let n = t.format?.includes(`int`),
      r = n ? `int` : `number`,
      [i, a] = le[t.format]
    e._zod.onattach.push((e) => {
      let r = e._zod.bag
      ;(r.format = t.format), (r.minimum = i), (r.maximum = a), n && (r.pattern = st)
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
        s < i &&
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
            })
      })
  }),
  _t = r(`$ZodCheckMaxLength`, (e, t) => {
    var n
    E.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !ee(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag.maximum ?? 1 / 0
        t.maximum < n && (e._zod.bag.maximum = t.maximum)
      }),
      (e._zod.check = (n) => {
        let r = n.value
        if (r.length <= t.maximum) return
        let i = _e(r)
        n.issues.push({
          origin: i,
          code: `too_big`,
          maximum: t.maximum,
          inclusive: !0,
          input: r,
          inst: e,
          continue: !t.abort
        })
      })
  }),
  vt = r(`$ZodCheckMinLength`, (e, t) => {
    var n
    E.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !ee(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag.minimum ?? -1 / 0
        t.minimum > n && (e._zod.bag.minimum = t.minimum)
      }),
      (e._zod.check = (n) => {
        let r = n.value
        if (r.length >= t.minimum) return
        let i = _e(r)
        n.issues.push({
          origin: i,
          code: `too_small`,
          minimum: t.minimum,
          inclusive: !0,
          input: r,
          inst: e,
          continue: !t.abort
        })
      })
  }),
  yt = r(`$ZodCheckLengthEquals`, (e, t) => {
    var n
    E.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !ee(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag
        ;(n.minimum = t.length), (n.maximum = t.length), (n.length = t.length)
      }),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length
        if (i === t.length) return
        let a = _e(r),
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
      })
  }),
  bt = r(`$ZodCheckStringFormat`, (e, t) => {
    var n, r
    E.init(e, t),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag
        ;(n.format = t.format), t.pattern && ((n.patterns ??= new Set()), n.patterns.add(t.pattern))
      }),
      t.pattern
        ? ((n = e._zod).check ??
          (n.check = (n) => {
            ;(t.pattern.lastIndex = 0),
              !t.pattern.test(n.value) &&
                n.issues.push({
                  origin: `string`,
                  code: `invalid_format`,
                  format: t.format,
                  input: n.value,
                  ...(t.pattern ? { pattern: t.pattern.toString() } : {}),
                  inst: e,
                  continue: !t.abort
                })
          }))
        : ((r = e._zod).check ?? (r.check = () => {}))
  }),
  xt = r(`$ZodCheckRegex`, (e, t) => {
    bt.init(e, t),
      (e._zod.check = (n) => {
        ;(t.pattern.lastIndex = 0),
          !t.pattern.test(n.value) &&
            n.issues.push({
              origin: `string`,
              code: `invalid_format`,
              format: `regex`,
              input: n.value,
              pattern: t.pattern.toString(),
              inst: e,
              continue: !t.abort
            })
      })
  }),
  St = r(`$ZodCheckLowerCase`, (e, t) => {
    ;(t.pattern ??= ut), bt.init(e, t)
  }),
  Ct = r(`$ZodCheckUpperCase`, (e, t) => {
    ;(t.pattern ??= dt), bt.init(e, t)
  }),
  wt = r(`$ZodCheckIncludes`, (e, t) => {
    E.init(e, t)
    let n = v(t.includes),
      r = new RegExp(typeof t.position == `number` ? `^.{${t.position}}${n}` : n)
    ;(t.pattern = r),
      e._zod.onattach.push((e) => {
        let t = e._zod.bag
        ;(t.patterns ??= new Set()), t.patterns.add(r)
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
      })
  }),
  Tt = r(`$ZodCheckStartsWith`, (e, t) => {
    E.init(e, t)
    let n = RegExp(`^${v(t.prefix)}.*`)
    ;(t.pattern ??= n),
      e._zod.onattach.push((e) => {
        let t = e._zod.bag
        ;(t.patterns ??= new Set()), t.patterns.add(n)
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
      })
  }),
  Et = r(`$ZodCheckEndsWith`, (e, t) => {
    E.init(e, t)
    let n = RegExp(`.*${v(t.suffix)}$`)
    ;(t.pattern ??= n),
      e._zod.onattach.push((e) => {
        let t = e._zod.bag
        ;(t.patterns ??= new Set()), t.patterns.add(n)
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
      })
  }),
  Dt = r(`$ZodCheckOverwrite`, (e, t) => {
    E.init(e, t),
      (e._zod.check = (e) => {
        e.value = t.tx(e.value)
      })
  })
var Ot = class {
  constructor(e = []) {
    ;(this.content = []), (this.indent = 0), this && (this.args = e)
  }
  indented(e) {
    ;(this.indent += 1), e(this), --this.indent
  }
  write(e) {
    if (typeof e == `function`) {
      e(this, { execution: `sync` }), e(this, { execution: `async` })
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
const kt = { major: 4, minor: 3, patch: 6 },
  D = r(`$ZodType`, (e, t) => {
    var n
    ;(e ??= {}), (e._zod.def = t), (e._zod.bag = e._zod.bag || {}), (e._zod.version = kt)
    let r = [...(e._zod.def.checks ?? [])]
    e._zod.traits.has(`$ZodCheck`) && r.unshift(e)
    for (let t of r) for (let n of t._zod.onattach) n(e)
    if (r.length === 0)
      (n = e._zod).deferred ?? (n.deferred = []),
        e._zod.deferred?.push(() => {
          e._zod.run = e._zod.parse
        })
    else {
      let t = (e, t, n) => {
          let r = x(e),
            a
          for (let o of t) {
            if (o._zod.def.when) {
              if (!o._zod.def.when(e)) continue
            } else if (r) continue
            let t = e.issues.length,
              s = o._zod.check(e)
            if (s instanceof Promise && n?.async === !1) throw new i()
            if (a || s instanceof Promise)
              a = (a ?? Promise.resolve()).then(async () => {
                await s, e.issues.length !== t && (r ||= x(e, t))
              })
            else {
              if (e.issues.length === t) continue
              r ||= x(e, t)
            }
          }
          return a ? a.then(() => e) : e
        },
        n = (n, a, o) => {
          if (x(n)) return (n.aborted = !0), n
          let s = t(a, r, o)
          if (s instanceof Promise) {
            if (o.async === !1) throw new i()
            return s.then((t) => e._zod.parse(t, o))
          }
          return e._zod.parse(s, o)
        }
      e._zod.run = (a, o) => {
        if (o.skipChecks) return e._zod.parse(a, o)
        if (o.direction === `backward`) {
          let t = e._zod.parse({ value: a.value, issues: [] }, { ...o, skipChecks: !0 })
          return t instanceof Promise ? t.then((e) => n(e, a, o)) : n(t, a, o)
        }
        let s = e._zod.parse(a, o)
        if (s instanceof Promise) {
          if (o.async === !1) throw new i()
          return s.then((e) => t(e, r, o))
        }
        return t(s, r, o)
      }
    }
    p(e, `~standard`, () => ({
      validate: (t) => {
        try {
          let n = Ee(e, t)
          return n.success ? { value: n.data } : { issues: n.error?.issues }
        } catch {
          return Oe(e, t).then((e) => (e.success ? { value: e.data } : { issues: e.error?.issues }))
        }
      },
      vendor: `zod`,
      version: 1
    }))
  }),
  At = r(`$ZodString`, (e, t) => {
    D.init(e, t),
      (e._zod.pattern = [...(e?._zod.bag?.patterns ?? [])].pop() ?? ot(e._zod.bag)),
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
      })
  }),
  O = r(`$ZodStringFormat`, (e, t) => {
    bt.init(e, t), At.init(e, t)
  }),
  jt = r(`$ZodGUID`, (e, t) => {
    ;(t.pattern ??= We), O.init(e, t)
  }),
  Mt = r(`$ZodUUID`, (e, t) => {
    if (t.version) {
      let e = { v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7, v8: 8 }[t.version]
      if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`)
      t.pattern ??= Ge(e)
    } else t.pattern ??= Ge()
    O.init(e, t)
  }),
  Nt = r(`$ZodEmail`, (e, t) => {
    ;(t.pattern ??= Ke), O.init(e, t)
  }),
  Pt = r(`$ZodURL`, (e, t) => {
    O.init(e, t),
      (e._zod.check = (n) => {
        try {
          let r = n.value.trim(),
            i = new URL(r)
          t.hostname &&
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
            t.normalize ? (n.value = i.href) : (n.value = r)
          return
        } catch {
          n.issues.push({ code: `invalid_format`, format: `url`, input: n.value, inst: e, continue: !t.abort })
        }
      })
  }),
  Ft = r(`$ZodEmoji`, (e, t) => {
    ;(t.pattern ??= qe()), O.init(e, t)
  }),
  It = r(`$ZodNanoID`, (e, t) => {
    ;(t.pattern ??= He), O.init(e, t)
  }),
  Lt = r(`$ZodCUID`, (e, t) => {
    ;(t.pattern ??= Le), O.init(e, t)
  }),
  Rt = r(`$ZodCUID2`, (e, t) => {
    ;(t.pattern ??= Re), O.init(e, t)
  }),
  zt = r(`$ZodULID`, (e, t) => {
    ;(t.pattern ??= ze), O.init(e, t)
  }),
  Bt = r(`$ZodXID`, (e, t) => {
    ;(t.pattern ??= Be), O.init(e, t)
  }),
  Vt = r(`$ZodKSUID`, (e, t) => {
    ;(t.pattern ??= Ve), O.init(e, t)
  }),
  Ht = r(`$ZodISODateTime`, (e, t) => {
    ;(t.pattern ??= at(t)), O.init(e, t)
  }),
  Ut = r(`$ZodISODate`, (e, t) => {
    ;(t.pattern ??= nt), O.init(e, t)
  }),
  Wt = r(`$ZodISOTime`, (e, t) => {
    ;(t.pattern ??= it(t)), O.init(e, t)
  }),
  Gt = r(`$ZodISODuration`, (e, t) => {
    ;(t.pattern ??= Ue), O.init(e, t)
  }),
  Kt = r(`$ZodIPv4`, (e, t) => {
    ;(t.pattern ??= Je), O.init(e, t), (e._zod.bag.format = `ipv4`)
  }),
  qt = r(`$ZodIPv6`, (e, t) => {
    ;(t.pattern ??= Ye),
      O.init(e, t),
      (e._zod.bag.format = `ipv6`),
      (e._zod.check = (n) => {
        try {
          new URL(`http://[${n.value}]`)
        } catch {
          n.issues.push({ code: `invalid_format`, format: `ipv6`, input: n.value, inst: e, continue: !t.abort })
        }
      })
  }),
  Jt = r(`$ZodCIDRv4`, (e, t) => {
    ;(t.pattern ??= Xe), O.init(e, t)
  }),
  Yt = r(`$ZodCIDRv6`, (e, t) => {
    ;(t.pattern ??= Ze),
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
      })
  })
function Xt(e) {
  if (e === ``) return !0
  if (e.length % 4 != 0) return !1
  try {
    return atob(e), !0
  } catch {
    return !1
  }
}
const Zt = r(`$ZodBase64`, (e, t) => {
  ;(t.pattern ??= Qe),
    O.init(e, t),
    (e._zod.bag.contentEncoding = `base64`),
    (e._zod.check = (n) => {
      Xt(n.value) ||
        n.issues.push({ code: `invalid_format`, format: `base64`, input: n.value, inst: e, continue: !t.abort })
    })
})
function Qt(e) {
  if (!$e.test(e)) return !1
  let t = e.replace(/[-_]/g, (e) => (e === `-` ? `+` : `/`))
  return Xt(t.padEnd(Math.ceil(t.length / 4) * 4, `=`))
}
const $t = r(`$ZodBase64URL`, (e, t) => {
    ;(t.pattern ??= $e),
      O.init(e, t),
      (e._zod.bag.contentEncoding = `base64url`),
      (e._zod.check = (n) => {
        Qt(n.value) ||
          n.issues.push({ code: `invalid_format`, format: `base64url`, input: n.value, inst: e, continue: !t.abort })
      })
  }),
  en = r(`$ZodE164`, (e, t) => {
    ;(t.pattern ??= et), O.init(e, t)
  })
function tn(e, t = null) {
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
const nn = r(`$ZodJWT`, (e, t) => {
    O.init(e, t),
      (e._zod.check = (n) => {
        tn(n.value, t.alg) ||
          n.issues.push({ code: `invalid_format`, format: `jwt`, input: n.value, inst: e, continue: !t.abort })
      })
  }),
  rn = r(`$ZodNumber`, (e, t) => {
    D.init(e, t),
      (e._zod.pattern = e._zod.bag.pattern ?? ct),
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
      })
  }),
  an = r(`$ZodNumberFormat`, (e, t) => {
    gt.init(e, t), rn.init(e, t)
  }),
  on = r(`$ZodBoolean`, (e, t) => {
    D.init(e, t),
      (e._zod.pattern = lt),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = !!n.value
          } catch {}
        let i = n.value
        return (
          typeof i == `boolean` || n.issues.push({ expected: `boolean`, code: `invalid_type`, input: i, inst: e }), n
        )
      })
  }),
  sn = r(`$ZodUnknown`, (e, t) => {
    D.init(e, t), (e._zod.parse = (e) => e)
  }),
  cn = r(`$ZodNever`, (e, t) => {
    D.init(e, t),
      (e._zod.parse = (t, n) => (
        t.issues.push({ expected: `never`, code: `invalid_type`, input: t.value, inst: e }), t
      ))
  })
function ln(e, t, n) {
  e.issues.length && t.issues.push(...S(n, e.issues)), (t.value[n] = e.value)
}
const un = r(`$ZodArray`, (e, t) => {
  D.init(e, t),
    (e._zod.parse = (n, r) => {
      let i = n.value
      if (!Array.isArray(i)) return n.issues.push({ expected: `array`, code: `invalid_type`, input: i, inst: e }), n
      n.value = Array(i.length)
      let a = []
      for (let e = 0; e < i.length; e++) {
        let o = i[e],
          s = t.element._zod.run({ value: o, issues: [] }, r)
        s instanceof Promise ? a.push(s.then((t) => ln(t, n, e))) : ln(s, n, e)
      }
      return a.length ? Promise.all(a).then(() => n) : n
    })
})
function dn(e, t, n, r, i) {
  if (e.issues.length) {
    if (i && !(n in r)) return
    t.issues.push(...S(n, e.issues))
  }
  e.value === void 0 ? n in r && (t.value[n] = void 0) : (t.value[n] = e.value)
}
function fn(e) {
  let t = Object.keys(e.shape)
  for (let n of t)
    if (!e.shape?.[n]?._zod?.traits?.has(`$ZodType`))
      throw Error(`Invalid element at key "${n}": expected a Zod schema`)
  let n = ce(e.shape)
  return { ...e, keys: t, keySet: new Set(t), numKeys: t.length, optionalKeys: new Set(n) }
}
function pn(e, t, n, r, i, a) {
  let o = [],
    s = i.keySet,
    c = i.catchall._zod,
    l = c.def.type,
    u = c.optout === `optional`
  for (let i in t) {
    if (s.has(i)) continue
    if (l === `never`) {
      o.push(i)
      continue
    }
    let a = c.run({ value: t[i], issues: [] }, r)
    a instanceof Promise ? e.push(a.then((e) => dn(e, n, i, t, u))) : dn(a, n, i, t, u)
  }
  return (
    o.length && n.issues.push({ code: `unrecognized_keys`, keys: o, input: t, inst: a }),
    e.length ? Promise.all(e).then(() => n) : n
  )
}
const mn = r(`$ZodObject`, (e, t) => {
    if ((D.init(e, t), !Object.getOwnPropertyDescriptor(t, `shape`)?.get)) {
      let e = t.shape
      Object.defineProperty(t, `shape`, {
        get: () => {
          let n = { ...e }
          return Object.defineProperty(t, `shape`, { value: n }), n
        }
      })
    }
    let n = u(() => fn(t))
    p(e._zod, `propValues`, () => {
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
    let r = g,
      i = t.catchall,
      a
    e._zod.parse = (t, o) => {
      a ??= n.value
      let s = t.value
      if (!r(s)) return t.issues.push({ expected: `object`, code: `invalid_type`, input: s, inst: e }), t
      t.value = {}
      let c = [],
        l = a.shape
      for (let e of a.keys) {
        let n = l[e],
          r = n._zod.optout === `optional`,
          i = n._zod.run({ value: s[e], issues: [] }, o)
        i instanceof Promise ? c.push(i.then((n) => dn(n, t, e, s, r))) : dn(i, t, e, s, r)
      }
      return i ? pn(c, s, t, o, n.value, e) : c.length ? Promise.all(c).then(() => t) : t
    }
  }),
  hn = r(`$ZodObjectJIT`, (e, t) => {
    mn.init(e, t)
    let n = e._zod.parse,
      r = u(() => fn(t)),
      i = (e) => {
        let t = new Ot([`shape`, `payload`, `ctx`]),
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
            s = e[r]?._zod?.optout === `optional`
          t.write(`const ${n} = ${i(r)};`),
            s
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
              : t.write(`
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
        }
        t.write(`payload.value = newResult;`), t.write(`return payload;`)
        let s = t.compile()
        return (t, n) => s(e, t, n)
      },
      a,
      s = g,
      c = !o.jitless,
      l = c && ae.value,
      ee = t.catchall,
      d
    e._zod.parse = (o, u) => {
      d ??= r.value
      let f = o.value
      return s(f)
        ? c && l && u?.async === !1 && u.jitless !== !0
          ? ((a ||= i(t.shape)), (o = a(o, u)), ee ? pn([], f, o, u, d, e) : o)
          : n(o, u)
        : (o.issues.push({ expected: `object`, code: `invalid_type`, input: f, inst: e }), o)
    }
  })
function gn(e, t, n, r) {
  for (let n of e) if (n.issues.length === 0) return (t.value = n.value), t
  let i = e.filter((e) => !x(e))
  return i.length === 1
    ? ((t.value = i[0].value), i[0])
    : (t.issues.push({
        code: `invalid_union`,
        input: t.value,
        inst: n,
        errors: e.map((e) => e.issues.map((e) => w(e, r, s())))
      }),
      t)
}
const _n = r(`$ZodUnion`, (e, t) => {
    D.init(e, t),
      p(e._zod, `optin`, () => (t.options.some((e) => e._zod.optin === `optional`) ? `optional` : void 0)),
      p(e._zod, `optout`, () => (t.options.some((e) => e._zod.optout === `optional`) ? `optional` : void 0)),
      p(e._zod, `values`, () => {
        if (t.options.every((e) => e._zod.values)) return new Set(t.options.flatMap((e) => Array.from(e._zod.values)))
      }),
      p(e._zod, `pattern`, () => {
        if (t.options.every((e) => e._zod.pattern)) {
          let e = t.options.map((e) => e._zod.pattern)
          return RegExp(`^(${e.map((e) => d(e.source)).join(`|`)})$`)
        }
      })
    let n = t.options.length === 1,
      r = t.options[0]._zod.run
    e._zod.parse = (i, a) => {
      if (n) return r(i, a)
      let o = !1,
        s = []
      for (let e of t.options) {
        let t = e._zod.run({ value: i.value, issues: [] }, a)
        if (t instanceof Promise) s.push(t), (o = !0)
        else {
          if (t.issues.length === 0) return t
          s.push(t)
        }
      }
      return o ? Promise.all(s).then((t) => gn(t, i, e, a)) : gn(s, i, e, a)
    }
  }),
  vn = r(`$ZodDiscriminatedUnion`, (e, t) => {
    ;(t.inclusive = !1), _n.init(e, t)
    let n = e._zod.parse
    p(e._zod, `propValues`, () => {
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
    let r = u(() => {
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
      if (!g(o)) return i.issues.push({ code: `invalid_type`, expected: `object`, input: o, inst: e }), i
      let s = r.value.get(o?.[t.discriminator])
      return s
        ? s._zod.run(i, a)
        : t.unionFallback
          ? n(i, a)
          : (i.issues.push({
              code: `invalid_union`,
              errors: [],
              note: `No matching discriminator`,
              discriminator: t.discriminator,
              input: o,
              path: [t.discriminator],
              inst: e
            }),
            i)
    }
  }),
  yn = r(`$ZodIntersection`, (e, t) => {
    D.init(e, t),
      (e._zod.parse = (e, n) => {
        let r = e.value,
          i = t.left._zod.run({ value: r, issues: [] }, n),
          a = t.right._zod.run({ value: r, issues: [] }, n)
        return i instanceof Promise || a instanceof Promise
          ? Promise.all([i, a]).then(([t, n]) => xn(e, t, n))
          : xn(e, i, a)
      })
  })
function bn(e, t) {
  if (e === t || (e instanceof Date && t instanceof Date && +e == +t)) return { valid: !0, data: e }
  if (_(e) && _(t)) {
    let n = Object.keys(t),
      r = Object.keys(e).filter((e) => n.indexOf(e) !== -1),
      i = { ...e, ...t }
    for (let n of r) {
      let r = bn(e[n], t[n])
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
        o = bn(i, a)
      if (!o.valid) return { valid: !1, mergeErrorPath: [r, ...o.mergeErrorPath] }
      n.push(o.data)
    }
    return { valid: !0, data: n }
  }
  return { valid: !1, mergeErrorPath: [] }
}
function xn(e, t, n) {
  let r = new Map(),
    i
  for (let n of t.issues)
    if (n.code === `unrecognized_keys`) {
      i ??= n
      for (let e of n.keys) r.has(e) || r.set(e, {}), (r.get(e).l = !0)
    } else e.issues.push(n)
  for (let t of n.issues)
    if (t.code === `unrecognized_keys`) for (let e of t.keys) r.has(e) || r.set(e, {}), (r.get(e).r = !0)
    else e.issues.push(t)
  let a = [...r].filter(([, e]) => e.l && e.r).map(([e]) => e)
  if ((a.length && i && e.issues.push({ ...i, keys: a }), x(e))) return e
  let o = bn(t.value, n.value)
  if (!o.valid) throw Error(`Unmergable intersection. Error path: ${JSON.stringify(o.mergeErrorPath)}`)
  return (e.value = o.data), e
}
const Sn = r(`$ZodRecord`, (e, t) => {
    D.init(e, t),
      (e._zod.parse = (n, r) => {
        let i = n.value
        if (!_(i)) return n.issues.push({ expected: `record`, code: `invalid_type`, input: i, inst: e }), n
        let a = [],
          o = t.keyType._zod.values
        if (o) {
          n.value = {}
          let s = new Set()
          for (let e of o)
            if (typeof e == `string` || typeof e == `number` || typeof e == `symbol`) {
              s.add(typeof e == `number` ? e.toString() : e)
              let o = t.valueType._zod.run({ value: i[e], issues: [] }, r)
              o instanceof Promise
                ? a.push(
                    o.then((t) => {
                      t.issues.length && n.issues.push(...S(e, t.issues)), (n.value[e] = t.value)
                    })
                  )
                : (o.issues.length && n.issues.push(...S(e, o.issues)), (n.value[e] = o.value))
            }
          let c
          for (let e in i) s.has(e) || ((c ??= []), c.push(e))
          c && c.length > 0 && n.issues.push({ code: `unrecognized_keys`, input: i, inst: e, keys: c })
        } else {
          n.value = {}
          for (let o of Reflect.ownKeys(i)) {
            if (o === `__proto__`) continue
            let c = t.keyType._zod.run({ value: o, issues: [] }, r)
            if (c instanceof Promise) throw Error(`Async schemas not supported in object keys currently`)
            if (typeof o == `string` && ct.test(o) && c.issues.length) {
              let e = t.keyType._zod.run({ value: Number(o), issues: [] }, r)
              if (e instanceof Promise) throw Error(`Async schemas not supported in object keys currently`)
              e.issues.length === 0 && (c = e)
            }
            if (c.issues.length) {
              t.mode === `loose`
                ? (n.value[o] = i[o])
                : n.issues.push({
                    code: `invalid_key`,
                    origin: `record`,
                    issues: c.issues.map((e) => w(e, r, s())),
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
                    e.issues.length && n.issues.push(...S(o, e.issues)), (n.value[c.value] = e.value)
                  })
                )
              : (l.issues.length && n.issues.push(...S(o, l.issues)), (n.value[c.value] = l.value))
          }
        }
        return a.length ? Promise.all(a).then(() => n) : n
      })
  }),
  Cn = r(`$ZodEnum`, (e, t) => {
    D.init(e, t)
    let n = c(t.entries),
      r = new Set(n)
    ;(e._zod.values = r),
      (e._zod.pattern = RegExp(
        `^(${n
          .filter((e) => se.has(typeof e))
          .map((e) => (typeof e == `string` ? v(e) : e.toString()))
          .join(`|`)})$`
      )),
      (e._zod.parse = (t, i) => {
        let a = t.value
        return r.has(a) || t.issues.push({ code: `invalid_value`, values: n, input: a, inst: e }), t
      })
  }),
  wn = r(`$ZodLiteral`, (e, t) => {
    if ((D.init(e, t), t.values.length === 0)) throw Error(`Cannot create literal schema with no valid values`)
    let n = new Set(t.values)
    ;(e._zod.values = n),
      (e._zod.pattern = RegExp(
        `^(${t.values.map((e) => (typeof e == `string` ? v(e) : e ? v(e.toString()) : String(e))).join(`|`)})$`
      )),
      (e._zod.parse = (r, i) => {
        let a = r.value
        return n.has(a) || r.issues.push({ code: `invalid_value`, values: t.values, input: a, inst: e }), r
      })
  }),
  Tn = r(`$ZodTransform`, (e, t) => {
    D.init(e, t),
      (e._zod.parse = (n, r) => {
        if (r.direction === `backward`) throw new a(e.constructor.name)
        let o = t.transform(n.value, n)
        if (r.async) return (o instanceof Promise ? o : Promise.resolve(o)).then((e) => ((n.value = e), n))
        if (o instanceof Promise) throw new i()
        return (n.value = o), n
      })
  })
function En(e, t) {
  return e.issues.length && t === void 0 ? { issues: [], value: void 0 } : e
}
const Dn = r(`$ZodOptional`, (e, t) => {
    D.init(e, t),
      (e._zod.optin = `optional`),
      (e._zod.optout = `optional`),
      p(e._zod, `values`, () => (t.innerType._zod.values ? new Set([...t.innerType._zod.values, void 0]) : void 0)),
      p(e._zod, `pattern`, () => {
        let e = t.innerType._zod.pattern
        return e ? RegExp(`^(${d(e.source)})?$`) : void 0
      }),
      (e._zod.parse = (e, n) => {
        if (t.innerType._zod.optin === `optional`) {
          let r = t.innerType._zod.run(e, n)
          return r instanceof Promise ? r.then((t) => En(t, e.value)) : En(r, e.value)
        }
        return e.value === void 0 ? e : t.innerType._zod.run(e, n)
      })
  }),
  On = r(`$ZodExactOptional`, (e, t) => {
    Dn.init(e, t),
      p(e._zod, `values`, () => t.innerType._zod.values),
      p(e._zod, `pattern`, () => t.innerType._zod.pattern),
      (e._zod.parse = (e, n) => t.innerType._zod.run(e, n))
  }),
  kn = r(`$ZodNullable`, (e, t) => {
    D.init(e, t),
      p(e._zod, `optin`, () => t.innerType._zod.optin),
      p(e._zod, `optout`, () => t.innerType._zod.optout),
      p(e._zod, `pattern`, () => {
        let e = t.innerType._zod.pattern
        return e ? RegExp(`^(${d(e.source)}|null)$`) : void 0
      }),
      p(e._zod, `values`, () => (t.innerType._zod.values ? new Set([...t.innerType._zod.values, null]) : void 0)),
      (e._zod.parse = (e, n) => (e.value === null ? e : t.innerType._zod.run(e, n)))
  }),
  An = r(`$ZodDefault`, (e, t) => {
    D.init(e, t),
      (e._zod.optin = `optional`),
      p(e._zod, `values`, () => t.innerType._zod.values),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n)
        if (e.value === void 0) return (e.value = t.defaultValue), e
        let r = t.innerType._zod.run(e, n)
        return r instanceof Promise ? r.then((e) => jn(e, t)) : jn(r, t)
      })
  })
function jn(e, t) {
  return e.value === void 0 && (e.value = t.defaultValue), e
}
const Mn = r(`$ZodPrefault`, (e, t) => {
    D.init(e, t),
      (e._zod.optin = `optional`),
      p(e._zod, `values`, () => t.innerType._zod.values),
      (e._zod.parse = (e, n) => (
        n.direction === `backward` || (e.value === void 0 && (e.value = t.defaultValue)), t.innerType._zod.run(e, n)
      ))
  }),
  Nn = r(`$ZodNonOptional`, (e, t) => {
    D.init(e, t),
      p(e._zod, `values`, () => {
        let e = t.innerType._zod.values
        return e ? new Set([...e].filter((e) => e !== void 0)) : void 0
      }),
      (e._zod.parse = (n, r) => {
        let i = t.innerType._zod.run(n, r)
        return i instanceof Promise ? i.then((t) => Pn(t, e)) : Pn(i, e)
      })
  })
function Pn(e, t) {
  return (
    !e.issues.length &&
      e.value === void 0 &&
      e.issues.push({ code: `invalid_type`, expected: `nonoptional`, input: e.value, inst: t }),
    e
  )
}
const Fn = r(`$ZodCatch`, (e, t) => {
    D.init(e, t),
      p(e._zod, `optin`, () => t.innerType._zod.optin),
      p(e._zod, `optout`, () => t.innerType._zod.optout),
      p(e._zod, `values`, () => t.innerType._zod.values),
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
                    error: { issues: r.issues.map((e) => w(e, n, s())) },
                    input: e.value
                  })),
                  (e.issues = [])),
                e
              )
            )
          : ((e.value = r.value),
            r.issues.length &&
              ((e.value = t.catchValue({ ...e, error: { issues: r.issues.map((e) => w(e, n, s())) }, input: e.value })),
              (e.issues = [])),
            e)
      })
  }),
  In = r(`$ZodPipe`, (e, t) => {
    D.init(e, t),
      p(e._zod, `values`, () => t.in._zod.values),
      p(e._zod, `optin`, () => t.in._zod.optin),
      p(e._zod, `optout`, () => t.out._zod.optout),
      p(e._zod, `propValues`, () => t.in._zod.propValues),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) {
          let r = t.out._zod.run(e, n)
          return r instanceof Promise ? r.then((e) => Ln(e, t.in, n)) : Ln(r, t.in, n)
        }
        let r = t.in._zod.run(e, n)
        return r instanceof Promise ? r.then((e) => Ln(e, t.out, n)) : Ln(r, t.out, n)
      })
  })
function Ln(e, t, n) {
  return e.issues.length ? ((e.aborted = !0), e) : t._zod.run({ value: e.value, issues: e.issues }, n)
}
const Rn = r(`$ZodReadonly`, (e, t) => {
  D.init(e, t),
    p(e._zod, `propValues`, () => t.innerType._zod.propValues),
    p(e._zod, `values`, () => t.innerType._zod.values),
    p(e._zod, `optin`, () => t.innerType?._zod?.optin),
    p(e._zod, `optout`, () => t.innerType?._zod?.optout),
    (e._zod.parse = (e, n) => {
      if (n.direction === `backward`) return t.innerType._zod.run(e, n)
      let r = t.innerType._zod.run(e, n)
      return r instanceof Promise ? r.then(zn) : zn(r)
    })
})
function zn(e) {
  return (e.value = Object.freeze(e.value)), e
}
const Bn = r(`$ZodCustom`, (e, t) => {
  E.init(e, t),
    D.init(e, t),
    (e._zod.parse = (e, t) => e),
    (e._zod.check = (n) => {
      let r = n.value,
        i = t.fn(r)
      if (i instanceof Promise) return i.then((t) => Vn(t, n, r, e))
      Vn(i, n, r, e)
    })
})
function Vn(e, t, n, r) {
  if (!e) {
    let e = { code: `custom`, input: n, inst: r, path: [...(r._zod.def.path ?? [])], continue: !r._zod.def.abort }
    r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(T(e))
  }
}
var Hn,
  Un = class {
    constructor() {
      ;(this._map = new WeakMap()), (this._idmap = new Map())
    }
    add(e, ...t) {
      let n = t[0]
      return this._map.set(e, n), n && typeof n == `object` && `id` in n && this._idmap.set(n.id, e), this
    }
    clear() {
      return (this._map = new WeakMap()), (this._idmap = new Map()), this
    }
    remove(e) {
      let t = this._map.get(e)
      return t && typeof t == `object` && `id` in t && this._idmap.delete(t.id), this._map.delete(e), this
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
function Wn() {
  return new Un()
}
;(Hn = globalThis).__zod_globalRegistry ?? (Hn.__zod_globalRegistry = Wn())
const k = globalThis.__zod_globalRegistry
function Gn(e, t) {
  return new e({ type: `string`, ...b(t) })
}
function Kn(e, t) {
  return new e({ type: `string`, format: `email`, check: `string_format`, abort: !1, ...b(t) })
}
function qn(e, t) {
  return new e({ type: `string`, format: `guid`, check: `string_format`, abort: !1, ...b(t) })
}
function Jn(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, ...b(t) })
}
function Yn(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v4`, ...b(t) })
}
function Xn(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v6`, ...b(t) })
}
function Zn(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v7`, ...b(t) })
}
function Qn(e, t) {
  return new e({ type: `string`, format: `url`, check: `string_format`, abort: !1, ...b(t) })
}
function $n(e, t) {
  return new e({ type: `string`, format: `emoji`, check: `string_format`, abort: !1, ...b(t) })
}
function er(e, t) {
  return new e({ type: `string`, format: `nanoid`, check: `string_format`, abort: !1, ...b(t) })
}
function tr(e, t) {
  return new e({ type: `string`, format: `cuid`, check: `string_format`, abort: !1, ...b(t) })
}
function nr(e, t) {
  return new e({ type: `string`, format: `cuid2`, check: `string_format`, abort: !1, ...b(t) })
}
function rr(e, t) {
  return new e({ type: `string`, format: `ulid`, check: `string_format`, abort: !1, ...b(t) })
}
function ir(e, t) {
  return new e({ type: `string`, format: `xid`, check: `string_format`, abort: !1, ...b(t) })
}
function ar(e, t) {
  return new e({ type: `string`, format: `ksuid`, check: `string_format`, abort: !1, ...b(t) })
}
function or(e, t) {
  return new e({ type: `string`, format: `ipv4`, check: `string_format`, abort: !1, ...b(t) })
}
function sr(e, t) {
  return new e({ type: `string`, format: `ipv6`, check: `string_format`, abort: !1, ...b(t) })
}
function cr(e, t) {
  return new e({ type: `string`, format: `cidrv4`, check: `string_format`, abort: !1, ...b(t) })
}
function lr(e, t) {
  return new e({ type: `string`, format: `cidrv6`, check: `string_format`, abort: !1, ...b(t) })
}
function ur(e, t) {
  return new e({ type: `string`, format: `base64`, check: `string_format`, abort: !1, ...b(t) })
}
function dr(e, t) {
  return new e({ type: `string`, format: `base64url`, check: `string_format`, abort: !1, ...b(t) })
}
function fr(e, t) {
  return new e({ type: `string`, format: `e164`, check: `string_format`, abort: !1, ...b(t) })
}
function pr(e, t) {
  return new e({ type: `string`, format: `jwt`, check: `string_format`, abort: !1, ...b(t) })
}
function mr(e, t) {
  return new e({
    type: `string`,
    format: `datetime`,
    check: `string_format`,
    offset: !1,
    local: !1,
    precision: null,
    ...b(t)
  })
}
function hr(e, t) {
  return new e({ type: `string`, format: `date`, check: `string_format`, ...b(t) })
}
function gr(e, t) {
  return new e({ type: `string`, format: `time`, check: `string_format`, precision: null, ...b(t) })
}
function _r(e, t) {
  return new e({ type: `string`, format: `duration`, check: `string_format`, ...b(t) })
}
function vr(e, t) {
  return new e({ type: `number`, checks: [], ...b(t) })
}
function yr(e, t) {
  return new e({ type: `number`, check: `number_format`, abort: !1, format: `safeint`, ...b(t) })
}
function br(e, t) {
  return new e({ type: `boolean`, ...b(t) })
}
function xr(e) {
  return new e({ type: `unknown` })
}
function Sr(e, t) {
  return new e({ type: `never`, ...b(t) })
}
function Cr(e, t) {
  return new pt({ check: `less_than`, ...b(t), value: e, inclusive: !1 })
}
function wr(e, t) {
  return new pt({ check: `less_than`, ...b(t), value: e, inclusive: !0 })
}
function Tr(e, t) {
  return new mt({ check: `greater_than`, ...b(t), value: e, inclusive: !1 })
}
function Er(e, t) {
  return new mt({ check: `greater_than`, ...b(t), value: e, inclusive: !0 })
}
function Dr(e, t) {
  return new ht({ check: `multiple_of`, ...b(t), value: e })
}
function Or(e, t) {
  return new _t({ check: `max_length`, ...b(t), maximum: e })
}
function A(e, t) {
  return new vt({ check: `min_length`, ...b(t), minimum: e })
}
function kr(e, t) {
  return new yt({ check: `length_equals`, ...b(t), length: e })
}
function Ar(e, t) {
  return new xt({ check: `string_format`, format: `regex`, ...b(t), pattern: e })
}
function jr(e) {
  return new St({ check: `string_format`, format: `lowercase`, ...b(e) })
}
function Mr(e) {
  return new Ct({ check: `string_format`, format: `uppercase`, ...b(e) })
}
function Nr(e, t) {
  return new wt({ check: `string_format`, format: `includes`, ...b(t), includes: e })
}
function Pr(e, t) {
  return new Tt({ check: `string_format`, format: `starts_with`, ...b(t), prefix: e })
}
function Fr(e, t) {
  return new Et({ check: `string_format`, format: `ends_with`, ...b(t), suffix: e })
}
function j(e) {
  return new Dt({ check: `overwrite`, tx: e })
}
function Ir(e) {
  return j((t) => t.normalize(e))
}
function Lr() {
  return j((e) => e.trim())
}
function Rr() {
  return j((e) => e.toLowerCase())
}
function zr() {
  return j((e) => e.toUpperCase())
}
function Br() {
  return j((e) => re(e))
}
function Vr(e, t, n) {
  return new e({ type: `array`, element: t, ...b(n) })
}
function Hr(e, t, n) {
  return new e({ type: `custom`, check: `custom`, fn: t, ...b(n) })
}
function Ur(e) {
  let t = Wr(
    (n) => (
      (n.addIssue = (e) => {
        if (typeof e == `string`) n.issues.push(T(e, n.value, t._zod.def))
        else {
          let r = e
          r.fatal && (r.continue = !1),
            (r.code ??= `custom`),
            (r.input ??= n.value),
            (r.inst ??= t),
            (r.continue ??= !t._zod.def.abort),
            n.issues.push(T(r))
        }
      }),
      e(n.value, n)
    )
  )
  return t
}
function Wr(e, t) {
  let n = new E({ check: `custom`, ...b(t) })
  return (n._zod.check = e), n
}
function Gr(e) {
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
function M(e, t, n = { path: [], schemaPath: [] }) {
  var r
  let i = e._zod.def,
    a = t.seen.get(e)
  if (a) return a.count++, n.schemaPath.includes(e) && (a.cycle = n.path), a.schema
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
    a && ((o.ref ||= a), M(a, t, r), (t.seen.get(a).isParent = !0))
  }
  let c = t.metadataRegistry.get(e)
  return (
    c && Object.assign(o.schema, c),
    t.io === `input` && N(e) && (delete o.schema.examples, delete o.schema.default),
    t.io === `input` && o.schema._prefault && ((r = o.schema).default ?? (r.default = o.schema._prefault)),
    delete o.schema._prefault,
    t.seen.get(e).schema
  )
}
function Kr(e, t) {
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
        return (t[1].defId = a), { defId: a, ref: `${i(`__shared`)}#/${r}/${a}` }
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
      ;(t.def = { ...t.schema }), r && (t.defId = r)
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
function qr(e, t) {
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
        for (let e in i) e === `$ref` || e === `allOf` || e in a || delete i[e]
      if (s.$ref && n.def)
        for (let e in i)
          e === `$ref` ||
            e === `allOf` ||
            (e in n.def && JSON.stringify(i[e]) === JSON.stringify(n.def[e]) && delete i[e])
    }
    let s = t._zod.parent
    if (s && s !== o) {
      r(s)
      let t = e.seen.get(s)
      if (t?.schema.$ref && ((i.$ref = t.schema.$ref), t.def))
        for (let e in i)
          e === `$ref` ||
            e === `allOf` ||
            (e in t.def && JSON.stringify(i[e]) === JSON.stringify(t.def[e]) && delete i[e])
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
  let a = e.external?.defs ?? {}
  for (let t of e.seen.entries()) {
    let e = t[1]
    e.def && e.defId && (a[e.defId] = e.def)
  }
  e.external || (Object.keys(a).length > 0 && (e.target === `draft-2020-12` ? (i.$defs = a) : (i.definitions = a)))
  try {
    let n = JSON.parse(JSON.stringify(i))
    return (
      Object.defineProperty(n, `~standard`, {
        value: {
          ...t[`~standard`],
          jsonSchema: { input: Yr(t, `input`, e.processors), output: Yr(t, `output`, e.processors) }
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
function N(e, t) {
  let n = t ?? { seen: new Set() }
  if (n.seen.has(e)) return !1
  n.seen.add(e)
  let r = e._zod.def
  if (r.type === `transform`) return !0
  if (r.type === `array`) return N(r.element, n)
  if (r.type === `set`) return N(r.valueType, n)
  if (r.type === `lazy`) return N(r.getter(), n)
  if (
    r.type === `promise` ||
    r.type === `optional` ||
    r.type === `nonoptional` ||
    r.type === `nullable` ||
    r.type === `readonly` ||
    r.type === `default` ||
    r.type === `prefault`
  )
    return N(r.innerType, n)
  if (r.type === `intersection`) return N(r.left, n) || N(r.right, n)
  if (r.type === `record` || r.type === `map`) return N(r.keyType, n) || N(r.valueType, n)
  if (r.type === `pipe`) return N(r.in, n) || N(r.out, n)
  if (r.type === `object`) {
    for (let e in r.shape) if (N(r.shape[e], n)) return !0
    return !1
  }
  if (r.type === `union`) {
    for (let e of r.options) if (N(e, n)) return !0
    return !1
  }
  if (r.type === `tuple`) {
    for (let e of r.items) if (N(e, n)) return !0
    return !!(r.rest && N(r.rest, n))
  }
  return !1
}
const Jr =
    (e, t = {}) =>
    (n) => {
      let r = Gr({ ...n, processors: t })
      return M(e, r), Kr(r, e), qr(r, e)
    },
  Yr =
    (e, t, n = {}) =>
    (r) => {
      let { libraryOptions: i, target: a } = r ?? {},
        o = Gr({ ...(i ?? {}), target: a, io: t, processors: n })
      return M(e, o), Kr(o, e), qr(o, e)
    },
  Xr = { guid: `uuid`, url: `uri`, datetime: `date-time`, json_string: `json-string`, regex: `` },
  Zr = (e, t, n, r) => {
    let i = n
    i.type = `string`
    let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l } = e._zod.bag
    if (
      (typeof a == `number` && (i.minLength = a),
      typeof o == `number` && (i.maxLength = o),
      s && ((i.format = Xr[s] ?? s), i.format === `` && delete i.format, s === `time` && delete i.format),
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
  Qr = (e, t, n, r) => {
    let i = n,
      { minimum: a, maximum: o, format: s, multipleOf: c, exclusiveMaximum: l, exclusiveMinimum: u } = e._zod.bag
    typeof s == `string` && s.includes(`int`) ? (i.type = `integer`) : (i.type = `number`),
      typeof u == `number` &&
        (t.target === `draft-04` || t.target === `openapi-3.0`
          ? ((i.minimum = u), (i.exclusiveMinimum = !0))
          : (i.exclusiveMinimum = u)),
      typeof a == `number` &&
        ((i.minimum = a),
        typeof u == `number` && t.target !== `draft-04` && (u >= a ? delete i.minimum : delete i.exclusiveMinimum)),
      typeof l == `number` &&
        (t.target === `draft-04` || t.target === `openapi-3.0`
          ? ((i.maximum = l), (i.exclusiveMaximum = !0))
          : (i.exclusiveMaximum = l)),
      typeof o == `number` &&
        ((i.maximum = o),
        typeof l == `number` && t.target !== `draft-04` && (l <= o ? delete i.maximum : delete i.exclusiveMaximum)),
      typeof c == `number` && (i.multipleOf = c)
  },
  $r = (e, t, n, r) => {
    n.type = `boolean`
  },
  ei = (e, t, n, r) => {
    n.not = {}
  },
  ti = (e, t, n, r) => {
    let i = e._zod.def,
      a = c(i.entries)
    a.every((e) => typeof e == `number`) && (n.type = `number`),
      a.every((e) => typeof e == `string`) && (n.type = `string`),
      (n.enum = a)
  },
  ni = (e, t, n, r) => {
    let i = e._zod.def,
      a = []
    for (let e of i.values)
      if (e === void 0) {
        if (t.unrepresentable === `throw`) throw Error('Literal `undefined` cannot be represented in JSON Schema')
      } else if (typeof e == `bigint`) {
        if (t.unrepresentable === `throw`) throw Error(`BigInt literals cannot be represented in JSON Schema`)
        a.push(Number(e))
      } else a.push(e)
    if (a.length !== 0)
      if (a.length === 1) {
        let e = a[0]
        ;(n.type = e === null ? `null` : typeof e),
          t.target === `draft-04` || t.target === `openapi-3.0` ? (n.enum = [e]) : (n.const = e)
      } else
        a.every((e) => typeof e == `number`) && (n.type = `number`),
          a.every((e) => typeof e == `string`) && (n.type = `string`),
          a.every((e) => typeof e == `boolean`) && (n.type = `boolean`),
          a.every((e) => e === null) && (n.type = `null`),
          (n.enum = a)
  },
  ri = (e, t, n, r) => {
    if (t.unrepresentable === `throw`) throw Error(`Custom types cannot be represented in JSON Schema`)
  },
  ii = (e, t, n, r) => {
    if (t.unrepresentable === `throw`) throw Error(`Transforms cannot be represented in JSON Schema`)
  },
  ai = (e, t, n, r) => {
    let i = n,
      a = e._zod.def,
      { minimum: o, maximum: s } = e._zod.bag
    typeof o == `number` && (i.minItems = o),
      typeof s == `number` && (i.maxItems = s),
      (i.type = `array`),
      (i.items = M(a.element, t, { ...r, path: [...r.path, `items`] }))
  },
  oi = (e, t, n, r) => {
    let i = n,
      a = e._zod.def
    ;(i.type = `object`), (i.properties = {})
    let o = a.shape
    for (let e in o) i.properties[e] = M(o[e], t, { ...r, path: [...r.path, `properties`, e] })
    let s = new Set(Object.keys(o)),
      c = new Set(
        [...s].filter((e) => {
          let n = a.shape[e]._zod
          return t.io === `input` ? n.optin === void 0 : n.optout === void 0
        })
      )
    c.size > 0 && (i.required = Array.from(c)),
      a.catchall?._zod.def.type === `never`
        ? (i.additionalProperties = !1)
        : a.catchall
          ? a.catchall &&
            (i.additionalProperties = M(a.catchall, t, { ...r, path: [...r.path, `additionalProperties`] }))
          : t.io === `output` && (i.additionalProperties = !1)
  },
  si = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.inclusive === !1,
      o = i.options.map((e, n) => M(e, t, { ...r, path: [...r.path, a ? `oneOf` : `anyOf`, n] }))
    a ? (n.oneOf = o) : (n.anyOf = o)
  },
  ci = (e, t, n, r) => {
    let i = e._zod.def,
      a = M(i.left, t, { ...r, path: [...r.path, `allOf`, 0] }),
      o = M(i.right, t, { ...r, path: [...r.path, `allOf`, 1] }),
      s = (e) => `allOf` in e && Object.keys(e).length === 1
    n.allOf = [...(s(a) ? a.allOf : [a]), ...(s(o) ? o.allOf : [o])]
  },
  li = (e, t, n, r) => {
    let i = n,
      a = e._zod.def
    i.type = `object`
    let o = a.keyType,
      s = o._zod.bag?.patterns
    if (a.mode === `loose` && s && s.size > 0) {
      let e = M(a.valueType, t, { ...r, path: [...r.path, `patternProperties`, `*`] })
      i.patternProperties = {}
      for (let t of s) i.patternProperties[t.source] = e
    } else
      (t.target === `draft-07` || t.target === `draft-2020-12`) &&
        (i.propertyNames = M(a.keyType, t, { ...r, path: [...r.path, `propertyNames`] })),
        (i.additionalProperties = M(a.valueType, t, { ...r, path: [...r.path, `additionalProperties`] }))
    let c = o._zod.values
    if (c) {
      let e = [...c].filter((e) => typeof e == `string` || typeof e == `number`)
      e.length > 0 && (i.required = e)
    }
  },
  ui = (e, t, n, r) => {
    let i = e._zod.def,
      a = M(i.innerType, t, r),
      o = t.seen.get(e)
    t.target === `openapi-3.0` ? ((o.ref = i.innerType), (n.nullable = !0)) : (n.anyOf = [a, { type: `null` }])
  },
  di = (e, t, n, r) => {
    let i = e._zod.def
    M(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
  },
  fi = (e, t, n, r) => {
    let i = e._zod.def
    M(i.innerType, t, r)
    let a = t.seen.get(e)
    ;(a.ref = i.innerType), (n.default = JSON.parse(JSON.stringify(i.defaultValue)))
  },
  pi = (e, t, n, r) => {
    let i = e._zod.def
    M(i.innerType, t, r)
    let a = t.seen.get(e)
    ;(a.ref = i.innerType), t.io === `input` && (n._prefault = JSON.parse(JSON.stringify(i.defaultValue)))
  },
  mi = (e, t, n, r) => {
    let i = e._zod.def
    M(i.innerType, t, r)
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
  hi = (e, t, n, r) => {
    let i = e._zod.def,
      a = t.io === `input` ? (i.in._zod.def.type === `transform` ? i.out : i.in) : i.out
    M(a, t, r)
    let o = t.seen.get(e)
    o.ref = a
  },
  gi = (e, t, n, r) => {
    let i = e._zod.def
    M(i.innerType, t, r)
    let a = t.seen.get(e)
    ;(a.ref = i.innerType), (n.readOnly = !0)
  },
  _i = (e, t, n, r) => {
    let i = e._zod.def
    M(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
  },
  vi = r(`ZodISODateTime`, (e, t) => {
    Ht.init(e, t), L.init(e, t)
  })
function yi(e) {
  return mr(vi, e)
}
const bi = r(`ZodISODate`, (e, t) => {
  Ut.init(e, t), L.init(e, t)
})
function xi(e) {
  return hr(bi, e)
}
const Si = r(`ZodISOTime`, (e, t) => {
  Wt.init(e, t), L.init(e, t)
})
function Ci(e) {
  return gr(Si, e)
}
const wi = r(`ZodISODuration`, (e, t) => {
  Gt.init(e, t), L.init(e, t)
})
function Ti(e) {
  return _r(wi, e)
}
const Ei = (e, t) => {
  ye.init(e, t),
    (e.name = `ZodError`),
    Object.defineProperties(e, {
      format: { value: (t) => Se(e, t) },
      flatten: { value: (t) => xe(e, t) },
      addIssue: {
        value: (t) => {
          e.issues.push(t), (e.message = JSON.stringify(e.issues, l, 2))
        }
      },
      addIssues: {
        value: (t) => {
          e.issues.push(...t), (e.message = JSON.stringify(e.issues, l, 2))
        }
      },
      isEmpty: {
        get() {
          return e.issues.length === 0
        }
      }
    })
}
r(`ZodError`, Ei)
const P = r(`ZodError`, Ei, { Parent: Error }),
  Di = Ce(P),
  Oi = we(P),
  ki = Te(P),
  Ai = De(P),
  ji = ke(P),
  Mi = Ae(P),
  Ni = je(P),
  Pi = Me(P),
  Fi = Ne(P),
  Ii = Pe(P),
  Li = Fe(P),
  Ri = Ie(P),
  F = r(
    `ZodType`,
    (e, t) => (
      D.init(e, t),
      Object.assign(e[`~standard`], { jsonSchema: { input: Yr(e, `input`), output: Yr(e, `output`) } }),
      (e.toJSONSchema = Jr(e, {})),
      (e.def = t),
      (e.type = t.type),
      Object.defineProperty(e, `_def`, { value: t }),
      (e.check = (...n) =>
        e.clone(
          h(t, {
            checks: [
              ...(t.checks ?? []),
              ...n.map((e) =>
                typeof e == `function` ? { _zod: { check: e, def: { check: `custom` }, onattach: [] } } : e
              )
            ]
          }),
          { parent: !0 }
        )),
      (e.with = e.check),
      (e.clone = (t, n) => y(e, t, n)),
      (e.brand = () => e),
      (e.register = (t, n) => (t.add(e, n), e)),
      (e.parse = (t, n) => Di(e, t, n, { callee: e.parse })),
      (e.safeParse = (t, n) => ki(e, t, n)),
      (e.parseAsync = async (t, n) => Oi(e, t, n, { callee: e.parseAsync })),
      (e.safeParseAsync = async (t, n) => Ai(e, t, n)),
      (e.spa = e.safeParseAsync),
      (e.encode = (t, n) => ji(e, t, n)),
      (e.decode = (t, n) => Mi(e, t, n)),
      (e.encodeAsync = async (t, n) => Ni(e, t, n)),
      (e.decodeAsync = async (t, n) => Pi(e, t, n)),
      (e.safeEncode = (t, n) => Fi(e, t, n)),
      (e.safeDecode = (t, n) => Ii(e, t, n)),
      (e.safeEncodeAsync = async (t, n) => Li(e, t, n)),
      (e.safeDecodeAsync = async (t, n) => Ri(e, t, n)),
      (e.refine = (t, n) => e.check(Ga(t, n))),
      (e.superRefine = (t) => e.check(Ka(t))),
      (e.overwrite = (t) => e.check(j(t))),
      (e.optional = () => Da(e)),
      (e.exactOptional = () => ka(e)),
      (e.nullable = () => ja(e)),
      (e.nullish = () => Da(ja(e))),
      (e.nonoptional = (t) => La(e, t)),
      (e.array = () => V(e)),
      (e.or = (t) => U([e, t])),
      (e.and = (t) => ya(e, t)),
      (e.transform = (t) => Va(e, Ta(t))),
      (e.default = (t) => Na(e, t)),
      (e.prefault = (t) => Fa(e, t)),
      (e.catch = (t) => za(e, t)),
      (e.pipe = (t) => Va(e, t)),
      (e.readonly = () => Ua(e)),
      (e.describe = (t) => {
        let n = e.clone()
        return k.add(n, { description: t }), n
      }),
      Object.defineProperty(e, `description`, {
        get() {
          return k.get(e)?.description
        },
        configurable: !0
      }),
      (e.meta = (...t) => {
        if (t.length === 0) return k.get(e)
        let n = e.clone()
        return k.add(n, t[0]), n
      }),
      (e.isOptional = () => e.safeParse(void 0).success),
      (e.isNullable = () => e.safeParse(null).success),
      (e.apply = (t) => t(e)),
      e
    )
  ),
  zi = r(`_ZodString`, (e, t) => {
    At.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Zr(e, t, n, r))
    let n = e._zod.bag
    ;(e.format = n.format ?? null),
      (e.minLength = n.minimum ?? null),
      (e.maxLength = n.maximum ?? null),
      (e.regex = (...t) => e.check(Ar(...t))),
      (e.includes = (...t) => e.check(Nr(...t))),
      (e.startsWith = (...t) => e.check(Pr(...t))),
      (e.endsWith = (...t) => e.check(Fr(...t))),
      (e.min = (...t) => e.check(A(...t))),
      (e.max = (...t) => e.check(Or(...t))),
      (e.length = (...t) => e.check(kr(...t))),
      (e.nonempty = (...t) => e.check(A(1, ...t))),
      (e.lowercase = (t) => e.check(jr(t))),
      (e.uppercase = (t) => e.check(Mr(t))),
      (e.trim = () => e.check(Lr())),
      (e.normalize = (...t) => e.check(Ir(...t))),
      (e.toLowerCase = () => e.check(Rr())),
      (e.toUpperCase = () => e.check(zr())),
      (e.slugify = () => e.check(Br()))
  }),
  Bi = r(`ZodString`, (e, t) => {
    At.init(e, t),
      zi.init(e, t),
      (e.email = (t) => e.check(Kn(Vi, t))),
      (e.url = (t) => e.check(Qn(Wi, t))),
      (e.jwt = (t) => e.check(pr(aa, t))),
      (e.emoji = (t) => e.check($n(Gi, t))),
      (e.guid = (t) => e.check(qn(Hi, t))),
      (e.uuid = (t) => e.check(Jn(Ui, t))),
      (e.uuidv4 = (t) => e.check(Yn(Ui, t))),
      (e.uuidv6 = (t) => e.check(Xn(Ui, t))),
      (e.uuidv7 = (t) => e.check(Zn(Ui, t))),
      (e.nanoid = (t) => e.check(er(Ki, t))),
      (e.guid = (t) => e.check(qn(Hi, t))),
      (e.cuid = (t) => e.check(tr(qi, t))),
      (e.cuid2 = (t) => e.check(nr(Ji, t))),
      (e.ulid = (t) => e.check(rr(Yi, t))),
      (e.base64 = (t) => e.check(ur(na, t))),
      (e.base64url = (t) => e.check(dr(ra, t))),
      (e.xid = (t) => e.check(ir(Xi, t))),
      (e.ksuid = (t) => e.check(ar(Zi, t))),
      (e.ipv4 = (t) => e.check(or(Qi, t))),
      (e.ipv6 = (t) => e.check(sr($i, t))),
      (e.cidrv4 = (t) => e.check(cr(ea, t))),
      (e.cidrv6 = (t) => e.check(lr(ta, t))),
      (e.e164 = (t) => e.check(fr(ia, t))),
      (e.datetime = (t) => e.check(yi(t))),
      (e.date = (t) => e.check(xi(t))),
      (e.time = (t) => e.check(Ci(t))),
      (e.duration = (t) => e.check(Ti(t)))
  })
function I(e) {
  return Gn(Bi, e)
}
const L = r(`ZodStringFormat`, (e, t) => {
    O.init(e, t), zi.init(e, t)
  }),
  Vi = r(`ZodEmail`, (e, t) => {
    Nt.init(e, t), L.init(e, t)
  }),
  Hi = r(`ZodGUID`, (e, t) => {
    jt.init(e, t), L.init(e, t)
  }),
  Ui = r(`ZodUUID`, (e, t) => {
    Mt.init(e, t), L.init(e, t)
  }),
  Wi = r(`ZodURL`, (e, t) => {
    Pt.init(e, t), L.init(e, t)
  })
function R(e) {
  return Qn(Wi, e)
}
const Gi = r(`ZodEmoji`, (e, t) => {
    Ft.init(e, t), L.init(e, t)
  }),
  Ki = r(`ZodNanoID`, (e, t) => {
    It.init(e, t), L.init(e, t)
  }),
  qi = r(`ZodCUID`, (e, t) => {
    Lt.init(e, t), L.init(e, t)
  }),
  Ji = r(`ZodCUID2`, (e, t) => {
    Rt.init(e, t), L.init(e, t)
  }),
  Yi = r(`ZodULID`, (e, t) => {
    zt.init(e, t), L.init(e, t)
  }),
  Xi = r(`ZodXID`, (e, t) => {
    Bt.init(e, t), L.init(e, t)
  }),
  Zi = r(`ZodKSUID`, (e, t) => {
    Vt.init(e, t), L.init(e, t)
  }),
  Qi = r(`ZodIPv4`, (e, t) => {
    Kt.init(e, t), L.init(e, t)
  }),
  $i = r(`ZodIPv6`, (e, t) => {
    qt.init(e, t), L.init(e, t)
  }),
  ea = r(`ZodCIDRv4`, (e, t) => {
    Jt.init(e, t), L.init(e, t)
  }),
  ta = r(`ZodCIDRv6`, (e, t) => {
    Yt.init(e, t), L.init(e, t)
  }),
  na = r(`ZodBase64`, (e, t) => {
    Zt.init(e, t), L.init(e, t)
  }),
  ra = r(`ZodBase64URL`, (e, t) => {
    $t.init(e, t), L.init(e, t)
  }),
  ia = r(`ZodE164`, (e, t) => {
    en.init(e, t), L.init(e, t)
  }),
  aa = r(`ZodJWT`, (e, t) => {
    nn.init(e, t), L.init(e, t)
  }),
  oa = r(`ZodNumber`, (e, t) => {
    rn.init(e, t),
      F.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => Qr(e, t, n, r)),
      (e.gt = (t, n) => e.check(Tr(t, n))),
      (e.gte = (t, n) => e.check(Er(t, n))),
      (e.min = (t, n) => e.check(Er(t, n))),
      (e.lt = (t, n) => e.check(Cr(t, n))),
      (e.lte = (t, n) => e.check(wr(t, n))),
      (e.max = (t, n) => e.check(wr(t, n))),
      (e.int = (t) => e.check(ca(t))),
      (e.safe = (t) => e.check(ca(t))),
      (e.positive = (t) => e.check(Tr(0, t))),
      (e.nonnegative = (t) => e.check(Er(0, t))),
      (e.negative = (t) => e.check(Cr(0, t))),
      (e.nonpositive = (t) => e.check(wr(0, t))),
      (e.multipleOf = (t, n) => e.check(Dr(t, n))),
      (e.step = (t, n) => e.check(Dr(t, n))),
      (e.finite = () => e)
    let n = e._zod.bag
    ;(e.minValue = Math.max(n.minimum ?? -1 / 0, n.exclusiveMinimum ?? -1 / 0) ?? null),
      (e.maxValue = Math.min(n.maximum ?? 1 / 0, n.exclusiveMaximum ?? 1 / 0) ?? null),
      (e.isInt = (n.format ?? ``).includes(`int`) || Number.isSafeInteger(n.multipleOf ?? 0.5)),
      (e.isFinite = !0),
      (e.format = n.format ?? null)
  })
function z(e) {
  return vr(oa, e)
}
const sa = r(`ZodNumberFormat`, (e, t) => {
  an.init(e, t), oa.init(e, t)
})
function ca(e) {
  return yr(sa, e)
}
const la = r(`ZodBoolean`, (e, t) => {
  on.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => $r(e, t, n, r))
})
function B(e) {
  return br(la, e)
}
const ua = r(`ZodUnknown`, (e, t) => {
  sn.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (e, t, n) => void 0)
})
function da() {
  return xr(ua)
}
const fa = r(`ZodNever`, (e, t) => {
  cn.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => ei(e, t, n, r))
})
function pa(e) {
  return Sr(fa, e)
}
const ma = r(`ZodArray`, (e, t) => {
  un.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ai(e, t, n, r)),
    (e.element = t.element),
    (e.min = (t, n) => e.check(A(t, n))),
    (e.nonempty = (t) => e.check(A(1, t))),
    (e.max = (t, n) => e.check(Or(t, n))),
    (e.length = (t, n) => e.check(kr(t, n))),
    (e.unwrap = () => e.element)
})
function V(e, t) {
  return Vr(ma, e, t)
}
const ha = r(`ZodObject`, (e, t) => {
  hn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => oi(e, t, n, r)),
    p(e, `shape`, () => t.shape),
    (e.keyof = () => K(Object.keys(e._zod.def.shape))),
    (e.catchall = (t) => e.clone({ ...e._zod.def, catchall: t })),
    (e.passthrough = () => e.clone({ ...e._zod.def, catchall: da() })),
    (e.loose = () => e.clone({ ...e._zod.def, catchall: da() })),
    (e.strict = () => e.clone({ ...e._zod.def, catchall: pa() })),
    (e.strip = () => e.clone({ ...e._zod.def, catchall: void 0 })),
    (e.extend = (t) => fe(e, t)),
    (e.safeExtend = (t) => pe(e, t)),
    (e.merge = (t) => me(e, t)),
    (e.pick = (t) => ue(e, t)),
    (e.omit = (t) => de(e, t)),
    (e.partial = (...t) => he(Ea, e, t[0])),
    (e.required = (...t) => ge(Ia, e, t[0]))
})
function H(e, t) {
  return new ha({ type: `object`, shape: e ?? {}, ...b(t) })
}
const ga = r(`ZodUnion`, (e, t) => {
  _n.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => si(e, t, n, r)), (e.options = t.options)
})
function U(e, t) {
  return new ga({ type: `union`, options: e, ...b(t) })
}
const _a = r(`ZodDiscriminatedUnion`, (e, t) => {
  ga.init(e, t), vn.init(e, t)
})
function W(e, t, n) {
  return new _a({ type: `union`, options: t, discriminator: e, ...b(n) })
}
const va = r(`ZodIntersection`, (e, t) => {
  yn.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => ci(e, t, n, r))
})
function ya(e, t) {
  return new va({ type: `intersection`, left: e, right: t })
}
const ba = r(`ZodRecord`, (e, t) => {
  Sn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => li(e, t, n, r)),
    (e.keyType = t.keyType),
    (e.valueType = t.valueType)
})
function xa(e, t, n) {
  return new ba({ type: `record`, keyType: e, valueType: t, ...b(n) })
}
function G(e, t, n) {
  let r = y(e)
  return (r._zod.values = void 0), new ba({ type: `record`, keyType: r, valueType: t, ...b(n) })
}
const Sa = r(`ZodEnum`, (e, t) => {
  Cn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ti(e, t, n, r)),
    (e.enum = t.entries),
    (e.options = Object.values(t.entries))
  let n = new Set(Object.keys(t.entries))
  ;(e.extract = (e, r) => {
    let i = {}
    for (let r of e)
      if (n.has(r)) i[r] = t.entries[r]
      else throw Error(`Key ${r} not found in enum`)
    return new Sa({ ...t, checks: [], ...b(r), entries: i })
  }),
    (e.exclude = (e, r) => {
      let i = { ...t.entries }
      for (let t of e)
        if (n.has(t)) delete i[t]
        else throw Error(`Key ${t} not found in enum`)
      return new Sa({ ...t, checks: [], ...b(r), entries: i })
    })
})
function K(e, t) {
  return new Sa({ type: `enum`, entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e, ...b(t) })
}
const Ca = r(`ZodLiteral`, (e, t) => {
  wn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ni(e, t, n, r)),
    (e.values = new Set(t.values)),
    Object.defineProperty(e, `value`, {
      get() {
        if (t.values.length > 1)
          throw Error('This schema contains multiple valid literal values. Use `.values` instead.')
        return t.values[0]
      }
    })
})
function q(e, t) {
  return new Ca({ type: `literal`, values: Array.isArray(e) ? e : [e], ...b(t) })
}
const wa = r(`ZodTransform`, (e, t) => {
  Tn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ii(e, t, n, r)),
    (e._zod.parse = (n, r) => {
      if (r.direction === `backward`) throw new a(e.constructor.name)
      n.addIssue = (r) => {
        if (typeof r == `string`) n.issues.push(T(r, n.value, t))
        else {
          let t = r
          t.fatal && (t.continue = !1),
            (t.code ??= `custom`),
            (t.input ??= n.value),
            (t.inst ??= e),
            n.issues.push(T(t))
        }
      }
      let i = t.transform(n.value, n)
      return i instanceof Promise ? i.then((e) => ((n.value = e), n)) : ((n.value = i), n)
    })
})
function Ta(e) {
  return new wa({ type: `transform`, transform: e })
}
const Ea = r(`ZodOptional`, (e, t) => {
  Dn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => _i(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function Da(e) {
  return new Ea({ type: `optional`, innerType: e })
}
const Oa = r(`ZodExactOptional`, (e, t) => {
  On.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => _i(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function ka(e) {
  return new Oa({ type: `optional`, innerType: e })
}
const Aa = r(`ZodNullable`, (e, t) => {
  kn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ui(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function ja(e) {
  return new Aa({ type: `nullable`, innerType: e })
}
const Ma = r(`ZodDefault`, (e, t) => {
  An.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => fi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeDefault = e.unwrap)
})
function Na(e, t) {
  return new Ma({
    type: `default`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : oe(t)
    }
  })
}
const Pa = r(`ZodPrefault`, (e, t) => {
  Mn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => pi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function Fa(e, t) {
  return new Pa({
    type: `prefault`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : oe(t)
    }
  })
}
const Ia = r(`ZodNonOptional`, (e, t) => {
  Nn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => di(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function La(e, t) {
  return new Ia({ type: `nonoptional`, innerType: e, ...b(t) })
}
const Ra = r(`ZodCatch`, (e, t) => {
  Fn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => mi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeCatch = e.unwrap)
})
function za(e, t) {
  return new Ra({ type: `catch`, innerType: e, catchValue: typeof t == `function` ? t : () => t })
}
const Ba = r(`ZodPipe`, (e, t) => {
  In.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => hi(e, t, n, r)), (e.in = t.in), (e.out = t.out)
})
function Va(e, t) {
  return new Ba({ type: `pipe`, in: e, out: t })
}
const Ha = r(`ZodReadonly`, (e, t) => {
  Rn.init(e, t),
    F.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => gi(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function Ua(e) {
  return new Ha({ type: `readonly`, innerType: e })
}
const Wa = r(`ZodCustom`, (e, t) => {
  Bn.init(e, t), F.init(e, t), (e._zod.processJSONSchema = (t, n, r) => ri(e, t, n, r))
})
function Ga(e, t = {}) {
  return Hr(Wa, e, t)
}
function Ka(e) {
  return Ur(e)
}
const J = {
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
  qa = {
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
  Ja = { WEB_SEARCH: `web-search`, URL_CONTEXT: `url-context` },
  Ya = { ALL_CHAT_MODELS: `all-chat-models`, MODEL_DEPENDENT: `model-dependent` },
  Y = {
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
  Xa = { TEXT: `text`, IMAGE: `image`, AUDIO: `audio`, VIDEO: `video`, VECTOR: `vector` },
  Za = { USD: `USD`, CNY: `CNY` },
  Qa = {
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
function X(e) {
  return Object.values(e)
}
const $a = I().min(1),
  eo = I().min(1),
  to = I().min(1),
  no = H({ min: z(), max: z() }).refine((e) => e.min <= e.max, { message: `min must be less than or equal to max` })
H({ min: I(), max: I() })
const ro = K(X(Za)).optional(),
  Z = H({ perMillionTokens: z().nonnegative().nullable(), currency: ro }),
  io = xa(I(), da()).optional(),
  ao = K(X(Xa)),
  oo = K(X(qa)),
  so = K(X(Y)),
  co = H({ min: z().nonnegative().optional(), max: z().positive().optional(), default: z().nonnegative().optional() })
    .refine((e) => (e.min == null) == (e.max == null), { message: `min and max must be both present or both absent` })
    .refine((e) => e.min == null || e.max == null || e.min <= e.max, {
      message: `min must be less than or equal to max`
    }),
  Q = K(X(Qa)),
  lo = W(`kind`, [
    H({ kind: q(`effort`), values: V(Q).min(1), default: Q.optional() }),
    H({ kind: q(`budget`), min: z().nonnegative(), max: z().positive(), default: z().nonnegative().optional() }),
    H({ kind: q(`toggle`), default: B().optional() })
  ]),
  uo = K([`effort`, `budget`])
H({
  pattern: I().refine(
    (e) => {
      try {
        return new RegExp(e, `i`), !0
      } catch {
        return !1
      }
    },
    { message: `pattern must be a valid regular expression` }
  ),
  effort: V(Q).min(1).optional(),
  toggle: B().optional(),
  budget: H({ min: z().nonnegative(), max: z().positive() })
    .refine((e) => e.min <= e.max, { message: `budget min must be <= max` })
    .optional(),
  template: q(!0).optional(),
  wireDialect: uo.optional()
}).refine(
  (e) =>
    e.template !== !0 || e.effort !== void 0 || e.toggle !== void 0 || e.budget !== void 0 || e.wireDialect !== void 0,
  { message: `a template rule with no knobs declares nothing — drop it or make it a profile` }
)
const fo = H({
    controls: V(lo).optional(),
    thinkingTokenLimits: co.optional(),
    supportedEfforts: V(Q).optional(),
    defaultEffort: Q.optional(),
    wireDialect: uo.optional()
  }).superRefine((e, t) => {
    let n = (e.controls ?? []).map((e) => e.kind)
    new Set(n).size !== n.length && t.addIssue({ code: `custom`, message: `at most one reasoning control per kind` })
    for (let n of e.controls ?? [])
      n.kind === `effort` &&
        n.default != null &&
        !n.values.includes(n.default) &&
        t.addIssue({ code: `custom`, message: `effort default must be a member of values` }),
        n.kind === `budget` &&
          (n.min > n.max || (n.default != null && (n.default < n.min || n.default > n.max))) &&
          t.addIssue({ code: `custom`, message: `budget range must satisfy min <= default <= max` })
  }),
  po = K([`generate`, `edit`, `remix`, `upscale`, `merge`]),
  mo = H({ type: q(`switch`), default: B().optional() }),
  ho = H({
    type: q(`enum`),
    options: V(I()).min(1),
    default: I().optional(),
    render: K([`select`, `chips`]).optional(),
    columns: z().int().positive().optional()
  }),
  go = H({ type: q(`range`), min: z(), max: z(), default: z().optional(), step: z().optional() }).refine(
    (e) => e.min <= e.max,
    { message: `min must be ≤ max` }
  ),
  _o = H({
    type: q(`range`),
    min: z().int(),
    max: z().int(),
    default: z().int().optional(),
    step: z().int().positive().default(1)
  }).refine((e) => e.min <= e.max, { message: `min must be ≤ max` }),
  vo = W(`type`, [
    mo,
    ho,
    go,
    H({ type: q(`size`), minSide: z(), maxSide: z(), pairedEnumKey: I().optional() }),
    H({ type: q(`text`), multiline: B().optional() })
  ]),
  yo = [Y.NUM_IMAGES, Y.MAX_IMAGES, Y.NUM_INFERENCE_STEPS, Y.SAFETY_TOLERANCE, Y.OUTPUT_COMPRESSION],
  bo = H({
    modes: G(
      po,
      H({
        supports: G(so, vo).transform((e, t) => {
          let n = { ...e }
          for (let r of yo) {
            let i = e[r]
            if (i === void 0) continue
            let a = _o.safeParse(i)
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
  xo = H({
    temperature: H({ supported: B(), range: no.optional() }).default({ supported: !0 }),
    topP: H({ supported: B(), range: no.optional() }).default({ supported: !0 }),
    topK: H({ supported: B(), range: no.optional() }).default({ supported: !1 }),
    frequencyPenalty: B().default(!0),
    presencePenalty: B().default(!0),
    maxTokens: B().default(!0),
    stopSequences: B().default(!0),
    systemMessage: B().default(!0)
  }),
  So = H({
    input: Z,
    output: Z,
    cacheRead: Z.optional(),
    cacheWrite: Z.optional(),
    inputTokenTiers: V(
      H({
        minInputTokens: z().int().positive().refine(Number.isSafeInteger),
        input: Z,
        output: Z,
        cacheRead: Z.optional(),
        cacheWrite: Z.optional()
      })
    ).optional(),
    perImage: H({ price: z(), currency: ro, unit: K([`image`, `pixel`]).optional() }).optional(),
    perMinute: H({ price: z(), currency: ro }).optional()
  })
function Co(e, t) {
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
    r = n[0]?.rate.currency ?? Za.USD
  for (let { rate: e, path: i } of n)
    (e.currency ?? Za.USD) !== r &&
      t.addIssue({ code: `custom`, path: [...i, `currency`], message: `pricing currencies must match` })
}
const wo = So.superRefine(Co),
  To = So.partial().superRefine(Co),
  Eo = H({
    version: to,
    models: V(
      H({
        id: $a,
        name: I(),
        description: I().optional(),
        capabilities: V(oo)
          .refine((e) => new Set(e).size === e.length, { message: `Capabilities must be unique` })
          .optional(),
        inputModalities: V(ao)
          .refine((e) => new Set(e).size === e.length, { message: `Input modalities must be unique` })
          .optional(),
        outputModalities: V(ao)
          .refine((e) => new Set(e).size === e.length, { message: `Output modalities must be unique` })
          .optional(),
        contextWindow: z().optional(),
        maxOutputTokens: z().optional(),
        maxInputTokens: z().optional(),
        pricing: wo.optional(),
        reasoning: fo.optional(),
        parameterSupport: xo.optional(),
        imageGeneration: bo.optional(),
        family: I().optional(),
        ownedBy: I().optional(),
        openWeights: B().optional(),
        metadata: io
      })
    )
  }),
  Do = {
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
  Oo = K(
    `reasoningEffort,reasoningSummary,reasoning_effort,reasoning.effort,reasoning.enabled,reasoning.exclude,reasoning.max_tokens,thinking.type,thinking.budget_tokens,thinking.budgetTokens,thinking.display,effort,sendReasoning,enable_thinking,thinking_budget,incremental_output,disable_reasoning,reasoning_budget,chat_template_kwargs.enable_thinking,chat_template_kwargs.thinking,chat_template_kwargs.thinking_mode,chat_template_kwargs.thinking_budget,extra_body.google.thinking_config.thinking_budget,extra_body.google.thinking_config.include_thoughts,extra_body.thinking.type,extra_body.thinking_budget,extra_body.reasoning_effort,thinkingConfig.includeThoughts,thinkingConfig.thinkingBudget,thinkingConfig.thinkingLevel,reasoningConfig.type,reasoningConfig.budgetTokens,reasoningConfig.maxReasoningEffort,think`.split(
      `,`
    )
  ),
  ko = K(X(Qa)),
  Ao = H({
    target: Oo,
    value: W(`source`, [
      H({ source: q(`literal`), value: U([I(), z(), B()]) }),
      H({ source: q(`effort`) }),
      H({ source: q(`budget`) }),
      H({ source: q(`assistant-summary`) })
    ])
  }),
  jo = H({
    target: Oo,
    value: W(`source`, [
      H({ source: q(`literal`), value: U([I(), z(), B()]) }),
      H({ source: q(`effort`) }),
      H({ source: q(`assistant-summary`) })
    ])
  }),
  Mo = H({
    min: z().nonnegative().optional(),
    autoValue: z().optional(),
    clampToMaxTokens: B().optional(),
    missing: W(`type`, [
      H({ type: q(`omit-value`) }),
      H({ type: q(`omit-mode`) }),
      H({ type: q(`fallback`), value: z() })
    ])
  }),
  No = G(ko, ko).optional(),
  Po = U([
    H({ operations: V(jo).min(1), effortMap: No }),
    H({
      operations: V(Ao)
        .min(1)
        .refine((e) => e.some((e) => e.value.source === `budget`), {
          message: `reasoning budget mode must contain a budget operation`
        }),
      effortMap: No,
      budget: Mo
    })
  ]),
  Fo = H({
    disabled: q(!0).optional(),
    default: Po.optional(),
    off: Po.optional(),
    auto: Po.optional(),
    effort: Po.optional()
  }).refine((e) => e.disabled === !0 || e.default || e.off || e.auto || e.effort, {
    message: `reasoning wire profile must declare a mode or be disabled`
  })
H({ wire: Fo, budgetWire: Fo.optional() })
const Io = K(X(J)),
  Lo = X(J),
  Ro = K([`global`, `cn`]),
  zo = K([`openai-priority`, `claude-code`]),
  Bo = K([`standard`, `auto`, `fast`, `flex`]),
  Vo = V(Bo)
    .min(1)
    .refine((e) => new Set(e).size === e.length, { message: `service tier options must be unique` })
    .refine((e) => e.includes(`standard`), { message: `service tier options must include standard` }),
  Ho = H({
    default: Bo,
    options: Vo,
    wire: H({
      delivery: W(`type`, [
        H({ type: q(`provider-option`), key: I().min(1) }),
        H({ type: q(`request-body`), key: I().min(1) })
      ]),
      values: G(Bo, I().min(1))
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
  Uo = H({
    id: K(X(Ja)),
    modelScope: K(X(Ya)).default(Ya.MODEL_DEPENDENT),
    endpointTypes: V(Io).optional(),
    vendors: V(K(Object.keys(Do))).optional()
  }),
  $ = (e) => H({ type: q(e), wire: Fo.optional() }),
  Wo = W(`type`, [$(`openai-chat`), $(`openai-responses`), $(`anthropic`), $(`gemini`), $(`ollama`), $(`none`)])
Wo.options.map((e) => e.shape.type.value)
const Go = H({
    website: H({ official: R().optional(), docs: R().optional(), apiKey: R().optional(), models: R().optional() })
  }),
  Ko = H({ streamOptions: B().optional(), developerRole: B().optional(), reasoningSummary: B().optional() }),
  qo = H({
    baseUrl: R().optional(),
    modelsApiUrls: H({
      default: R().optional(),
      embedding: R().optional(),
      image: R().optional(),
      reranker: R().optional()
    }).optional(),
    reasoningFormat: Wo.optional(),
    adapterFamily: I().optional(),
    dialect: Ko.optional(),
    requestControls: H({ serviceTier: Ho.optional() }).optional()
  }),
  Jo = H({
    version: to,
    providers: V(
      H({
        id: eo,
        presetProviderId: eo.optional(),
        name: I(),
        availableInEditions: V(Ro).min(1).optional(),
        description: I().optional(),
        endpointConfigs: xa(
          I().refine((e) => Lo.includes(e), {
            message: `Invalid endpoint type key, must be one of: ${X(J).join(`, `)}`
          }),
          qo
        ).optional(),
        defaultChatEndpoint: Io.nullable().default(null),
        modelListSource: K([`api`, `registry`]).default(`api`),
        authMethods: V(K([`api-key`, `oauth`, `external-cli`])).optional(),
        authOptional: B().default(!1),
        serverTools: V(Uo).default([]),
        reportsActualCost: B().default(!1),
        reportedCostCurrency: ro,
        fastMode: H({ transport: zo, serviceTier: I().optional() }).optional(),
        metadata: io.and(Go)
      }).refine((e) => (e.endpointConfigs && e.defaultChatEndpoint ? e.defaultChatEndpoint in e.endpointConfigs : !0), {
        message: `defaultChatEndpoint must exist as a key in endpointConfigs`
      })
    )
  }),
  Yo = H({ add: V(oo).optional(), remove: V(oo).optional(), force: V(oo).optional() }),
  Xo = K([
    J.OPENAI_RESPONSES,
    J.OPENAI_CHAT_COMPLETIONS,
    J.ANTHROPIC_MESSAGES,
    J.GOOGLE_GENERATE_CONTENT,
    J.OLLAMA_CHAT,
    J.OLLAMA_GENERATE,
    J.OPENAI_TEXT_COMPLETIONS
  ]),
  Zo = H({ support: fo.optional(), wire: Fo.optional() }).refine((e) => e.support || e.wire, {
    message: `provider-model reasoning contract must declare support or wire`
  }),
  Qo = H({
    version: to,
    overrides: V(
      H({
        providerId: eo,
        modelId: $a,
        apiModelId: I().optional(),
        modelVariants: V(I().min(1)).optional(),
        capabilities: Yo.optional(),
        limits: H({
          contextWindow: z().optional(),
          maxOutputTokens: z().optional(),
          maxInputTokens: z().optional()
        }).optional(),
        pricing: To.optional(),
        reasoningContracts: G(Xo, Zo).optional(),
        supportsFastMode: B().optional(),
        requestControls: H({ serviceTier: H({ options: Vo }).optional() }).optional(),
        parameterSupport: xo.partial().optional(),
        endpointTypes: V(Io).optional(),
        inputModalities: V(ao).optional(),
        outputModalities: V(ao).optional(),
        name: I().optional(),
        description: I().optional(),
        family: I().optional(),
        ownedBy: I().optional(),
        imageGeneration: bo.optional(),
        disabled: B().optional(),
        replaceWith: $a.optional(),
        reason: I().optional()
      })
    )
  }),
  $o = `anthropic|amazon|meta|google|mistralai|cohere|openai|ai21|microsoft|nvidia`
;`${$o}`, `${$o}`
const es = [`models.json`, `providers.json`, `provider-models.json`]
H({
  minAppVersion: I().min(1),
  sourceAppVersion: I().min(1),
  revision: z().int().nonnegative(),
  schemaVersion: z().int(),
  files: xa(I(), I())
})
const ts = { 'models.json': Eo, 'providers.json': Jo, 'provider-models.json': Qo },
  ns = 2
function rs(e) {
  return e && typeof e == `object` && `issues` in e
    ? JSON.stringify(e.issues)
    : e instanceof Error
      ? e.message
      : String(e)
}
function is(e, t) {
  ts[e].parse(t)
}
function as(n) {
  for (let r of es)
    try {
      is(r, JSON.parse(e(t.join(n, r), `utf8`)))
    } catch (e) {
      throw Error(`${r} is not compatible with registry schema v2: ${rs(e)}`)
    }
}
if (process.argv[1] && t.resolve(process.argv[1]) === n(import.meta.url)) {
  let e = process.argv[2]
  if (!e) console.error(`Usage: node vN-validator.mjs <catalog-data-directory>`), (process.exitCode = 1)
  else
    try {
      as(t.resolve(e)), console.log(`Catalog is compatible with frozen registry schema v2`)
    } catch (e) {
      console.error(e instanceof Error ? e.message : e), (process.exitCode = 1)
    }
}
export { ns as schemaVersion, as as validateCatalogDirectory, is as validateCatalogFile }
