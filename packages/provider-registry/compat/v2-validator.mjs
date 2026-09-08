/* eslint-disable */
// AUTO-GENERATED compatibility contract. Never edit or replace this file.
import { readFileSync as e } from 'node:fs'
import t from 'node:path'
import { fileURLToPath as n } from 'node:url'
Object.create,
  Object.defineProperty,
  Object.getOwnPropertyDescriptor,
  Object.getOwnPropertyNames,
  Object.getPrototypeOf,
  Object.prototype.hasOwnProperty
var r = (e, t) => () => (t || e((t = { exports: {} }).exports, t), t.exports),
  i = r((e, t) => {
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
  a = r((e, t) => {
    t.exports =
      typeof process == `object` && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG)
        ? (...e) => console.error(`SEMVER`, ...e)
        : () => {}
  }),
  o = r((e, t) => {
    let { MAX_SAFE_COMPONENT_LENGTH: n, MAX_SAFE_BUILD_LENGTH: r, MAX_LENGTH: o } = i(),
      s = a()
    e = t.exports = {}
    let c = (e.re = []),
      l = (e.safeRe = []),
      u = (e.src = []),
      d = (e.safeSrc = []),
      f = (e.t = {}),
      p = 0,
      m = `[a-zA-Z0-9-]`,
      h = [
        [`\\s`, 1],
        [`\\d`, o],
        [m, r]
      ],
      g = (e) => {
        for (let [t, n] of h) e = e.split(`${t}*`).join(`${t}{0,${n}}`).split(`${t}+`).join(`${t}{1,${n}}`)
        return e
      },
      _ = (e, t, n) => {
        let r = g(t),
          i = p++
        s(e, i, t),
          (f[e] = i),
          (u[i] = t),
          (d[i] = r),
          (c[i] = new RegExp(t, n ? `g` : void 0)),
          (l[i] = new RegExp(r, n ? `g` : void 0))
      }
    _(`NUMERICIDENTIFIER`, `0|[1-9]\\d*`),
      _(`NUMERICIDENTIFIERLOOSE`, `\\d+`),
      _(`NONNUMERICIDENTIFIER`, `\\d*[a-zA-Z-]${m}*`),
      _(`MAINVERSION`, `(${u[f.NUMERICIDENTIFIER]})\\.(${u[f.NUMERICIDENTIFIER]})\\.(${u[f.NUMERICIDENTIFIER]})`),
      _(
        `MAINVERSIONLOOSE`,
        `(${u[f.NUMERICIDENTIFIERLOOSE]})\\.(${u[f.NUMERICIDENTIFIERLOOSE]})\\.(${u[f.NUMERICIDENTIFIERLOOSE]})`
      ),
      _(`PRERELEASEIDENTIFIER`, `(?:${u[f.NUMERICIDENTIFIER]}|${u[f.NONNUMERICIDENTIFIER]})`),
      _(`PRERELEASEIDENTIFIERLOOSE`, `(?:${u[f.NUMERICIDENTIFIERLOOSE]}|${u[f.NONNUMERICIDENTIFIER]})`),
      _(`PRERELEASE`, `(?:-(${u[f.PRERELEASEIDENTIFIER]}(?:\\.${u[f.PRERELEASEIDENTIFIER]})*))`),
      _(`PRERELEASELOOSE`, `(?:-?(${u[f.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${u[f.PRERELEASEIDENTIFIERLOOSE]})*))`),
      _(`BUILDIDENTIFIER`, `${m}+`),
      _(`BUILD`, `(?:\\+(${u[f.BUILDIDENTIFIER]}(?:\\.${u[f.BUILDIDENTIFIER]})*))`),
      _(`FULLPLAIN`, `v?${u[f.MAINVERSION]}${u[f.PRERELEASE]}?${u[f.BUILD]}?`),
      _(`FULL`, `^${u[f.FULLPLAIN]}$`),
      _(`LOOSEPLAIN`, `[v=\\s]*${u[f.MAINVERSIONLOOSE]}${u[f.PRERELEASELOOSE]}?${u[f.BUILD]}?`),
      _(`LOOSE`, `^${u[f.LOOSEPLAIN]}$`),
      _(`GTLT`, `((?:<|>)?=?)`),
      _(`XRANGEIDENTIFIERLOOSE`, `${u[f.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`),
      _(`XRANGEIDENTIFIER`, `${u[f.NUMERICIDENTIFIER]}|x|X|\\*`),
      _(
        `XRANGEPLAIN`,
        `[v=\\s]*(${u[f.XRANGEIDENTIFIER]})(?:\\.(${u[f.XRANGEIDENTIFIER]})(?:\\.(${u[f.XRANGEIDENTIFIER]})(?:${u[f.PRERELEASE]})?${u[f.BUILD]}?)?)?`
      ),
      _(
        `XRANGEPLAINLOOSE`,
        `[v=\\s]*(${u[f.XRANGEIDENTIFIERLOOSE]})(?:\\.(${u[f.XRANGEIDENTIFIERLOOSE]})(?:\\.(${u[f.XRANGEIDENTIFIERLOOSE]})(?:${u[f.PRERELEASELOOSE]})?${u[f.BUILD]}?)?)?`
      ),
      _(`XRANGE`, `^${u[f.GTLT]}\\s*${u[f.XRANGEPLAIN]}$`),
      _(`XRANGELOOSE`, `^${u[f.GTLT]}\\s*${u[f.XRANGEPLAINLOOSE]}$`),
      _(`COERCEPLAIN`, `(^|[^\\d])(\\d{1,${n}})(?:\\.(\\d{1,${n}}))?(?:\\.(\\d{1,${n}}))?`),
      _(`COERCE`, `${u[f.COERCEPLAIN]}(?:$|[^\\d])`),
      _(`COERCEFULL`, u[f.COERCEPLAIN] + `(?:${u[f.PRERELEASE]})?(?:${u[f.BUILD]})?(?:$|[^\\d])`),
      _(`COERCERTL`, u[f.COERCE], !0),
      _(`COERCERTLFULL`, u[f.COERCEFULL], !0),
      _(`LONETILDE`, `(?:~>?)`),
      _(`TILDETRIM`, `(\\s*)${u[f.LONETILDE]}\\s+`, !0),
      (e.tildeTrimReplace = `$1~`),
      _(`TILDE`, `^${u[f.LONETILDE]}${u[f.XRANGEPLAIN]}$`),
      _(`TILDELOOSE`, `^${u[f.LONETILDE]}${u[f.XRANGEPLAINLOOSE]}$`),
      _(`LONECARET`, `(?:\\^)`),
      _(`CARETTRIM`, `(\\s*)${u[f.LONECARET]}\\s+`, !0),
      (e.caretTrimReplace = `$1^`),
      _(`CARET`, `^${u[f.LONECARET]}${u[f.XRANGEPLAIN]}$`),
      _(`CARETLOOSE`, `^${u[f.LONECARET]}${u[f.XRANGEPLAINLOOSE]}$`),
      _(`COMPARATORLOOSE`, `^${u[f.GTLT]}\\s*(${u[f.LOOSEPLAIN]})$|^$`),
      _(`COMPARATOR`, `^${u[f.GTLT]}\\s*(${u[f.FULLPLAIN]})$|^$`),
      _(`COMPARATORTRIM`, `(\\s*)${u[f.GTLT]}\\s*(${u[f.LOOSEPLAIN]}|${u[f.XRANGEPLAIN]})`, !0),
      (e.comparatorTrimReplace = `$1$2$3`),
      _(`HYPHENRANGE`, `^\\s*(${u[f.XRANGEPLAIN]})\\s+-\\s+(${u[f.XRANGEPLAIN]})\\s*$`),
      _(`HYPHENRANGELOOSE`, `^\\s*(${u[f.XRANGEPLAINLOOSE]})\\s+-\\s+(${u[f.XRANGEPLAINLOOSE]})\\s*$`),
      _(`STAR`, `(<|>)?=?\\s*\\*`),
      _(`GTE0`, `^\\s*>=\\s*0\\.0\\.0\\s*$`),
      _(`GTE0PRE`, `^\\s*>=\\s*0\\.0\\.0-0\\s*$`)
  }),
  s = r((e, t) => {
    let n = Object.freeze({ loose: !0 }),
      r = Object.freeze({})
    t.exports = (e) => (e ? (typeof e == `object` ? e : n) : r)
  }),
  c = r((e, t) => {
    let n = /^[0-9]+$/,
      r = (e, t) => {
        let r = n.test(e),
          i = n.test(t)
        return r && i && ((e = +e), (t = +t)), e === t ? 0 : r && !i ? -1 : i && !r ? 1 : e < t ? -1 : 1
      }
    t.exports = { compareIdentifiers: r, rcompareIdentifiers: (e, t) => r(t, e) }
  }),
  l = r((e, t) => {
    let n = a(),
      { MAX_LENGTH: r, MAX_SAFE_INTEGER: l } = i(),
      { safeRe: u, safeSrc: d, t: f } = o(),
      p = s(),
      { compareIdentifiers: m } = c()
    t.exports = class e {
      constructor(t, i) {
        if (((i = p(i)), t instanceof e)) {
          if (t.loose === !!i.loose && t.includePrerelease === !!i.includePrerelease) return t
          t = t.version
        } else if (typeof t != `string`) throw TypeError(`Invalid version. Must be a string. Got type "${typeof t}".`)
        if (t.length > r) throw TypeError(`version is longer than ${r} characters`)
        n(`SemVer`, t, i),
          (this.options = i),
          (this.loose = !!i.loose),
          (this.includePrerelease = !!i.includePrerelease)
        let a = t.trim().match(i.loose ? u[f.LOOSE] : u[f.FULL])
        if (!a) throw TypeError(`Invalid Version: ${t}`)
        if (
          ((this.raw = t),
          (this.major = +a[1]),
          (this.minor = +a[2]),
          (this.patch = +a[3]),
          this.major > l || this.major < 0)
        )
          throw TypeError(`Invalid major version`)
        if (this.minor > l || this.minor < 0) throw TypeError(`Invalid minor version`)
        if (this.patch > l || this.patch < 0) throw TypeError(`Invalid patch version`)
        a[4]
          ? (this.prerelease = a[4].split(`.`).map((e) => {
              if (/^[0-9]+$/.test(e)) {
                let t = +e
                if (t >= 0 && t < l) return t
              }
              return e
            }))
          : (this.prerelease = []),
          (this.build = a[5] ? a[5].split(`.`) : []),
          this.format()
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
          m(this.major, t.major) || m(this.minor, t.minor) || m(this.patch, t.patch)
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
          if (e === i) continue
          return m(e, i)
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
          if (e === i) continue
          return m(e, i)
        } while (++r)
      }
      inc(e, t, n) {
        if (e.startsWith(`pre`)) {
          if (!t && n === !1) throw Error(`invalid increment argument: identifier is empty`)
          if (t) {
            let e = RegExp(`^${this.options.loose ? d[f.PRERELEASELOOSE] : d[f.PRERELEASE]}$`),
              n = `-${t}`.match(e)
            if (!n || n[1] !== t) throw Error(`invalid identifier: ${t}`)
          }
        }
        switch (e) {
          case `premajor`:
            ;(this.prerelease.length = 0), (this.patch = 0), (this.minor = 0), this.major++, this.inc(`pre`, t, n)
            break
          case `preminor`:
            ;(this.prerelease.length = 0), (this.patch = 0), this.minor++, this.inc(`pre`, t, n)
            break
          case `prepatch`:
            ;(this.prerelease.length = 0), this.inc(`patch`, t, n), this.inc(`pre`, t, n)
            break
          case `prerelease`:
            this.prerelease.length === 0 && this.inc(`patch`, t, n), this.inc(`pre`, t, n)
            break
          case `release`:
            if (this.prerelease.length === 0) throw Error(`version ${this.raw} is not a prerelease`)
            this.prerelease.length = 0
            break
          case `major`:
            ;(this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) && this.major++,
              (this.minor = 0),
              (this.patch = 0),
              (this.prerelease = [])
            break
          case `minor`:
            ;(this.patch !== 0 || this.prerelease.length === 0) && this.minor++,
              (this.patch = 0),
              (this.prerelease = [])
            break
          case `patch`:
            this.prerelease.length === 0 && this.patch++, (this.prerelease = [])
            break
          case `pre`: {
            let e = Number(n) ? 1 : 0
            if (this.prerelease.length === 0) this.prerelease = [e]
            else {
              let r = this.prerelease.length
              for (; --r >= 0; ) typeof this.prerelease[r] == `number` && (this.prerelease[r]++, (r = -2))
              if (r === -1) {
                if (t === this.prerelease.join(`.`) && n === !1)
                  throw Error(`invalid increment argument: identifier already exists`)
                this.prerelease.push(e)
              }
            }
            if (t) {
              let r = [t, e]
              n === !1 && (r = [t]),
                m(this.prerelease[0], t) === 0
                  ? isNaN(this.prerelease[1]) && (this.prerelease = r)
                  : (this.prerelease = r)
            }
            break
          }
          default:
            throw Error(`invalid increment argument: ${e}`)
        }
        return (this.raw = this.format()), this.build.length && (this.raw += `+${this.build.join(`.`)}`), this
      }
    }
  }),
  u = r((e, t) => {
    let n = l()
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
  d = r((e, t) => {
    let n = u()
    t.exports = (e, t) => {
      let r = n(e, t)
      return r ? r.version : null
    }
  }),
  f = r((e, t) => {
    let n = u()
    t.exports = (e, t) => {
      let r = n(e.trim().replace(/^[=v]+/, ``), t)
      return r ? r.version : null
    }
  }),
  p = r((e, t) => {
    let n = l()
    t.exports = (e, t, r, i, a) => {
      typeof r == `string` && ((a = i), (i = r), (r = void 0))
      try {
        return new n(e instanceof n ? e.version : e, r).inc(t, i, a).version
      } catch {
        return null
      }
    }
  }),
  m = r((e, t) => {
    let n = u()
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
  h = r((e, t) => {
    let n = l()
    t.exports = (e, t) => new n(e, t).major
  }),
  g = r((e, t) => {
    let n = l()
    t.exports = (e, t) => new n(e, t).minor
  }),
  _ = r((e, t) => {
    let n = l()
    t.exports = (e, t) => new n(e, t).patch
  }),
  v = r((e, t) => {
    let n = u()
    t.exports = (e, t) => {
      let r = n(e, t)
      return r && r.prerelease.length ? r.prerelease : null
    }
  }),
  y = r((e, t) => {
    let n = l()
    t.exports = (e, t, r) => new n(e, r).compare(new n(t, r))
  }),
  ee = r((e, t) => {
    let n = y()
    t.exports = (e, t, r) => n(t, e, r)
  }),
  te = r((e, t) => {
    let n = y()
    t.exports = (e, t) => n(e, t, !0)
  }),
  ne = r((e, t) => {
    let n = l()
    t.exports = (e, t, r) => {
      let i = new n(e, r),
        a = new n(t, r)
      return i.compare(a) || i.compareBuild(a)
    }
  }),
  re = r((e, t) => {
    let n = ne()
    t.exports = (e, t) => e.sort((e, r) => n(e, r, t))
  }),
  b = r((e, t) => {
    let n = ne()
    t.exports = (e, t) => e.sort((e, r) => n(r, e, t))
  }),
  ie = r((e, t) => {
    let n = y()
    t.exports = (e, t, r) => n(e, t, r) > 0
  }),
  ae = r((e, t) => {
    let n = y()
    t.exports = (e, t, r) => n(e, t, r) < 0
  }),
  oe = r((e, t) => {
    let n = y()
    t.exports = (e, t, r) => n(e, t, r) === 0
  }),
  se = r((e, t) => {
    let n = y()
    t.exports = (e, t, r) => n(e, t, r) !== 0
  }),
  ce = r((e, t) => {
    let n = y()
    t.exports = (e, t, r) => n(e, t, r) >= 0
  }),
  le = r((e, t) => {
    let n = y()
    t.exports = (e, t, r) => n(e, t, r) <= 0
  }),
  ue = r((e, t) => {
    let n = oe(),
      r = se(),
      i = ie(),
      a = ce(),
      o = ae(),
      s = le()
    t.exports = (e, t, c, l) => {
      switch (t) {
        case `===`:
          return typeof e == `object` && (e = e.version), typeof c == `object` && (c = c.version), e === c
        case `!==`:
          return typeof e == `object` && (e = e.version), typeof c == `object` && (c = c.version), e !== c
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
  de = r((e, t) => {
    let n = l(),
      r = u(),
      { safeRe: i, t: a } = o()
    t.exports = (e, t) => {
      if (e instanceof n) return e
      if ((typeof e == `number` && (e = String(e)), typeof e != `string`)) return null
      t ||= {}
      let o = null
      if (!t.rtl) o = e.match(t.includePrerelease ? i[a.COERCEFULL] : i[a.COERCE])
      else {
        let n = t.includePrerelease ? i[a.COERCERTLFULL] : i[a.COERCERTL],
          r
        for (; (r = n.exec(e)) && (!o || o.index + o[0].length !== e.length); )
          (!o || r.index + r[0].length !== o.index + o[0].length) && (o = r),
            (n.lastIndex = r.index + r[1].length + r[2].length)
        n.lastIndex = -1
      }
      if (o === null) return null
      let s = o[2]
      return r(
        `${s}.${o[3] || `0`}.${o[4] || `0`}${t.includePrerelease && o[5] ? `-${o[5]}` : ``}${t.includePrerelease && o[6] ? `+${o[6]}` : ``}`,
        t
      )
    }
  }),
  fe = r((e, t) => {
    t.exports = class {
      constructor() {
        ;(this.max = 1e3), (this.map = new Map())
      }
      get(e) {
        let t = this.map.get(e)
        if (t !== void 0) return this.map.delete(e), this.map.set(e, t), t
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
  x = r((e, t) => {
    let n = /\s+/g
    t.exports = class e {
      constructor(t, r) {
        if (((r = c(r)), t instanceof e))
          return t.loose === !!r.loose && t.includePrerelease === !!r.includePrerelease ? t : new e(t.raw, r)
        if (t instanceof u) return (this.raw = t.value), (this.set = [[t]]), (this.formatted = void 0), this
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
          if (((this.set = this.set.filter((e) => !ee(e[0]))), this.set.length === 0)) this.set = [e]
          else if (this.set.length > 1) {
            for (let e of this.set)
              if (e.length === 1 && te(e[0])) {
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
              e > 0 && (this.formatted += ` `), (this.formatted += t[e].toString().trim())
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
        let t = ((this.options.includePrerelease && v) | (this.options.loose && y)) + `:` + e,
          n = r.get(t)
        if (n) return n
        let i = this.options.loose,
          a = i ? p[m.HYPHENRANGELOOSE] : p[m.HYPHENRANGE]
        ;(e = e.replace(a, x(this.options.includePrerelease))),
          d(`hyphen replace`, e),
          (e = e.replace(p[m.COMPARATORTRIM], h)),
          d(`comparator trim`, e),
          (e = e.replace(p[m.TILDETRIM], g)),
          d(`tilde trim`, e),
          (e = e.replace(p[m.CARETTRIM], _)),
          d(`caret trim`, e)
        let o = e
          .split(` `)
          .map((e) => re(e, this.options))
          .join(` `)
          .split(/\s+/)
          .map((e) => de(e, this.options))
        i && (o = o.filter((e) => (d(`loose invalid filter`, e, this.options), !!e.match(p[m.COMPARATORLOOSE])))),
          d(`range list`, o)
        let s = new Map(),
          c = o.map((e) => new u(e, this.options))
        for (let e of c) {
          if (ee(e)) return [e]
          s.set(e.value, e)
        }
        s.size > 1 && s.has(``) && s.delete(``)
        let l = [...s.values()]
        return r.set(t, l), l
      }
      intersects(t, n) {
        if (!(t instanceof e)) throw TypeError(`a Range is required`)
        return this.set.some(
          (e) => ne(e, n) && t.set.some((t) => ne(t, n) && e.every((e) => t.every((t) => e.intersects(t, n))))
        )
      }
      test(e) {
        if (!e) return !1
        if (typeof e == `string`)
          try {
            e = new f(e, this.options)
          } catch {
            return !1
          }
        for (let t = 0; t < this.set.length; t++) if (me(this.set[t], e, this.options)) return !0
        return !1
      }
    }
    let r = new (fe())(),
      c = s(),
      u = pe(),
      d = a(),
      f = l(),
      { safeRe: p, t: m, comparatorTrimReplace: h, tildeTrimReplace: g, caretTrimReplace: _ } = o(),
      { FLAG_INCLUDE_PRERELEASE: v, FLAG_LOOSE: y } = i(),
      ee = (e) => e.value === `<0.0.0-0`,
      te = (e) => e.value === ``,
      ne = (e, t) => {
        let n = !0,
          r = e.slice(),
          i = r.pop()
        for (; n && r.length; ) (n = r.every((e) => i.intersects(e, t))), (i = r.pop())
        return n
      },
      re = (e, t) => (
        d(`comp`, e, t),
        (e = oe(e, t)),
        d(`caret`, e),
        (e = ie(e, t)),
        d(`tildes`, e),
        (e = ce(e, t)),
        d(`xrange`, e),
        (e = ue(e, t)),
        d(`stars`, e),
        e
      ),
      b = (e) => !e || e.toLowerCase() === `x` || e === `*`,
      ie = (e, t) =>
        e
          .trim()
          .split(/\s+/)
          .map((e) => ae(e, t))
          .join(` `),
      ae = (e, t) => {
        let n = t.loose ? p[m.TILDELOOSE] : p[m.TILDE]
        return e.replace(n, (t, n, r, i, a) => {
          d(`tilde`, e, t, n, r, i, a)
          let o
          return (
            b(n)
              ? (o = ``)
              : b(r)
                ? (o = `>=${n}.0.0 <${+n + 1}.0.0-0`)
                : b(i)
                  ? (o = `>=${n}.${r}.0 <${n}.${+r + 1}.0-0`)
                  : a
                    ? (d(`replaceTilde pr`, a), (o = `>=${n}.${r}.${i}-${a} <${n}.${+r + 1}.0-0`))
                    : (o = `>=${n}.${r}.${i} <${n}.${+r + 1}.0-0`),
            d(`tilde return`, o),
            o
          )
        })
      },
      oe = (e, t) =>
        e
          .trim()
          .split(/\s+/)
          .map((e) => se(e, t))
          .join(` `),
      se = (e, t) => {
        d(`caret`, e, t)
        let n = t.loose ? p[m.CARETLOOSE] : p[m.CARET],
          r = t.includePrerelease ? `-0` : ``
        return e.replace(n, (t, n, i, a, o) => {
          d(`caret`, e, t, n, i, a, o)
          let s
          return (
            b(n)
              ? (s = ``)
              : b(i)
                ? (s = `>=${n}.0.0${r} <${+n + 1}.0.0-0`)
                : b(a)
                  ? (s = n === `0` ? `>=${n}.${i}.0${r} <${n}.${+i + 1}.0-0` : `>=${n}.${i}.0${r} <${+n + 1}.0.0-0`)
                  : o
                    ? (d(`replaceCaret pr`, o),
                      (s =
                        n === `0`
                          ? i === `0`
                            ? `>=${n}.${i}.${a}-${o} <${n}.${i}.${+a + 1}-0`
                            : `>=${n}.${i}.${a}-${o} <${n}.${+i + 1}.0-0`
                          : `>=${n}.${i}.${a}-${o} <${+n + 1}.0.0-0`))
                    : (d(`no pr`),
                      (s =
                        n === `0`
                          ? i === `0`
                            ? `>=${n}.${i}.${a}${r} <${n}.${i}.${+a + 1}-0`
                            : `>=${n}.${i}.${a}${r} <${n}.${+i + 1}.0-0`
                          : `>=${n}.${i}.${a} <${+n + 1}.0.0-0`)),
            d(`caret return`, s),
            s
          )
        })
      },
      ce = (e, t) => (
        d(`replaceXRanges`, e, t),
        e
          .split(/\s+/)
          .map((e) => le(e, t))
          .join(` `)
      ),
      le = (e, t) => {
        e = e.trim()
        let n = t.loose ? p[m.XRANGELOOSE] : p[m.XRANGE]
        return e.replace(n, (n, r, i, a, o, s) => {
          d(`xRange`, e, n, r, i, a, o, s)
          let c = b(i),
            l = c || b(a),
            u = l || b(o),
            f = u
          return (
            r === `=` && f && (r = ``),
            (s = t.includePrerelease ? `-0` : ``),
            c
              ? (n = r === `>` || r === `<` ? `<0.0.0-0` : `*`)
              : r && f
                ? (l && (a = 0),
                  (o = 0),
                  r === `>`
                    ? ((r = `>=`), l ? ((i = +i + 1), (a = 0), (o = 0)) : ((a = +a + 1), (o = 0)))
                    : r === `<=` && ((r = `<`), l ? (i = +i + 1) : (a = +a + 1)),
                  r === `<` && (s = `-0`),
                  (n = `${r + i}.${a}.${o}${s}`))
                : l
                  ? (n = `>=${i}.0.0${s} <${+i + 1}.0.0-0`)
                  : u && (n = `>=${i}.${a}.0${s} <${i}.${+a + 1}.0-0`),
            d(`xRange return`, n),
            n
          )
        })
      },
      ue = (e, t) => (d(`replaceStars`, e, t), e.trim().replace(p[m.STAR], ``)),
      de = (e, t) => (d(`replaceGTE0`, e, t), e.trim().replace(p[t.includePrerelease ? m.GTE0PRE : m.GTE0], ``)),
      x = (e) => (t, n, r, i, a, o, s, c, l, u, d, f) => (
        (n = b(r)
          ? ``
          : b(i)
            ? `>=${r}.0.0${e ? `-0` : ``}`
            : b(a)
              ? `>=${r}.${i}.0${e ? `-0` : ``}`
              : o
                ? `>=${n}`
                : `>=${n}${e ? `-0` : ``}`),
        (c = b(l)
          ? ``
          : b(u)
            ? `<${+l + 1}.0.0-0`
            : b(d)
              ? `<${l}.${+u + 1}.0-0`
              : f
                ? `<=${l}.${u}.${d}-${f}`
                : e
                  ? `<${l}.${u}.${+d + 1}-0`
                  : `<=${c}`),
        `${n} ${c}`.trim()
      ),
      me = (e, t, n) => {
        for (let n = 0; n < e.length; n++) if (!e[n].test(t)) return !1
        if (t.prerelease.length && !n.includePrerelease) {
          for (let n = 0; n < e.length; n++)
            if ((d(e[n].semver), e[n].semver !== u.ANY && e[n].semver.prerelease.length > 0)) {
              let r = e[n].semver
              if (r.major === t.major && r.minor === t.minor && r.patch === t.patch) return !0
            }
          return !1
        }
        return !0
      }
  }),
  pe = r((e, t) => {
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
        ;(t = t.trim().split(/\s+/).join(` `)),
          d(`comparator`, t, i),
          (this.options = i),
          (this.loose = !!i.loose),
          this.parse(t),
          this.semver === n ? (this.value = ``) : (this.value = this.operator + this.semver.version),
          d(`comp`, this)
      }
      parse(e) {
        let t = this.options.loose ? i[c.COMPARATORLOOSE] : i[c.COMPARATOR],
          r = e.match(t)
        if (!r) throw TypeError(`Invalid comparator: ${e}`)
        ;(this.operator = r[1] === void 0 ? `` : r[1]),
          this.operator === `=` && (this.operator = ``),
          r[2] ? (this.semver = new f(r[2], this.options.loose)) : (this.semver = n)
      }
      toString() {
        return this.value
      }
      test(e) {
        if ((d(`Comparator.test`, e, this.options.loose), this.semver === n || e === n)) return !0
        if (typeof e == `string`)
          try {
            e = new f(e, this.options)
          } catch {
            return !1
          }
        return u(e, this.operator, this.semver, this.options)
      }
      intersects(t, n) {
        if (!(t instanceof e)) throw TypeError(`a Comparator is required`)
        return this.operator === ``
          ? this.value === ``
            ? !0
            : new p(t.value, n).test(this.value)
          : t.operator === ``
            ? t.value === ``
              ? !0
              : new p(this.value, n).test(t.semver)
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
                    (u(this.semver, `<`, t.semver, n) && this.operator.startsWith(`>`) && t.operator.startsWith(`<`)) ||
                    (u(this.semver, `>`, t.semver, n) && this.operator.startsWith(`<`) && t.operator.startsWith(`>`))
                  ))
      }
    }
    let r = s(),
      { safeRe: i, t: c } = o(),
      u = ue(),
      d = a(),
      f = l(),
      p = x()
  }),
  me = r((e, t) => {
    let n = x()
    t.exports = (e, t, r) => {
      try {
        t = new n(t, r)
      } catch {
        return !1
      }
      return t.test(e)
    }
  }),
  he = r((e, t) => {
    let n = x()
    t.exports = (e, t) =>
      new n(e, t).set.map((e) =>
        e
          .map((e) => e.value)
          .join(` `)
          .trim()
          .split(` `)
      )
  }),
  ge = r((e, t) => {
    let n = l(),
      r = x()
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
  _e = r((e, t) => {
    let n = l(),
      r = x()
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
  ve = r((e, t) => {
    let n = l(),
      r = x(),
      i = ie()
    t.exports = (e, t) => {
      e = new r(e, t)
      let a = new n(`0.0.0`)
      if (e.test(a) || ((a = new n(`0.0.0-0`)), e.test(a))) return a
      a = null
      for (let t = 0; t < e.set.length; ++t) {
        let r = e.set[t],
          o = null
        r.forEach((e) => {
          let t = new n(e.semver.version)
          switch (e.operator) {
            case `>`:
              t.prerelease.length === 0 ? t.patch++ : t.prerelease.push(0), (t.raw = t.format())
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
          o && (!a || i(a, o)) && (a = o)
      }
      return a && e.test(a) ? a : null
    }
  }),
  ye = r((e, t) => {
    let n = x()
    t.exports = (e, t) => {
      try {
        return new n(e, t).range || `*`
      } catch {
        return null
      }
    }
  }),
  be = r((e, t) => {
    let n = l(),
      r = pe(),
      { ANY: i } = r,
      a = x(),
      o = me(),
      s = ie(),
      c = ae(),
      u = le(),
      d = ce()
    t.exports = (e, t, l, f) => {
      ;(e = new n(e, f)), (t = new a(t, f))
      let p, m, h, g, _
      switch (l) {
        case `>`:
          ;(p = s), (m = u), (h = c), (g = `>`), (_ = `>=`)
          break
        case `<`:
          ;(p = c), (m = d), (h = s), (g = `<`), (_ = `<=`)
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
            e.semver === i && (e = new r(`>=0.0.0`)),
              (o ||= e),
              (s ||= e),
              p(e.semver, o.semver, f) ? (o = e) : h(e.semver, s.semver, f) && (s = e)
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
  xe = r((e, t) => {
    let n = be()
    t.exports = (e, t, r) => n(e, t, `>`, r)
  }),
  Se = r((e, t) => {
    let n = be()
    t.exports = (e, t, r) => n(e, t, `<`, r)
  }),
  Ce = r((e, t) => {
    let n = x()
    t.exports = (e, t, r) => ((e = new n(e, r)), (t = new n(t, r)), e.intersects(t, r))
  }),
  we = r((e, t) => {
    let n = me(),
      r = y()
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
  Te = r((e, t) => {
    let n = x(),
      r = pe(),
      { ANY: i } = r,
      a = me(),
      o = y(),
      s = (e, t, r = {}) => {
        if (e === t) return !0
        ;(e = new n(e, r)), (t = new n(t, r))
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
  }),
  Ee = r((e, t) => {
    let n = o(),
      r = i(),
      a = l(),
      s = c()
    t.exports = {
      parse: u(),
      valid: d(),
      clean: f(),
      inc: p(),
      diff: m(),
      major: h(),
      minor: g(),
      patch: _(),
      prerelease: v(),
      compare: y(),
      rcompare: ee(),
      compareLoose: te(),
      compareBuild: ne(),
      sort: re(),
      rsort: b(),
      gt: ie(),
      lt: ae(),
      eq: oe(),
      neq: se(),
      gte: ce(),
      lte: le(),
      cmp: ue(),
      coerce: de(),
      Comparator: pe(),
      Range: x(),
      satisfies: me(),
      toComparators: he(),
      maxSatisfying: ge(),
      minSatisfying: _e(),
      minVersion: ve(),
      validRange: ye(),
      outside: be(),
      gtr: xe(),
      ltr: Se(),
      intersects: Ce(),
      simplifyRange: we(),
      subset: Te(),
      SemVer: a,
      re: n.re,
      src: n.src,
      tokens: n.t,
      SEMVER_SPEC_VERSION: r.SEMVER_SPEC_VERSION,
      RELEASE_TYPES: r.RELEASE_TYPES,
      compareIdentifiers: s.compareIdentifiers,
      rcompareIdentifiers: s.rcompareIdentifiers
    }
  })
Object.freeze({ status: `aborted` })
function S(e, t, n) {
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
var De = class extends Error {
    constructor() {
      super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`)
    }
  },
  Oe = class extends Error {
    constructor(e) {
      super(`Encountered unidirectional transform during encode: ${e}`), (this.name = `ZodEncodeError`)
    }
  }
const ke = {}
function C(e) {
  return e && Object.assign(ke, e), ke
}
function Ae(e) {
  let t = Object.values(e).filter((e) => typeof e == `number`)
  return Object.entries(e)
    .filter(([e, n]) => t.indexOf(+e) === -1)
    .map(([e, t]) => t)
}
function je(e, t) {
  return typeof t == `bigint` ? t.toString() : t
}
function Me(e) {
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
function Ne(e) {
  return e == null
}
function Pe(e) {
  let t = e.startsWith(`^`) ? 1 : 0,
    n = e.endsWith(`$`) ? e.length - 1 : e.length
  return e.slice(t, n)
}
function Fe(e, t) {
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
const Ie = Symbol(`evaluating`)
function w(e, t, n) {
  let r
  Object.defineProperty(e, t, {
    get() {
      if (r !== Ie) return r === void 0 && ((r = Ie), (r = n())), r
    },
    set(n) {
      Object.defineProperty(e, t, { value: n })
    },
    configurable: !0
  })
}
function T(e, t, n) {
  Object.defineProperty(e, t, { value: n, writable: !0, enumerable: !0, configurable: !0 })
}
function E(...e) {
  let t = {}
  for (let n of e) {
    let e = Object.getOwnPropertyDescriptors(n)
    Object.assign(t, e)
  }
  return Object.defineProperties({}, t)
}
function Le(e) {
  return JSON.stringify(e)
}
function Re(e) {
  return e
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, ``)
    .replace(/[\s_-]+/g, `-`)
    .replace(/^-+|-+$/g, ``)
}
const ze = `captureStackTrace` in Error ? Error.captureStackTrace : (...e) => {}
function Be(e) {
  return typeof e == `object` && !!e && !Array.isArray(e)
}
const Ve = Me(() => {
  if (typeof navigator < `u` && navigator?.userAgent?.includes(`Cloudflare`)) return !1
  try {
    return Function(``), !0
  } catch {
    return !1
  }
})
function D(e) {
  if (Be(e) === !1) return !1
  let t = e.constructor
  if (t === void 0 || typeof t != `function`) return !0
  let n = t.prototype
  return !(Be(n) === !1 || Object.prototype.hasOwnProperty.call(n, `isPrototypeOf`) === !1)
}
function He(e) {
  return D(e) ? { ...e } : Array.isArray(e) ? [...e] : e
}
const Ue = new Set([`string`, `number`, `symbol`])
function We(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
}
function O(e, t, n) {
  let r = new e._zod.constr(t ?? e._zod.def)
  return (!t || n?.parent) && (r._zod.parent = e), r
}
function k(e) {
  let t = e
  if (!t) return {}
  if (typeof t == `string`) return { error: () => t }
  if (t?.message !== void 0) {
    if (t?.error !== void 0) throw Error('Cannot specify both `message` and `error` params')
    t.error = t.message
  }
  return delete t.message, typeof t.error == `string` ? { ...t, error: () => t.error } : t
}
function Ge(e) {
  return Object.keys(e).filter((t) => e[t]._zod.optin === `optional` && e[t]._zod.optout === `optional`)
}
const Ke = {
  safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}
function qe(e, t) {
  let n = e._zod.def,
    r = n.checks
  if (r && r.length > 0) throw Error(`.pick() cannot be used on object schemas containing refinements`)
  return O(
    e,
    E(e._zod.def, {
      get shape() {
        let e = {}
        for (let r in t) {
          if (!(r in n.shape)) throw Error(`Unrecognized key: "${r}"`)
          t[r] && (e[r] = n.shape[r])
        }
        return T(this, `shape`, e), e
      },
      checks: []
    })
  )
}
function Je(e, t) {
  let n = e._zod.def,
    r = n.checks
  if (r && r.length > 0) throw Error(`.omit() cannot be used on object schemas containing refinements`)
  return O(
    e,
    E(e._zod.def, {
      get shape() {
        let r = { ...e._zod.def.shape }
        for (let e in t) {
          if (!(e in n.shape)) throw Error(`Unrecognized key: "${e}"`)
          t[e] && delete r[e]
        }
        return T(this, `shape`, r), r
      },
      checks: []
    })
  )
}
function Ye(e, t) {
  if (!D(t)) throw Error(`Invalid input to extend: expected a plain object`)
  let n = e._zod.def.checks
  if (n && n.length > 0) {
    let n = e._zod.def.shape
    for (let e in t)
      if (Object.getOwnPropertyDescriptor(n, e) !== void 0)
        throw Error('Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.')
  }
  return O(
    e,
    E(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t }
        return T(this, `shape`, n), n
      }
    })
  )
}
function Xe(e, t) {
  if (!D(t)) throw Error(`Invalid input to safeExtend: expected a plain object`)
  return O(
    e,
    E(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t }
        return T(this, `shape`, n), n
      }
    })
  )
}
function Ze(e, t) {
  return O(
    e,
    E(e._zod.def, {
      get shape() {
        let n = { ...e._zod.def.shape, ...t._zod.def.shape }
        return T(this, `shape`, n), n
      },
      get catchall() {
        return t._zod.def.catchall
      },
      checks: []
    })
  )
}
function Qe(e, t, n) {
  let r = t._zod.def.checks
  if (r && r.length > 0) throw Error(`.partial() cannot be used on object schemas containing refinements`)
  return O(
    t,
    E(t._zod.def, {
      get shape() {
        let r = t._zod.def.shape,
          i = { ...r }
        if (n)
          for (let t in n) {
            if (!(t in r)) throw Error(`Unrecognized key: "${t}"`)
            n[t] && (i[t] = e ? new e({ type: `optional`, innerType: r[t] }) : r[t])
          }
        else for (let t in r) i[t] = e ? new e({ type: `optional`, innerType: r[t] }) : r[t]
        return T(this, `shape`, i), i
      },
      checks: []
    })
  )
}
function $e(e, t, n) {
  return O(
    t,
    E(t._zod.def, {
      get shape() {
        let r = t._zod.def.shape,
          i = { ...r }
        if (n)
          for (let t in n) {
            if (!(t in i)) throw Error(`Unrecognized key: "${t}"`)
            n[t] && (i[t] = new e({ type: `nonoptional`, innerType: r[t] }))
          }
        else for (let t in r) i[t] = new e({ type: `nonoptional`, innerType: r[t] })
        return T(this, `shape`, i), i
      }
    })
  )
}
function et(e, t = 0) {
  if (e.aborted === !0) return !0
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0
  return !1
}
function tt(e, t) {
  return t.map((t) => {
    var n
    return (n = t).path ?? (n.path = []), t.path.unshift(e), t
  })
}
function nt(e) {
  return typeof e == `string` ? e : e?.message
}
function A(e, t, n) {
  let r = { ...e, path: e.path ?? [] }
  return (
    e.message ||
      (r.message =
        nt(e.inst?._zod.def?.error?.(e)) ??
        nt(t?.error?.(e)) ??
        nt(n.customError?.(e)) ??
        nt(n.localeError?.(e)) ??
        `Invalid input`),
    delete r.inst,
    delete r.continue,
    t?.reportInput || delete r.input,
    r
  )
}
function rt(e) {
  return Array.isArray(e) ? `array` : typeof e == `string` ? `string` : `unknown`
}
function it(...e) {
  let [t, n, r] = e
  return typeof t == `string` ? { message: t, code: `custom`, input: n, inst: r } : { ...t }
}
const at = (e, t) => {
    ;(e.name = `$ZodError`),
      Object.defineProperty(e, `_zod`, { value: e._zod, enumerable: !1 }),
      Object.defineProperty(e, `issues`, { value: t, enumerable: !1 }),
      (e.message = JSON.stringify(t, je, 2)),
      Object.defineProperty(e, `toString`, { value: () => e.message, enumerable: !1 })
  },
  ot = S(`$ZodError`, at),
  st = S(`$ZodError`, at, { Parent: Error })
function ct(e, t = (e) => e.message) {
  let n = {},
    r = []
  for (let i of e.issues)
    i.path.length > 0 ? ((n[i.path[0]] = n[i.path[0]] || []), n[i.path[0]].push(t(i))) : r.push(t(i))
  return { formErrors: r, fieldErrors: n }
}
function lt(e, t = (e) => e.message) {
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
const ut = (e) => (t, n, r, i) => {
    let a = r ? Object.assign(r, { async: !1 }) : { async: !1 },
      o = t._zod.run({ value: n, issues: [] }, a)
    if (o instanceof Promise) throw new De()
    if (o.issues.length) {
      let t = new (i?.Err ?? e)(o.issues.map((e) => A(e, a, C())))
      throw (ze(t, i?.callee), t)
    }
    return o.value
  },
  dt = (e) => async (t, n, r, i) => {
    let a = r ? Object.assign(r, { async: !0 }) : { async: !0 },
      o = t._zod.run({ value: n, issues: [] }, a)
    if ((o instanceof Promise && (o = await o), o.issues.length)) {
      let t = new (i?.Err ?? e)(o.issues.map((e) => A(e, a, C())))
      throw (ze(t, i?.callee), t)
    }
    return o.value
  },
  ft = (e) => (t, n, r) => {
    let i = r ? { ...r, async: !1 } : { async: !1 },
      a = t._zod.run({ value: n, issues: [] }, i)
    if (a instanceof Promise) throw new De()
    return a.issues.length
      ? { success: !1, error: new (e ?? ot)(a.issues.map((e) => A(e, i, C()))) }
      : { success: !0, data: a.value }
  },
  pt = ft(st),
  mt = (e) => async (t, n, r) => {
    let i = r ? Object.assign(r, { async: !0 }) : { async: !0 },
      a = t._zod.run({ value: n, issues: [] }, i)
    return (
      a instanceof Promise && (a = await a),
      a.issues.length
        ? { success: !1, error: new e(a.issues.map((e) => A(e, i, C()))) }
        : { success: !0, data: a.value }
    )
  },
  ht = mt(st),
  gt = (e) => (t, n, r) => {
    let i = r ? Object.assign(r, { direction: `backward` }) : { direction: `backward` }
    return ut(e)(t, n, i)
  },
  _t = (e) => (t, n, r) => ut(e)(t, n, r),
  vt = (e) => async (t, n, r) => {
    let i = r ? Object.assign(r, { direction: `backward` }) : { direction: `backward` }
    return dt(e)(t, n, i)
  },
  yt = (e) => async (t, n, r) => dt(e)(t, n, r),
  bt = (e) => (t, n, r) => {
    let i = r ? Object.assign(r, { direction: `backward` }) : { direction: `backward` }
    return ft(e)(t, n, i)
  },
  xt = (e) => (t, n, r) => ft(e)(t, n, r),
  St = (e) => async (t, n, r) => {
    let i = r ? Object.assign(r, { direction: `backward` }) : { direction: `backward` }
    return mt(e)(t, n, i)
  },
  Ct = (e) => async (t, n, r) => mt(e)(t, n, r),
  wt = /^[cC][^\s-]{8,}$/,
  Tt = /^[0-9a-z]+$/,
  Et = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/,
  Dt = /^[0-9a-vA-V]{20}$/,
  Ot = /^[A-Za-z0-9]{27}$/,
  kt = /^[a-zA-Z0-9_-]{21}$/,
  At = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/,
  jt = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  Mt = (e) =>
    e
      ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`)
      : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/,
  Nt = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/
function Pt() {
  return RegExp(`^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`, `u`)
}
const Ft =
    /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
  It =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/,
  Lt =
    /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/,
  Rt =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
  zt = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/,
  Bt = /^[A-Za-z0-9_-]*$/,
  Vt = /^\+[1-9]\d{6,14}$/,
  Ht = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`,
  Ut = RegExp(`^${Ht}$`)
function Wt(e) {
  let t = `(?:[01]\\d|2[0-3]):[0-5]\\d`
  return typeof e.precision == `number`
    ? e.precision === -1
      ? `${t}`
      : e.precision === 0
        ? `${t}:[0-5]\\d`
        : `${t}:[0-5]\\d\\.\\d{${e.precision}}`
    : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`
}
function Gt(e) {
  return RegExp(`^${Wt(e)}$`)
}
function Kt(e) {
  let t = Wt({ precision: e.precision }),
    n = [`Z`]
  e.local && n.push(``), e.offset && n.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`)
  let r = `${t}(?:${n.join(`|`)})`
  return RegExp(`^${Ht}T(?:${r})$`)
}
const qt = (e) => {
    let t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ``}}` : `[\\s\\S]*`
    return RegExp(`^${t}$`)
  },
  Jt = /^-?\d+$/,
  Yt = /^-?\d+(?:\.\d+)?$/,
  Xt = /^(?:true|false)$/i,
  Zt = /^[^A-Z]*$/,
  Qt = /^[^a-z]*$/,
  j = S(`$ZodCheck`, (e, t) => {
    var n
    ;(e._zod ??= {}), (e._zod.def = t), (n = e._zod).onattach ?? (n.onattach = [])
  }),
  $t = { number: `number`, bigint: `bigint`, object: `date` },
  en = S(`$ZodCheckLessThan`, (e, t) => {
    j.init(e, t)
    let n = $t[typeof t.value]
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
  tn = S(`$ZodCheckGreaterThan`, (e, t) => {
    j.init(e, t)
    let n = $t[typeof t.value]
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
  nn = S(`$ZodCheckMultipleOf`, (e, t) => {
    j.init(e, t),
      e._zod.onattach.push((e) => {
        var n
        ;(n = e._zod.bag).multipleOf ?? (n.multipleOf = t.value)
      }),
      (e._zod.check = (n) => {
        if (typeof n.value != typeof t.value) throw Error(`Cannot mix number and bigint in multiple_of check.`)
        ;(typeof n.value == `bigint` ? n.value % t.value === BigInt(0) : Fe(n.value, t.value) === 0) ||
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
  rn = S(`$ZodCheckNumberFormat`, (e, t) => {
    j.init(e, t), (t.format = t.format || `float64`)
    let n = t.format?.includes(`int`),
      r = n ? `int` : `number`,
      [i, a] = Ke[t.format]
    e._zod.onattach.push((e) => {
      let r = e._zod.bag
      ;(r.format = t.format), (r.minimum = i), (r.maximum = a), n && (r.pattern = Jt)
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
  an = S(`$ZodCheckMaxLength`, (e, t) => {
    var n
    j.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !Ne(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag.maximum ?? 1 / 0
        t.maximum < n && (e._zod.bag.maximum = t.maximum)
      }),
      (e._zod.check = (n) => {
        let r = n.value
        if (r.length <= t.maximum) return
        let i = rt(r)
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
  on = S(`$ZodCheckMinLength`, (e, t) => {
    var n
    j.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !Ne(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag.minimum ?? -1 / 0
        t.minimum > n && (e._zod.bag.minimum = t.minimum)
      }),
      (e._zod.check = (n) => {
        let r = n.value
        if (r.length >= t.minimum) return
        let i = rt(r)
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
  sn = S(`$ZodCheckLengthEquals`, (e, t) => {
    var n
    j.init(e, t),
      (n = e._zod.def).when ??
        (n.when = (e) => {
          let t = e.value
          return !Ne(t) && t.length !== void 0
        }),
      e._zod.onattach.push((e) => {
        let n = e._zod.bag
        ;(n.minimum = t.length), (n.maximum = t.length), (n.length = t.length)
      }),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length
        if (i === t.length) return
        let a = rt(r),
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
  cn = S(`$ZodCheckStringFormat`, (e, t) => {
    var n, r
    j.init(e, t),
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
  ln = S(`$ZodCheckRegex`, (e, t) => {
    cn.init(e, t),
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
  un = S(`$ZodCheckLowerCase`, (e, t) => {
    ;(t.pattern ??= Zt), cn.init(e, t)
  }),
  dn = S(`$ZodCheckUpperCase`, (e, t) => {
    ;(t.pattern ??= Qt), cn.init(e, t)
  }),
  fn = S(`$ZodCheckIncludes`, (e, t) => {
    j.init(e, t)
    let n = We(t.includes),
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
  pn = S(`$ZodCheckStartsWith`, (e, t) => {
    j.init(e, t)
    let n = RegExp(`^${We(t.prefix)}.*`)
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
  mn = S(`$ZodCheckEndsWith`, (e, t) => {
    j.init(e, t)
    let n = RegExp(`.*${We(t.suffix)}$`)
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
  hn = S(`$ZodCheckOverwrite`, (e, t) => {
    j.init(e, t),
      (e._zod.check = (e) => {
        e.value = t.tx(e.value)
      })
  })
var gn = class {
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
const _n = { major: 4, minor: 3, patch: 6 },
  M = S(`$ZodType`, (e, t) => {
    var n
    ;(e ??= {}), (e._zod.def = t), (e._zod.bag = e._zod.bag || {}), (e._zod.version = _n)
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
          let r = et(e),
            i
          for (let a of t) {
            if (a._zod.def.when) {
              if (!a._zod.def.when(e)) continue
            } else if (r) continue
            let t = e.issues.length,
              o = a._zod.check(e)
            if (o instanceof Promise && n?.async === !1) throw new De()
            if (i || o instanceof Promise)
              i = (i ?? Promise.resolve()).then(async () => {
                await o, e.issues.length !== t && (r ||= et(e, t))
              })
            else {
              if (e.issues.length === t) continue
              r ||= et(e, t)
            }
          }
          return i ? i.then(() => e) : e
        },
        n = (n, i, a) => {
          if (et(n)) return (n.aborted = !0), n
          let o = t(i, r, a)
          if (o instanceof Promise) {
            if (a.async === !1) throw new De()
            return o.then((t) => e._zod.parse(t, a))
          }
          return e._zod.parse(o, a)
        }
      e._zod.run = (i, a) => {
        if (a.skipChecks) return e._zod.parse(i, a)
        if (a.direction === `backward`) {
          let t = e._zod.parse({ value: i.value, issues: [] }, { ...a, skipChecks: !0 })
          return t instanceof Promise ? t.then((e) => n(e, i, a)) : n(t, i, a)
        }
        let o = e._zod.parse(i, a)
        if (o instanceof Promise) {
          if (a.async === !1) throw new De()
          return o.then((e) => t(e, r, a))
        }
        return t(o, r, a)
      }
    }
    w(e, `~standard`, () => ({
      validate: (t) => {
        try {
          let n = pt(e, t)
          return n.success ? { value: n.data } : { issues: n.error?.issues }
        } catch {
          return ht(e, t).then((e) => (e.success ? { value: e.data } : { issues: e.error?.issues }))
        }
      },
      vendor: `zod`,
      version: 1
    }))
  }),
  vn = S(`$ZodString`, (e, t) => {
    M.init(e, t),
      (e._zod.pattern = [...(e?._zod.bag?.patterns ?? [])].pop() ?? qt(e._zod.bag)),
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
  N = S(`$ZodStringFormat`, (e, t) => {
    cn.init(e, t), vn.init(e, t)
  }),
  yn = S(`$ZodGUID`, (e, t) => {
    ;(t.pattern ??= jt), N.init(e, t)
  }),
  bn = S(`$ZodUUID`, (e, t) => {
    if (t.version) {
      let e = { v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7, v8: 8 }[t.version]
      if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`)
      t.pattern ??= Mt(e)
    } else t.pattern ??= Mt()
    N.init(e, t)
  }),
  xn = S(`$ZodEmail`, (e, t) => {
    ;(t.pattern ??= Nt), N.init(e, t)
  }),
  Sn = S(`$ZodURL`, (e, t) => {
    N.init(e, t),
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
  Cn = S(`$ZodEmoji`, (e, t) => {
    ;(t.pattern ??= Pt()), N.init(e, t)
  }),
  wn = S(`$ZodNanoID`, (e, t) => {
    ;(t.pattern ??= kt), N.init(e, t)
  }),
  Tn = S(`$ZodCUID`, (e, t) => {
    ;(t.pattern ??= wt), N.init(e, t)
  }),
  En = S(`$ZodCUID2`, (e, t) => {
    ;(t.pattern ??= Tt), N.init(e, t)
  }),
  Dn = S(`$ZodULID`, (e, t) => {
    ;(t.pattern ??= Et), N.init(e, t)
  }),
  On = S(`$ZodXID`, (e, t) => {
    ;(t.pattern ??= Dt), N.init(e, t)
  }),
  kn = S(`$ZodKSUID`, (e, t) => {
    ;(t.pattern ??= Ot), N.init(e, t)
  }),
  An = S(`$ZodISODateTime`, (e, t) => {
    ;(t.pattern ??= Kt(t)), N.init(e, t)
  }),
  jn = S(`$ZodISODate`, (e, t) => {
    ;(t.pattern ??= Ut), N.init(e, t)
  }),
  Mn = S(`$ZodISOTime`, (e, t) => {
    ;(t.pattern ??= Gt(t)), N.init(e, t)
  }),
  Nn = S(`$ZodISODuration`, (e, t) => {
    ;(t.pattern ??= At), N.init(e, t)
  }),
  Pn = S(`$ZodIPv4`, (e, t) => {
    ;(t.pattern ??= Ft), N.init(e, t), (e._zod.bag.format = `ipv4`)
  }),
  Fn = S(`$ZodIPv6`, (e, t) => {
    ;(t.pattern ??= It),
      N.init(e, t),
      (e._zod.bag.format = `ipv6`),
      (e._zod.check = (n) => {
        try {
          new URL(`http://[${n.value}]`)
        } catch {
          n.issues.push({ code: `invalid_format`, format: `ipv6`, input: n.value, inst: e, continue: !t.abort })
        }
      })
  }),
  In = S(`$ZodCIDRv4`, (e, t) => {
    ;(t.pattern ??= Lt), N.init(e, t)
  }),
  Ln = S(`$ZodCIDRv6`, (e, t) => {
    ;(t.pattern ??= Rt),
      N.init(e, t),
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
function Rn(e) {
  if (e === ``) return !0
  if (e.length % 4 != 0) return !1
  try {
    return atob(e), !0
  } catch {
    return !1
  }
}
const zn = S(`$ZodBase64`, (e, t) => {
  ;(t.pattern ??= zt),
    N.init(e, t),
    (e._zod.bag.contentEncoding = `base64`),
    (e._zod.check = (n) => {
      Rn(n.value) ||
        n.issues.push({ code: `invalid_format`, format: `base64`, input: n.value, inst: e, continue: !t.abort })
    })
})
function Bn(e) {
  if (!Bt.test(e)) return !1
  let t = e.replace(/[-_]/g, (e) => (e === `-` ? `+` : `/`))
  return Rn(t.padEnd(Math.ceil(t.length / 4) * 4, `=`))
}
const Vn = S(`$ZodBase64URL`, (e, t) => {
    ;(t.pattern ??= Bt),
      N.init(e, t),
      (e._zod.bag.contentEncoding = `base64url`),
      (e._zod.check = (n) => {
        Bn(n.value) ||
          n.issues.push({ code: `invalid_format`, format: `base64url`, input: n.value, inst: e, continue: !t.abort })
      })
  }),
  Hn = S(`$ZodE164`, (e, t) => {
    ;(t.pattern ??= Vt), N.init(e, t)
  })
function Un(e, t = null) {
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
const Wn = S(`$ZodJWT`, (e, t) => {
    N.init(e, t),
      (e._zod.check = (n) => {
        Un(n.value, t.alg) ||
          n.issues.push({ code: `invalid_format`, format: `jwt`, input: n.value, inst: e, continue: !t.abort })
      })
  }),
  Gn = S(`$ZodNumber`, (e, t) => {
    M.init(e, t),
      (e._zod.pattern = e._zod.bag.pattern ?? Yt),
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
  Kn = S(`$ZodNumberFormat`, (e, t) => {
    rn.init(e, t), Gn.init(e, t)
  }),
  qn = S(`$ZodBoolean`, (e, t) => {
    M.init(e, t),
      (e._zod.pattern = Xt),
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
  Jn = S(`$ZodUnknown`, (e, t) => {
    M.init(e, t), (e._zod.parse = (e) => e)
  }),
  Yn = S(`$ZodNever`, (e, t) => {
    M.init(e, t),
      (e._zod.parse = (t, n) => (
        t.issues.push({ expected: `never`, code: `invalid_type`, input: t.value, inst: e }), t
      ))
  })
function Xn(e, t, n) {
  e.issues.length && t.issues.push(...tt(n, e.issues)), (t.value[n] = e.value)
}
const Zn = S(`$ZodArray`, (e, t) => {
  M.init(e, t),
    (e._zod.parse = (n, r) => {
      let i = n.value
      if (!Array.isArray(i)) return n.issues.push({ expected: `array`, code: `invalid_type`, input: i, inst: e }), n
      n.value = Array(i.length)
      let a = []
      for (let e = 0; e < i.length; e++) {
        let o = i[e],
          s = t.element._zod.run({ value: o, issues: [] }, r)
        s instanceof Promise ? a.push(s.then((t) => Xn(t, n, e))) : Xn(s, n, e)
      }
      return a.length ? Promise.all(a).then(() => n) : n
    })
})
function Qn(e, t, n, r, i) {
  if (e.issues.length) {
    if (i && !(n in r)) return
    t.issues.push(...tt(n, e.issues))
  }
  e.value === void 0 ? n in r && (t.value[n] = void 0) : (t.value[n] = e.value)
}
function $n(e) {
  let t = Object.keys(e.shape)
  for (let n of t)
    if (!e.shape?.[n]?._zod?.traits?.has(`$ZodType`))
      throw Error(`Invalid element at key "${n}": expected a Zod schema`)
  let n = Ge(e.shape)
  return { ...e, keys: t, keySet: new Set(t), numKeys: t.length, optionalKeys: new Set(n) }
}
function er(e, t, n, r, i, a) {
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
    a instanceof Promise ? e.push(a.then((e) => Qn(e, n, i, t, u))) : Qn(a, n, i, t, u)
  }
  return (
    o.length && n.issues.push({ code: `unrecognized_keys`, keys: o, input: t, inst: a }),
    e.length ? Promise.all(e).then(() => n) : n
  )
}
const tr = S(`$ZodObject`, (e, t) => {
    if ((M.init(e, t), !Object.getOwnPropertyDescriptor(t, `shape`)?.get)) {
      let e = t.shape
      Object.defineProperty(t, `shape`, {
        get: () => {
          let n = { ...e }
          return Object.defineProperty(t, `shape`, { value: n }), n
        }
      })
    }
    let n = Me(() => $n(t))
    w(e._zod, `propValues`, () => {
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
    let r = Be,
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
        i instanceof Promise ? c.push(i.then((n) => Qn(n, t, e, s, r))) : Qn(i, t, e, s, r)
      }
      return i ? er(c, s, t, o, n.value, e) : c.length ? Promise.all(c).then(() => t) : t
    }
  }),
  nr = S(`$ZodObjectJIT`, (e, t) => {
    tr.init(e, t)
    let n = e._zod.parse,
      r = Me(() => $n(t)),
      i = (e) => {
        let t = new gn([`shape`, `payload`, `ctx`]),
          n = r.value,
          i = (e) => {
            let t = Le(e)
            return `shape[${t}]._zod.run({ value: input[${t}], issues: [] }, ctx)`
          }
        t.write(`const input = payload.value;`)
        let a = Object.create(null),
          o = 0
        for (let e of n.keys) a[e] = `key_${o++}`
        t.write(`const newResult = {};`)
        for (let r of n.keys) {
          let n = a[r],
            o = Le(r),
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
      o = Be,
      s = !ke.jitless,
      c = s && Ve.value,
      l = t.catchall,
      u
    e._zod.parse = (d, f) => {
      u ??= r.value
      let p = d.value
      return o(p)
        ? s && c && f?.async === !1 && f.jitless !== !0
          ? ((a ||= i(t.shape)), (d = a(d, f)), l ? er([], p, d, f, u, e) : d)
          : n(d, f)
        : (d.issues.push({ expected: `object`, code: `invalid_type`, input: p, inst: e }), d)
    }
  })
function rr(e, t, n, r) {
  for (let n of e) if (n.issues.length === 0) return (t.value = n.value), t
  let i = e.filter((e) => !et(e))
  return i.length === 1
    ? ((t.value = i[0].value), i[0])
    : (t.issues.push({
        code: `invalid_union`,
        input: t.value,
        inst: n,
        errors: e.map((e) => e.issues.map((e) => A(e, r, C())))
      }),
      t)
}
const ir = S(`$ZodUnion`, (e, t) => {
    M.init(e, t),
      w(e._zod, `optin`, () => (t.options.some((e) => e._zod.optin === `optional`) ? `optional` : void 0)),
      w(e._zod, `optout`, () => (t.options.some((e) => e._zod.optout === `optional`) ? `optional` : void 0)),
      w(e._zod, `values`, () => {
        if (t.options.every((e) => e._zod.values)) return new Set(t.options.flatMap((e) => Array.from(e._zod.values)))
      }),
      w(e._zod, `pattern`, () => {
        if (t.options.every((e) => e._zod.pattern)) {
          let e = t.options.map((e) => e._zod.pattern)
          return RegExp(`^(${e.map((e) => Pe(e.source)).join(`|`)})$`)
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
      return o ? Promise.all(s).then((t) => rr(t, i, e, a)) : rr(s, i, e, a)
    }
  }),
  ar = S(`$ZodDiscriminatedUnion`, (e, t) => {
    ;(t.inclusive = !1), ir.init(e, t)
    let n = e._zod.parse
    w(e._zod, `propValues`, () => {
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
    let r = Me(() => {
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
      if (!Be(o)) return i.issues.push({ code: `invalid_type`, expected: `object`, input: o, inst: e }), i
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
  or = S(`$ZodIntersection`, (e, t) => {
    M.init(e, t),
      (e._zod.parse = (e, n) => {
        let r = e.value,
          i = t.left._zod.run({ value: r, issues: [] }, n),
          a = t.right._zod.run({ value: r, issues: [] }, n)
        return i instanceof Promise || a instanceof Promise
          ? Promise.all([i, a]).then(([t, n]) => cr(e, t, n))
          : cr(e, i, a)
      })
  })
function sr(e, t) {
  if (e === t || (e instanceof Date && t instanceof Date && +e == +t)) return { valid: !0, data: e }
  if (D(e) && D(t)) {
    let n = Object.keys(t),
      r = Object.keys(e).filter((e) => n.indexOf(e) !== -1),
      i = { ...e, ...t }
    for (let n of r) {
      let r = sr(e[n], t[n])
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
        o = sr(i, a)
      if (!o.valid) return { valid: !1, mergeErrorPath: [r, ...o.mergeErrorPath] }
      n.push(o.data)
    }
    return { valid: !0, data: n }
  }
  return { valid: !1, mergeErrorPath: [] }
}
function cr(e, t, n) {
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
  if ((a.length && i && e.issues.push({ ...i, keys: a }), et(e))) return e
  let o = sr(t.value, n.value)
  if (!o.valid) throw Error(`Unmergable intersection. Error path: ${JSON.stringify(o.mergeErrorPath)}`)
  return (e.value = o.data), e
}
const lr = S(`$ZodRecord`, (e, t) => {
    M.init(e, t),
      (e._zod.parse = (n, r) => {
        let i = n.value
        if (!D(i)) return n.issues.push({ expected: `record`, code: `invalid_type`, input: i, inst: e }), n
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
                      t.issues.length && n.issues.push(...tt(e, t.issues)), (n.value[e] = t.value)
                    })
                  )
                : (o.issues.length && n.issues.push(...tt(e, o.issues)), (n.value[e] = o.value))
            }
          let c
          for (let e in i) s.has(e) || ((c ??= []), c.push(e))
          c && c.length > 0 && n.issues.push({ code: `unrecognized_keys`, input: i, inst: e, keys: c })
        } else {
          n.value = {}
          for (let o of Reflect.ownKeys(i)) {
            if (o === `__proto__`) continue
            let s = t.keyType._zod.run({ value: o, issues: [] }, r)
            if (s instanceof Promise) throw Error(`Async schemas not supported in object keys currently`)
            if (typeof o == `string` && Yt.test(o) && s.issues.length) {
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
                    issues: s.issues.map((e) => A(e, r, C())),
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
                    e.issues.length && n.issues.push(...tt(o, e.issues)), (n.value[s.value] = e.value)
                  })
                )
              : (c.issues.length && n.issues.push(...tt(o, c.issues)), (n.value[s.value] = c.value))
          }
        }
        return a.length ? Promise.all(a).then(() => n) : n
      })
  }),
  ur = S(`$ZodEnum`, (e, t) => {
    M.init(e, t)
    let n = Ae(t.entries),
      r = new Set(n)
    ;(e._zod.values = r),
      (e._zod.pattern = RegExp(
        `^(${n
          .filter((e) => Ue.has(typeof e))
          .map((e) => (typeof e == `string` ? We(e) : e.toString()))
          .join(`|`)})$`
      )),
      (e._zod.parse = (t, i) => {
        let a = t.value
        return r.has(a) || t.issues.push({ code: `invalid_value`, values: n, input: a, inst: e }), t
      })
  }),
  dr = S(`$ZodLiteral`, (e, t) => {
    if ((M.init(e, t), t.values.length === 0)) throw Error(`Cannot create literal schema with no valid values`)
    let n = new Set(t.values)
    ;(e._zod.values = n),
      (e._zod.pattern = RegExp(
        `^(${t.values.map((e) => (typeof e == `string` ? We(e) : e ? We(e.toString()) : String(e))).join(`|`)})$`
      )),
      (e._zod.parse = (r, i) => {
        let a = r.value
        return n.has(a) || r.issues.push({ code: `invalid_value`, values: t.values, input: a, inst: e }), r
      })
  }),
  fr = S(`$ZodTransform`, (e, t) => {
    M.init(e, t),
      (e._zod.parse = (n, r) => {
        if (r.direction === `backward`) throw new Oe(e.constructor.name)
        let i = t.transform(n.value, n)
        if (r.async) return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => ((n.value = e), n))
        if (i instanceof Promise) throw new De()
        return (n.value = i), n
      })
  })
function pr(e, t) {
  return e.issues.length && t === void 0 ? { issues: [], value: void 0 } : e
}
const mr = S(`$ZodOptional`, (e, t) => {
    M.init(e, t),
      (e._zod.optin = `optional`),
      (e._zod.optout = `optional`),
      w(e._zod, `values`, () => (t.innerType._zod.values ? new Set([...t.innerType._zod.values, void 0]) : void 0)),
      w(e._zod, `pattern`, () => {
        let e = t.innerType._zod.pattern
        return e ? RegExp(`^(${Pe(e.source)})?$`) : void 0
      }),
      (e._zod.parse = (e, n) => {
        if (t.innerType._zod.optin === `optional`) {
          let r = t.innerType._zod.run(e, n)
          return r instanceof Promise ? r.then((t) => pr(t, e.value)) : pr(r, e.value)
        }
        return e.value === void 0 ? e : t.innerType._zod.run(e, n)
      })
  }),
  hr = S(`$ZodExactOptional`, (e, t) => {
    mr.init(e, t),
      w(e._zod, `values`, () => t.innerType._zod.values),
      w(e._zod, `pattern`, () => t.innerType._zod.pattern),
      (e._zod.parse = (e, n) => t.innerType._zod.run(e, n))
  }),
  gr = S(`$ZodNullable`, (e, t) => {
    M.init(e, t),
      w(e._zod, `optin`, () => t.innerType._zod.optin),
      w(e._zod, `optout`, () => t.innerType._zod.optout),
      w(e._zod, `pattern`, () => {
        let e = t.innerType._zod.pattern
        return e ? RegExp(`^(${Pe(e.source)}|null)$`) : void 0
      }),
      w(e._zod, `values`, () => (t.innerType._zod.values ? new Set([...t.innerType._zod.values, null]) : void 0)),
      (e._zod.parse = (e, n) => (e.value === null ? e : t.innerType._zod.run(e, n)))
  }),
  _r = S(`$ZodDefault`, (e, t) => {
    M.init(e, t),
      (e._zod.optin = `optional`),
      w(e._zod, `values`, () => t.innerType._zod.values),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n)
        if (e.value === void 0) return (e.value = t.defaultValue), e
        let r = t.innerType._zod.run(e, n)
        return r instanceof Promise ? r.then((e) => vr(e, t)) : vr(r, t)
      })
  })
function vr(e, t) {
  return e.value === void 0 && (e.value = t.defaultValue), e
}
const yr = S(`$ZodPrefault`, (e, t) => {
    M.init(e, t),
      (e._zod.optin = `optional`),
      w(e._zod, `values`, () => t.innerType._zod.values),
      (e._zod.parse = (e, n) => (
        n.direction === `backward` || (e.value === void 0 && (e.value = t.defaultValue)), t.innerType._zod.run(e, n)
      ))
  }),
  br = S(`$ZodNonOptional`, (e, t) => {
    M.init(e, t),
      w(e._zod, `values`, () => {
        let e = t.innerType._zod.values
        return e ? new Set([...e].filter((e) => e !== void 0)) : void 0
      }),
      (e._zod.parse = (n, r) => {
        let i = t.innerType._zod.run(n, r)
        return i instanceof Promise ? i.then((t) => xr(t, e)) : xr(i, e)
      })
  })
function xr(e, t) {
  return (
    !e.issues.length &&
      e.value === void 0 &&
      e.issues.push({ code: `invalid_type`, expected: `nonoptional`, input: e.value, inst: t }),
    e
  )
}
const Sr = S(`$ZodCatch`, (e, t) => {
    M.init(e, t),
      w(e._zod, `optin`, () => t.innerType._zod.optin),
      w(e._zod, `optout`, () => t.innerType._zod.optout),
      w(e._zod, `values`, () => t.innerType._zod.values),
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
                    error: { issues: r.issues.map((e) => A(e, n, C())) },
                    input: e.value
                  })),
                  (e.issues = [])),
                e
              )
            )
          : ((e.value = r.value),
            r.issues.length &&
              ((e.value = t.catchValue({ ...e, error: { issues: r.issues.map((e) => A(e, n, C())) }, input: e.value })),
              (e.issues = [])),
            e)
      })
  }),
  Cr = S(`$ZodPipe`, (e, t) => {
    M.init(e, t),
      w(e._zod, `values`, () => t.in._zod.values),
      w(e._zod, `optin`, () => t.in._zod.optin),
      w(e._zod, `optout`, () => t.out._zod.optout),
      w(e._zod, `propValues`, () => t.in._zod.propValues),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) {
          let r = t.out._zod.run(e, n)
          return r instanceof Promise ? r.then((e) => wr(e, t.in, n)) : wr(r, t.in, n)
        }
        let r = t.in._zod.run(e, n)
        return r instanceof Promise ? r.then((e) => wr(e, t.out, n)) : wr(r, t.out, n)
      })
  })
function wr(e, t, n) {
  return e.issues.length ? ((e.aborted = !0), e) : t._zod.run({ value: e.value, issues: e.issues }, n)
}
const Tr = S(`$ZodReadonly`, (e, t) => {
  M.init(e, t),
    w(e._zod, `propValues`, () => t.innerType._zod.propValues),
    w(e._zod, `values`, () => t.innerType._zod.values),
    w(e._zod, `optin`, () => t.innerType?._zod?.optin),
    w(e._zod, `optout`, () => t.innerType?._zod?.optout),
    (e._zod.parse = (e, n) => {
      if (n.direction === `backward`) return t.innerType._zod.run(e, n)
      let r = t.innerType._zod.run(e, n)
      return r instanceof Promise ? r.then(Er) : Er(r)
    })
})
function Er(e) {
  return (e.value = Object.freeze(e.value)), e
}
const Dr = S(`$ZodCustom`, (e, t) => {
  j.init(e, t),
    M.init(e, t),
    (e._zod.parse = (e, t) => e),
    (e._zod.check = (n) => {
      let r = n.value,
        i = t.fn(r)
      if (i instanceof Promise) return i.then((t) => Or(t, n, r, e))
      Or(i, n, r, e)
    })
})
function Or(e, t, n, r) {
  if (!e) {
    let e = { code: `custom`, input: n, inst: r, path: [...(r._zod.def.path ?? [])], continue: !r._zod.def.abort }
    r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(it(e))
  }
}
var kr,
  Ar = class {
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
function jr() {
  return new Ar()
}
;(kr = globalThis).__zod_globalRegistry ?? (kr.__zod_globalRegistry = jr())
const Mr = globalThis.__zod_globalRegistry
function Nr(e, t) {
  return new e({ type: `string`, ...k(t) })
}
function Pr(e, t) {
  return new e({ type: `string`, format: `email`, check: `string_format`, abort: !1, ...k(t) })
}
function Fr(e, t) {
  return new e({ type: `string`, format: `guid`, check: `string_format`, abort: !1, ...k(t) })
}
function Ir(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, ...k(t) })
}
function Lr(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v4`, ...k(t) })
}
function Rr(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v6`, ...k(t) })
}
function zr(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, version: `v7`, ...k(t) })
}
function Br(e, t) {
  return new e({ type: `string`, format: `url`, check: `string_format`, abort: !1, ...k(t) })
}
function Vr(e, t) {
  return new e({ type: `string`, format: `emoji`, check: `string_format`, abort: !1, ...k(t) })
}
function Hr(e, t) {
  return new e({ type: `string`, format: `nanoid`, check: `string_format`, abort: !1, ...k(t) })
}
function Ur(e, t) {
  return new e({ type: `string`, format: `cuid`, check: `string_format`, abort: !1, ...k(t) })
}
function Wr(e, t) {
  return new e({ type: `string`, format: `cuid2`, check: `string_format`, abort: !1, ...k(t) })
}
function Gr(e, t) {
  return new e({ type: `string`, format: `ulid`, check: `string_format`, abort: !1, ...k(t) })
}
function Kr(e, t) {
  return new e({ type: `string`, format: `xid`, check: `string_format`, abort: !1, ...k(t) })
}
function qr(e, t) {
  return new e({ type: `string`, format: `ksuid`, check: `string_format`, abort: !1, ...k(t) })
}
function Jr(e, t) {
  return new e({ type: `string`, format: `ipv4`, check: `string_format`, abort: !1, ...k(t) })
}
function Yr(e, t) {
  return new e({ type: `string`, format: `ipv6`, check: `string_format`, abort: !1, ...k(t) })
}
function Xr(e, t) {
  return new e({ type: `string`, format: `cidrv4`, check: `string_format`, abort: !1, ...k(t) })
}
function Zr(e, t) {
  return new e({ type: `string`, format: `cidrv6`, check: `string_format`, abort: !1, ...k(t) })
}
function Qr(e, t) {
  return new e({ type: `string`, format: `base64`, check: `string_format`, abort: !1, ...k(t) })
}
function $r(e, t) {
  return new e({ type: `string`, format: `base64url`, check: `string_format`, abort: !1, ...k(t) })
}
function ei(e, t) {
  return new e({ type: `string`, format: `e164`, check: `string_format`, abort: !1, ...k(t) })
}
function ti(e, t) {
  return new e({ type: `string`, format: `jwt`, check: `string_format`, abort: !1, ...k(t) })
}
function ni(e, t) {
  return new e({
    type: `string`,
    format: `datetime`,
    check: `string_format`,
    offset: !1,
    local: !1,
    precision: null,
    ...k(t)
  })
}
function ri(e, t) {
  return new e({ type: `string`, format: `date`, check: `string_format`, ...k(t) })
}
function ii(e, t) {
  return new e({ type: `string`, format: `time`, check: `string_format`, precision: null, ...k(t) })
}
function ai(e, t) {
  return new e({ type: `string`, format: `duration`, check: `string_format`, ...k(t) })
}
function oi(e, t) {
  return new e({ type: `number`, checks: [], ...k(t) })
}
function si(e, t) {
  return new e({ type: `number`, check: `number_format`, abort: !1, format: `safeint`, ...k(t) })
}
function ci(e, t) {
  return new e({ type: `boolean`, ...k(t) })
}
function li(e) {
  return new e({ type: `unknown` })
}
function ui(e, t) {
  return new e({ type: `never`, ...k(t) })
}
function di(e, t) {
  return new en({ check: `less_than`, ...k(t), value: e, inclusive: !1 })
}
function fi(e, t) {
  return new en({ check: `less_than`, ...k(t), value: e, inclusive: !0 })
}
function pi(e, t) {
  return new tn({ check: `greater_than`, ...k(t), value: e, inclusive: !1 })
}
function mi(e, t) {
  return new tn({ check: `greater_than`, ...k(t), value: e, inclusive: !0 })
}
function hi(e, t) {
  return new nn({ check: `multiple_of`, ...k(t), value: e })
}
function gi(e, t) {
  return new an({ check: `max_length`, ...k(t), maximum: e })
}
function _i(e, t) {
  return new on({ check: `min_length`, ...k(t), minimum: e })
}
function vi(e, t) {
  return new sn({ check: `length_equals`, ...k(t), length: e })
}
function yi(e, t) {
  return new ln({ check: `string_format`, format: `regex`, ...k(t), pattern: e })
}
function bi(e) {
  return new un({ check: `string_format`, format: `lowercase`, ...k(e) })
}
function xi(e) {
  return new dn({ check: `string_format`, format: `uppercase`, ...k(e) })
}
function Si(e, t) {
  return new fn({ check: `string_format`, format: `includes`, ...k(t), includes: e })
}
function Ci(e, t) {
  return new pn({ check: `string_format`, format: `starts_with`, ...k(t), prefix: e })
}
function wi(e, t) {
  return new mn({ check: `string_format`, format: `ends_with`, ...k(t), suffix: e })
}
function P(e) {
  return new hn({ check: `overwrite`, tx: e })
}
function Ti(e) {
  return P((t) => t.normalize(e))
}
function Ei() {
  return P((e) => e.trim())
}
function Di() {
  return P((e) => e.toLowerCase())
}
function Oi() {
  return P((e) => e.toUpperCase())
}
function ki() {
  return P((e) => Re(e))
}
function Ai(e, t, n) {
  return new e({ type: `array`, element: t, ...k(n) })
}
function ji(e, t, n) {
  return new e({ type: `custom`, check: `custom`, fn: t, ...k(n) })
}
function Mi(e) {
  let t = Ni(
    (n) => (
      (n.addIssue = (e) => {
        if (typeof e == `string`) n.issues.push(it(e, n.value, t._zod.def))
        else {
          let r = e
          r.fatal && (r.continue = !1),
            (r.code ??= `custom`),
            (r.input ??= n.value),
            (r.inst ??= t),
            (r.continue ??= !t._zod.def.abort),
            n.issues.push(it(r))
        }
      }),
      e(n.value, n)
    )
  )
  return t
}
function Ni(e, t) {
  let n = new j({ check: `custom`, ...k(t) })
  return (n._zod.check = e), n
}
function Pi(e) {
  let t = e?.target ?? `draft-2020-12`
  return (
    t === `draft-4` && (t = `draft-04`),
    t === `draft-7` && (t = `draft-07`),
    {
      processors: e.processors ?? {},
      metadataRegistry: e?.metadata ?? Mr,
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
function F(e, t, n = { path: [], schemaPath: [] }) {
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
    a && ((o.ref ||= a), F(a, t, r), (t.seen.get(a).isParent = !0))
  }
  let c = t.metadataRegistry.get(e)
  return (
    c && Object.assign(o.schema, c),
    t.io === `input` && I(e) && (delete o.schema.examples, delete o.schema.default),
    t.io === `input` && o.schema._prefault && ((r = o.schema).default ?? (r.default = o.schema._prefault)),
    delete o.schema._prefault,
    t.seen.get(e).schema
  )
}
function Fi(e, t) {
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
function Ii(e, t) {
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
          jsonSchema: { input: Ri(t, `input`, e.processors), output: Ri(t, `output`, e.processors) }
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
function I(e, t) {
  let n = t ?? { seen: new Set() }
  if (n.seen.has(e)) return !1
  n.seen.add(e)
  let r = e._zod.def
  if (r.type === `transform`) return !0
  if (r.type === `array`) return I(r.element, n)
  if (r.type === `set`) return I(r.valueType, n)
  if (r.type === `lazy`) return I(r.getter(), n)
  if (
    r.type === `promise` ||
    r.type === `optional` ||
    r.type === `nonoptional` ||
    r.type === `nullable` ||
    r.type === `readonly` ||
    r.type === `default` ||
    r.type === `prefault`
  )
    return I(r.innerType, n)
  if (r.type === `intersection`) return I(r.left, n) || I(r.right, n)
  if (r.type === `record` || r.type === `map`) return I(r.keyType, n) || I(r.valueType, n)
  if (r.type === `pipe`) return I(r.in, n) || I(r.out, n)
  if (r.type === `object`) {
    for (let e in r.shape) if (I(r.shape[e], n)) return !0
    return !1
  }
  if (r.type === `union`) {
    for (let e of r.options) if (I(e, n)) return !0
    return !1
  }
  if (r.type === `tuple`) {
    for (let e of r.items) if (I(e, n)) return !0
    return !!(r.rest && I(r.rest, n))
  }
  return !1
}
const Li =
    (e, t = {}) =>
    (n) => {
      let r = Pi({ ...n, processors: t })
      return F(e, r), Fi(r, e), Ii(r, e)
    },
  Ri =
    (e, t, n = {}) =>
    (r) => {
      let { libraryOptions: i, target: a } = r ?? {},
        o = Pi({ ...(i ?? {}), target: a, io: t, processors: n })
      return F(e, o), Fi(o, e), Ii(o, e)
    },
  zi = { guid: `uuid`, url: `uri`, datetime: `date-time`, json_string: `json-string`, regex: `` },
  Bi = (e, t, n, r) => {
    let i = n
    i.type = `string`
    let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l } = e._zod.bag
    if (
      (typeof a == `number` && (i.minLength = a),
      typeof o == `number` && (i.maxLength = o),
      s && ((i.format = zi[s] ?? s), i.format === `` && delete i.format, s === `time` && delete i.format),
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
  Vi = (e, t, n, r) => {
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
  Hi = (e, t, n, r) => {
    n.type = `boolean`
  },
  Ui = (e, t, n, r) => {
    n.not = {}
  },
  Wi = (e, t, n, r) => {
    let i = e._zod.def,
      a = Ae(i.entries)
    a.every((e) => typeof e == `number`) && (n.type = `number`),
      a.every((e) => typeof e == `string`) && (n.type = `string`),
      (n.enum = a)
  },
  Gi = (e, t, n, r) => {
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
  Ki = (e, t, n, r) => {
    if (t.unrepresentable === `throw`) throw Error(`Custom types cannot be represented in JSON Schema`)
  },
  qi = (e, t, n, r) => {
    if (t.unrepresentable === `throw`) throw Error(`Transforms cannot be represented in JSON Schema`)
  },
  Ji = (e, t, n, r) => {
    let i = n,
      a = e._zod.def,
      { minimum: o, maximum: s } = e._zod.bag
    typeof o == `number` && (i.minItems = o),
      typeof s == `number` && (i.maxItems = s),
      (i.type = `array`),
      (i.items = F(a.element, t, { ...r, path: [...r.path, `items`] }))
  },
  Yi = (e, t, n, r) => {
    let i = n,
      a = e._zod.def
    ;(i.type = `object`), (i.properties = {})
    let o = a.shape
    for (let e in o) i.properties[e] = F(o[e], t, { ...r, path: [...r.path, `properties`, e] })
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
            (i.additionalProperties = F(a.catchall, t, { ...r, path: [...r.path, `additionalProperties`] }))
          : t.io === `output` && (i.additionalProperties = !1)
  },
  Xi = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.inclusive === !1,
      o = i.options.map((e, n) => F(e, t, { ...r, path: [...r.path, a ? `oneOf` : `anyOf`, n] }))
    a ? (n.oneOf = o) : (n.anyOf = o)
  },
  Zi = (e, t, n, r) => {
    let i = e._zod.def,
      a = F(i.left, t, { ...r, path: [...r.path, `allOf`, 0] }),
      o = F(i.right, t, { ...r, path: [...r.path, `allOf`, 1] }),
      s = (e) => `allOf` in e && Object.keys(e).length === 1
    n.allOf = [...(s(a) ? a.allOf : [a]), ...(s(o) ? o.allOf : [o])]
  },
  Qi = (e, t, n, r) => {
    let i = n,
      a = e._zod.def
    i.type = `object`
    let o = a.keyType,
      s = o._zod.bag?.patterns
    if (a.mode === `loose` && s && s.size > 0) {
      let e = F(a.valueType, t, { ...r, path: [...r.path, `patternProperties`, `*`] })
      i.patternProperties = {}
      for (let t of s) i.patternProperties[t.source] = e
    } else
      (t.target === `draft-07` || t.target === `draft-2020-12`) &&
        (i.propertyNames = F(a.keyType, t, { ...r, path: [...r.path, `propertyNames`] })),
        (i.additionalProperties = F(a.valueType, t, { ...r, path: [...r.path, `additionalProperties`] }))
    let c = o._zod.values
    if (c) {
      let e = [...c].filter((e) => typeof e == `string` || typeof e == `number`)
      e.length > 0 && (i.required = e)
    }
  },
  $i = (e, t, n, r) => {
    let i = e._zod.def,
      a = F(i.innerType, t, r),
      o = t.seen.get(e)
    t.target === `openapi-3.0` ? ((o.ref = i.innerType), (n.nullable = !0)) : (n.anyOf = [a, { type: `null` }])
  },
  ea = (e, t, n, r) => {
    let i = e._zod.def
    F(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
  },
  ta = (e, t, n, r) => {
    let i = e._zod.def
    F(i.innerType, t, r)
    let a = t.seen.get(e)
    ;(a.ref = i.innerType), (n.default = JSON.parse(JSON.stringify(i.defaultValue)))
  },
  na = (e, t, n, r) => {
    let i = e._zod.def
    F(i.innerType, t, r)
    let a = t.seen.get(e)
    ;(a.ref = i.innerType), t.io === `input` && (n._prefault = JSON.parse(JSON.stringify(i.defaultValue)))
  },
  ra = (e, t, n, r) => {
    let i = e._zod.def
    F(i.innerType, t, r)
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
  ia = (e, t, n, r) => {
    let i = e._zod.def,
      a = t.io === `input` ? (i.in._zod.def.type === `transform` ? i.out : i.in) : i.out
    F(a, t, r)
    let o = t.seen.get(e)
    o.ref = a
  },
  aa = (e, t, n, r) => {
    let i = e._zod.def
    F(i.innerType, t, r)
    let a = t.seen.get(e)
    ;(a.ref = i.innerType), (n.readOnly = !0)
  },
  oa = (e, t, n, r) => {
    let i = e._zod.def
    F(i.innerType, t, r)
    let a = t.seen.get(e)
    a.ref = i.innerType
  },
  sa = S(`ZodISODateTime`, (e, t) => {
    An.init(e, t), B.init(e, t)
  })
function ca(e) {
  return ni(sa, e)
}
const la = S(`ZodISODate`, (e, t) => {
  jn.init(e, t), B.init(e, t)
})
function ua(e) {
  return ri(la, e)
}
const da = S(`ZodISOTime`, (e, t) => {
  Mn.init(e, t), B.init(e, t)
})
function fa(e) {
  return ii(da, e)
}
const pa = S(`ZodISODuration`, (e, t) => {
  Nn.init(e, t), B.init(e, t)
})
function ma(e) {
  return ai(pa, e)
}
const ha = (e, t) => {
  ot.init(e, t),
    (e.name = `ZodError`),
    Object.defineProperties(e, {
      format: { value: (t) => lt(e, t) },
      flatten: { value: (t) => ct(e, t) },
      addIssue: {
        value: (t) => {
          e.issues.push(t), (e.message = JSON.stringify(e.issues, je, 2))
        }
      },
      addIssues: {
        value: (t) => {
          e.issues.push(...t), (e.message = JSON.stringify(e.issues, je, 2))
        }
      },
      isEmpty: {
        get() {
          return e.issues.length === 0
        }
      }
    })
}
S(`ZodError`, ha)
const L = S(`ZodError`, ha, { Parent: Error }),
  ga = ut(L),
  _a = dt(L),
  va = ft(L),
  ya = mt(L),
  ba = gt(L),
  xa = _t(L),
  Sa = vt(L),
  Ca = yt(L),
  wa = bt(L),
  Ta = xt(L),
  Ea = St(L),
  Da = Ct(L),
  R = S(
    `ZodType`,
    (e, t) => (
      M.init(e, t),
      Object.assign(e[`~standard`], { jsonSchema: { input: Ri(e, `input`), output: Ri(e, `output`) } }),
      (e.toJSONSchema = Li(e, {})),
      (e.def = t),
      (e.type = t.type),
      Object.defineProperty(e, `_def`, { value: t }),
      (e.check = (...n) =>
        e.clone(
          E(t, {
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
      (e.clone = (t, n) => O(e, t, n)),
      (e.brand = () => e),
      (e.register = (t, n) => (t.add(e, n), e)),
      (e.parse = (t, n) => ga(e, t, n, { callee: e.parse })),
      (e.safeParse = (t, n) => va(e, t, n)),
      (e.parseAsync = async (t, n) => _a(e, t, n, { callee: e.parseAsync })),
      (e.safeParseAsync = async (t, n) => ya(e, t, n)),
      (e.spa = e.safeParseAsync),
      (e.encode = (t, n) => ba(e, t, n)),
      (e.decode = (t, n) => xa(e, t, n)),
      (e.encodeAsync = async (t, n) => Sa(e, t, n)),
      (e.decodeAsync = async (t, n) => Ca(e, t, n)),
      (e.safeEncode = (t, n) => wa(e, t, n)),
      (e.safeDecode = (t, n) => Ta(e, t, n)),
      (e.safeEncodeAsync = async (t, n) => Ea(e, t, n)),
      (e.safeDecodeAsync = async (t, n) => Da(e, t, n)),
      (e.refine = (t, n) => e.check(Lo(t, n))),
      (e.superRefine = (t) => e.check(Ro(t))),
      (e.overwrite = (t) => e.check(P(t))),
      (e.optional = () => yo(e)),
      (e.exactOptional = () => xo(e)),
      (e.nullable = () => Co(e)),
      (e.nullish = () => yo(Co(e))),
      (e.nonoptional = (t) => ko(e, t)),
      (e.array = () => W(e)),
      (e.or = (t) => oo([e, t])),
      (e.and = (t) => lo(e, t)),
      (e.transform = (t) => No(e, _o(t))),
      (e.default = (t) => To(e, t)),
      (e.prefault = (t) => Do(e, t)),
      (e.catch = (t) => jo(e, t)),
      (e.pipe = (t) => No(e, t)),
      (e.readonly = () => Fo(e)),
      (e.describe = (t) => {
        let n = e.clone()
        return Mr.add(n, { description: t }), n
      }),
      Object.defineProperty(e, `description`, {
        get() {
          return Mr.get(e)?.description
        },
        configurable: !0
      }),
      (e.meta = (...t) => {
        if (t.length === 0) return Mr.get(e)
        let n = e.clone()
        return Mr.add(n, t[0]), n
      }),
      (e.isOptional = () => e.safeParse(void 0).success),
      (e.isNullable = () => e.safeParse(null).success),
      (e.apply = (t) => t(e)),
      e
    )
  ),
  Oa = S(`_ZodString`, (e, t) => {
    vn.init(e, t), R.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Bi(e, t, n, r))
    let n = e._zod.bag
    ;(e.format = n.format ?? null),
      (e.minLength = n.minimum ?? null),
      (e.maxLength = n.maximum ?? null),
      (e.regex = (...t) => e.check(yi(...t))),
      (e.includes = (...t) => e.check(Si(...t))),
      (e.startsWith = (...t) => e.check(Ci(...t))),
      (e.endsWith = (...t) => e.check(wi(...t))),
      (e.min = (...t) => e.check(_i(...t))),
      (e.max = (...t) => e.check(gi(...t))),
      (e.length = (...t) => e.check(vi(...t))),
      (e.nonempty = (...t) => e.check(_i(1, ...t))),
      (e.lowercase = (t) => e.check(bi(t))),
      (e.uppercase = (t) => e.check(xi(t))),
      (e.trim = () => e.check(Ei())),
      (e.normalize = (...t) => e.check(Ti(...t))),
      (e.toLowerCase = () => e.check(Di())),
      (e.toUpperCase = () => e.check(Oi())),
      (e.slugify = () => e.check(ki()))
  }),
  ka = S(`ZodString`, (e, t) => {
    vn.init(e, t),
      Oa.init(e, t),
      (e.email = (t) => e.check(Pr(Aa, t))),
      (e.url = (t) => e.check(Br(Na, t))),
      (e.jwt = (t) => e.check(ti(Ja, t))),
      (e.emoji = (t) => e.check(Vr(Pa, t))),
      (e.guid = (t) => e.check(Fr(ja, t))),
      (e.uuid = (t) => e.check(Ir(Ma, t))),
      (e.uuidv4 = (t) => e.check(Lr(Ma, t))),
      (e.uuidv6 = (t) => e.check(Rr(Ma, t))),
      (e.uuidv7 = (t) => e.check(zr(Ma, t))),
      (e.nanoid = (t) => e.check(Hr(Fa, t))),
      (e.guid = (t) => e.check(Fr(ja, t))),
      (e.cuid = (t) => e.check(Ur(Ia, t))),
      (e.cuid2 = (t) => e.check(Wr(La, t))),
      (e.ulid = (t) => e.check(Gr(Ra, t))),
      (e.base64 = (t) => e.check(Qr(Ga, t))),
      (e.base64url = (t) => e.check($r(Ka, t))),
      (e.xid = (t) => e.check(Kr(za, t))),
      (e.ksuid = (t) => e.check(qr(Ba, t))),
      (e.ipv4 = (t) => e.check(Jr(Va, t))),
      (e.ipv6 = (t) => e.check(Yr(Ha, t))),
      (e.cidrv4 = (t) => e.check(Xr(Ua, t))),
      (e.cidrv6 = (t) => e.check(Zr(Wa, t))),
      (e.e164 = (t) => e.check(ei(qa, t))),
      (e.datetime = (t) => e.check(ca(t))),
      (e.date = (t) => e.check(ua(t))),
      (e.time = (t) => e.check(fa(t))),
      (e.duration = (t) => e.check(ma(t)))
  })
function z(e) {
  return Nr(ka, e)
}
const B = S(`ZodStringFormat`, (e, t) => {
    N.init(e, t), Oa.init(e, t)
  }),
  Aa = S(`ZodEmail`, (e, t) => {
    xn.init(e, t), B.init(e, t)
  }),
  ja = S(`ZodGUID`, (e, t) => {
    yn.init(e, t), B.init(e, t)
  }),
  Ma = S(`ZodUUID`, (e, t) => {
    bn.init(e, t), B.init(e, t)
  }),
  Na = S(`ZodURL`, (e, t) => {
    Sn.init(e, t), B.init(e, t)
  })
function V(e) {
  return Br(Na, e)
}
const Pa = S(`ZodEmoji`, (e, t) => {
    Cn.init(e, t), B.init(e, t)
  }),
  Fa = S(`ZodNanoID`, (e, t) => {
    wn.init(e, t), B.init(e, t)
  }),
  Ia = S(`ZodCUID`, (e, t) => {
    Tn.init(e, t), B.init(e, t)
  }),
  La = S(`ZodCUID2`, (e, t) => {
    En.init(e, t), B.init(e, t)
  }),
  Ra = S(`ZodULID`, (e, t) => {
    Dn.init(e, t), B.init(e, t)
  }),
  za = S(`ZodXID`, (e, t) => {
    On.init(e, t), B.init(e, t)
  }),
  Ba = S(`ZodKSUID`, (e, t) => {
    kn.init(e, t), B.init(e, t)
  }),
  Va = S(`ZodIPv4`, (e, t) => {
    Pn.init(e, t), B.init(e, t)
  }),
  Ha = S(`ZodIPv6`, (e, t) => {
    Fn.init(e, t), B.init(e, t)
  }),
  Ua = S(`ZodCIDRv4`, (e, t) => {
    In.init(e, t), B.init(e, t)
  }),
  Wa = S(`ZodCIDRv6`, (e, t) => {
    Ln.init(e, t), B.init(e, t)
  }),
  Ga = S(`ZodBase64`, (e, t) => {
    zn.init(e, t), B.init(e, t)
  }),
  Ka = S(`ZodBase64URL`, (e, t) => {
    Vn.init(e, t), B.init(e, t)
  }),
  qa = S(`ZodE164`, (e, t) => {
    Hn.init(e, t), B.init(e, t)
  }),
  Ja = S(`ZodJWT`, (e, t) => {
    Wn.init(e, t), B.init(e, t)
  }),
  Ya = S(`ZodNumber`, (e, t) => {
    Gn.init(e, t),
      R.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => Vi(e, t, n, r)),
      (e.gt = (t, n) => e.check(pi(t, n))),
      (e.gte = (t, n) => e.check(mi(t, n))),
      (e.min = (t, n) => e.check(mi(t, n))),
      (e.lt = (t, n) => e.check(di(t, n))),
      (e.lte = (t, n) => e.check(fi(t, n))),
      (e.max = (t, n) => e.check(fi(t, n))),
      (e.int = (t) => e.check(Za(t))),
      (e.safe = (t) => e.check(Za(t))),
      (e.positive = (t) => e.check(pi(0, t))),
      (e.nonnegative = (t) => e.check(mi(0, t))),
      (e.negative = (t) => e.check(di(0, t))),
      (e.nonpositive = (t) => e.check(fi(0, t))),
      (e.multipleOf = (t, n) => e.check(hi(t, n))),
      (e.step = (t, n) => e.check(hi(t, n))),
      (e.finite = () => e)
    let n = e._zod.bag
    ;(e.minValue = Math.max(n.minimum ?? -1 / 0, n.exclusiveMinimum ?? -1 / 0) ?? null),
      (e.maxValue = Math.min(n.maximum ?? 1 / 0, n.exclusiveMaximum ?? 1 / 0) ?? null),
      (e.isInt = (n.format ?? ``).includes(`int`) || Number.isSafeInteger(n.multipleOf ?? 0.5)),
      (e.isFinite = !0),
      (e.format = n.format ?? null)
  })
function H(e) {
  return oi(Ya, e)
}
const Xa = S(`ZodNumberFormat`, (e, t) => {
  Kn.init(e, t), Ya.init(e, t)
})
function Za(e) {
  return si(Xa, e)
}
const Qa = S(`ZodBoolean`, (e, t) => {
  qn.init(e, t), R.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Hi(e, t, n, r))
})
function U(e) {
  return ci(Qa, e)
}
const $a = S(`ZodUnknown`, (e, t) => {
  Jn.init(e, t), R.init(e, t), (e._zod.processJSONSchema = (e, t, n) => void 0)
})
function eo() {
  return li($a)
}
const to = S(`ZodNever`, (e, t) => {
  Yn.init(e, t), R.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Ui(e, t, n, r))
})
function no(e) {
  return ui(to, e)
}
const ro = S(`ZodArray`, (e, t) => {
  Zn.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Ji(e, t, n, r)),
    (e.element = t.element),
    (e.min = (t, n) => e.check(_i(t, n))),
    (e.nonempty = (t) => e.check(_i(1, t))),
    (e.max = (t, n) => e.check(gi(t, n))),
    (e.length = (t, n) => e.check(vi(t, n))),
    (e.unwrap = () => e.element)
})
function W(e, t) {
  return Ai(ro, e, t)
}
const io = S(`ZodObject`, (e, t) => {
  nr.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Yi(e, t, n, r)),
    w(e, `shape`, () => t.shape),
    (e.keyof = () => q(Object.keys(e._zod.def.shape))),
    (e.catchall = (t) => e.clone({ ...e._zod.def, catchall: t })),
    (e.passthrough = () => e.clone({ ...e._zod.def, catchall: eo() })),
    (e.loose = () => e.clone({ ...e._zod.def, catchall: eo() })),
    (e.strict = () => e.clone({ ...e._zod.def, catchall: no() })),
    (e.strip = () => e.clone({ ...e._zod.def, catchall: void 0 })),
    (e.extend = (t) => Ye(e, t)),
    (e.safeExtend = (t) => Xe(e, t)),
    (e.merge = (t) => Ze(e, t)),
    (e.pick = (t) => qe(e, t)),
    (e.omit = (t) => Je(e, t)),
    (e.partial = (...t) => Qe(vo, e, t[0])),
    (e.required = (...t) => $e(Oo, e, t[0]))
})
function G(e, t) {
  return new io({ type: `object`, shape: e ?? {}, ...k(t) })
}
const ao = S(`ZodUnion`, (e, t) => {
  ir.init(e, t), R.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Xi(e, t, n, r)), (e.options = t.options)
})
function oo(e, t) {
  return new ao({ type: `union`, options: e, ...k(t) })
}
const so = S(`ZodDiscriminatedUnion`, (e, t) => {
  ao.init(e, t), ar.init(e, t)
})
function K(e, t, n) {
  return new so({ type: `union`, options: t, discriminator: e, ...k(n) })
}
const co = S(`ZodIntersection`, (e, t) => {
  or.init(e, t), R.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Zi(e, t, n, r))
})
function lo(e, t) {
  return new co({ type: `intersection`, left: e, right: t })
}
const uo = S(`ZodRecord`, (e, t) => {
  lr.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Qi(e, t, n, r)),
    (e.keyType = t.keyType),
    (e.valueType = t.valueType)
})
function fo(e, t, n) {
  return new uo({ type: `record`, keyType: e, valueType: t, ...k(n) })
}
function po(e, t, n) {
  let r = O(e)
  return (r._zod.values = void 0), new uo({ type: `record`, keyType: r, valueType: t, ...k(n) })
}
const mo = S(`ZodEnum`, (e, t) => {
  ur.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Wi(e, t, n, r)),
    (e.enum = t.entries),
    (e.options = Object.values(t.entries))
  let n = new Set(Object.keys(t.entries))
  ;(e.extract = (e, r) => {
    let i = {}
    for (let r of e)
      if (n.has(r)) i[r] = t.entries[r]
      else throw Error(`Key ${r} not found in enum`)
    return new mo({ ...t, checks: [], ...k(r), entries: i })
  }),
    (e.exclude = (e, r) => {
      let i = { ...t.entries }
      for (let t of e)
        if (n.has(t)) delete i[t]
        else throw Error(`Key ${t} not found in enum`)
      return new mo({ ...t, checks: [], ...k(r), entries: i })
    })
})
function q(e, t) {
  return new mo({ type: `enum`, entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e, ...k(t) })
}
const ho = S(`ZodLiteral`, (e, t) => {
  dr.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Gi(e, t, n, r)),
    (e.values = new Set(t.values)),
    Object.defineProperty(e, `value`, {
      get() {
        if (t.values.length > 1)
          throw Error('This schema contains multiple valid literal values. Use `.values` instead.')
        return t.values[0]
      }
    })
})
function J(e, t) {
  return new ho({ type: `literal`, values: Array.isArray(e) ? e : [e], ...k(t) })
}
const go = S(`ZodTransform`, (e, t) => {
  fr.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => qi(e, t, n, r)),
    (e._zod.parse = (n, r) => {
      if (r.direction === `backward`) throw new Oe(e.constructor.name)
      n.addIssue = (r) => {
        if (typeof r == `string`) n.issues.push(it(r, n.value, t))
        else {
          let t = r
          t.fatal && (t.continue = !1),
            (t.code ??= `custom`),
            (t.input ??= n.value),
            (t.inst ??= e),
            n.issues.push(it(t))
        }
      }
      let i = t.transform(n.value, n)
      return i instanceof Promise ? i.then((e) => ((n.value = e), n)) : ((n.value = i), n)
    })
})
function _o(e) {
  return new go({ type: `transform`, transform: e })
}
const vo = S(`ZodOptional`, (e, t) => {
  mr.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => oa(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function yo(e) {
  return new vo({ type: `optional`, innerType: e })
}
const bo = S(`ZodExactOptional`, (e, t) => {
  hr.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => oa(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function xo(e) {
  return new bo({ type: `optional`, innerType: e })
}
const So = S(`ZodNullable`, (e, t) => {
  gr.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => $i(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function Co(e) {
  return new So({ type: `nullable`, innerType: e })
}
const wo = S(`ZodDefault`, (e, t) => {
  _r.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ta(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeDefault = e.unwrap)
})
function To(e, t) {
  return new wo({
    type: `default`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : He(t)
    }
  })
}
const Eo = S(`ZodPrefault`, (e, t) => {
  yr.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => na(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function Do(e, t) {
  return new Eo({
    type: `prefault`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : He(t)
    }
  })
}
const Oo = S(`ZodNonOptional`, (e, t) => {
  br.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ea(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function ko(e, t) {
  return new Oo({ type: `nonoptional`, innerType: e, ...k(t) })
}
const Ao = S(`ZodCatch`, (e, t) => {
  Sr.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => ra(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeCatch = e.unwrap)
})
function jo(e, t) {
  return new Ao({ type: `catch`, innerType: e, catchValue: typeof t == `function` ? t : () => t })
}
const Mo = S(`ZodPipe`, (e, t) => {
  Cr.init(e, t), R.init(e, t), (e._zod.processJSONSchema = (t, n, r) => ia(e, t, n, r)), (e.in = t.in), (e.out = t.out)
})
function No(e, t) {
  return new Mo({ type: `pipe`, in: e, out: t })
}
const Po = S(`ZodReadonly`, (e, t) => {
  Tr.init(e, t),
    R.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => aa(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType)
})
function Fo(e) {
  return new Po({ type: `readonly`, innerType: e })
}
const Io = S(`ZodCustom`, (e, t) => {
  Dr.init(e, t), R.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Ki(e, t, n, r))
})
function Lo(e, t = {}) {
  return ji(Io, e, t)
}
function Ro(e) {
  return Mi(e)
}
Ee()
const Y = {
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
  zo = {
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
  Bo = { WEB_SEARCH: `web-search`, URL_CONTEXT: `url-context` },
  Vo = { ALL_CHAT_MODELS: `all-chat-models`, MODEL_DEPENDENT: `model-dependent` },
  Ho = {
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
  Uo = { TEXT: `text`, IMAGE: `image`, AUDIO: `audio`, VIDEO: `video`, VECTOR: `vector` },
  Wo = { USD: `USD`, CNY: `CNY` },
  Go = {
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
const Ko = z().min(1),
  qo = z().min(1),
  Jo = z().min(1),
  Yo = G({ min: H(), max: H() }).refine((e) => e.min <= e.max, { message: `min must be less than or equal to max` })
G({ min: z(), max: z() })
const Xo = q(X(Wo)).optional(),
  Z = G({ perMillionTokens: H().nonnegative().nullable(), currency: Xo }),
  Zo = fo(z(), eo()).optional()
function Q(e, { min: t } = {}) {
  let n = W(eo()).transform((t) =>
    t.reduce((t, n) => {
      let r = e.safeParse(n)
      return r.success && t.push(r.data), t
    }, [])
  )
  return t === void 0 ? n : n.refine((e) => e.length >= t, { message: `expected at least ${t} recognized value(s)` })
}
const Qo = {
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
  $o = q(
    `reasoningEffort,reasoningSummary,reasoning_effort,reasoning.effort,reasoning.enabled,reasoning.exclude,reasoning.max_tokens,thinking.type,thinking.budget_tokens,thinking.budgetTokens,thinking.display,effort,sendReasoning,enable_thinking,thinking_budget,incremental_output,disable_reasoning,reasoning_budget,chat_template_kwargs.enable_thinking,chat_template_kwargs.thinking,chat_template_kwargs.thinking_mode,chat_template_kwargs.thinking_budget,extra_body.google.thinking_config.thinking_budget,extra_body.google.thinking_config.include_thoughts,extra_body.thinking.type,extra_body.thinking_budget,extra_body.reasoning_effort,thinkingConfig.includeThoughts,thinkingConfig.thinkingBudget,thinkingConfig.thinkingLevel,reasoningConfig.type,reasoningConfig.budgetTokens,reasoningConfig.maxReasoningEffort,think`.split(
      `,`
    )
  ),
  es = q(X(Go)),
  ts = G({
    target: $o,
    value: K(`source`, [
      G({ source: J(`literal`), value: oo([z(), H(), U()]) }),
      G({ source: J(`effort`) }),
      G({ source: J(`budget`) }),
      G({ source: J(`assistant-summary`) })
    ])
  }),
  ns = G({
    target: $o,
    value: K(`source`, [
      G({ source: J(`literal`), value: oo([z(), H(), U()]) }),
      G({ source: J(`effort`) }),
      G({ source: J(`assistant-summary`) })
    ])
  }),
  rs = G({
    min: H().nonnegative().optional(),
    autoValue: H().optional(),
    clampToMaxTokens: U().optional(),
    missing: K(`type`, [
      G({ type: J(`omit-value`) }),
      G({ type: J(`omit-mode`) }),
      G({ type: J(`fallback`), value: H() })
    ])
  }),
  is = po(es, es).optional(),
  as = oo([
    G({ operations: W(ns).min(1), effortMap: is }),
    G({
      operations: W(ts)
        .min(1)
        .refine((e) => e.some((e) => e.value.source === `budget`), {
          message: `reasoning budget mode must contain a budget operation`
        }),
      effortMap: is,
      budget: rs
    })
  ]),
  os = G({
    disabled: J(!0).optional(),
    default: as.optional(),
    off: as.optional(),
    auto: as.optional(),
    effort: as.optional()
  }).refine((e) => e.disabled === !0 || e.default || e.off || e.auto || e.effort, {
    message: `reasoning wire profile must declare a mode or be disabled`
  })
G({ wire: os, budgetWire: os.optional() })
const ss = q(X(Y)),
  cs = X(Y),
  ls = q([`global`, `cn`]),
  us = q([`openai-priority`, `claude-code`]),
  ds = q([`standard`, `auto`, `fast`, `flex`]),
  fs = W(ds)
    .min(1)
    .refine((e) => new Set(e).size === e.length, { message: `service tier options must be unique` })
    .refine((e) => e.includes(`standard`), { message: `service tier options must include standard` }),
  ps = G({
    default: ds,
    options: fs,
    wire: G({
      delivery: K(`type`, [
        G({ type: J(`provider-option`), key: z().min(1) }),
        G({ type: J(`request-body`), key: z().min(1) })
      ]),
      values: po(ds, z().min(1))
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
  ms = G({
    id: q(X(Bo)),
    modelScope: q(X(Vo)).default(Vo.MODEL_DEPENDENT),
    endpointTypes: Q(ss).optional(),
    vendors: Q(q(Object.keys(Qo))).optional()
  }),
  $ = (e) => G({ type: J(e), wire: os.optional() }),
  hs = K(`type`, [$(`openai-chat`), $(`openai-responses`), $(`anthropic`), $(`gemini`), $(`ollama`), $(`none`)])
hs.options.map((e) => e.shape.type.value)
const gs = G({
    website: G({ official: V().optional(), docs: V().optional(), apiKey: V().optional(), models: V().optional() })
  }),
  _s = G({ streamOptions: U().optional(), developerRole: U().optional(), reasoningSummary: U().optional() }),
  vs = G({
    baseUrl: V().optional(),
    modelsApiUrls: G({
      default: V().optional(),
      embedding: V().optional(),
      image: V().optional(),
      reranker: V().optional()
    }).optional(),
    reasoningFormat: hs.optional(),
    adapterFamily: z().optional(),
    dialect: _s.optional(),
    requestControls: G({ serviceTier: ps.optional() }).optional()
  }),
  ys = G({
    version: Jo,
    providers: Q(
      G({
        id: qo,
        presetProviderId: qo.optional(),
        name: z(),
        availableInEditions: Q(ls, { min: 1 }).optional(),
        description: z().optional(),
        endpointConfigs: fo(
          z().refine((e) => cs.includes(e), {
            message: `Invalid endpoint type key, must be one of: ${X(Y).join(`, `)}`
          }),
          vs
        ).optional(),
        defaultChatEndpoint: ss.nullable().default(null),
        modelListSource: q([`api`, `registry`]).default(`api`),
        authMethods: Q(q([`api-key`, `oauth`, `external-cli`])).optional(),
        authOptional: U().default(!1),
        serverTools: Q(ms).default([]),
        reportsActualCost: U().default(!1),
        reportedCostCurrency: Xo,
        fastMode: G({ transport: us, serviceTier: z().optional() }).optional(),
        metadata: Zo.and(gs)
      }).refine((e) => (e.endpointConfigs && e.defaultChatEndpoint ? e.defaultChatEndpoint in e.endpointConfigs : !0), {
        message: `defaultChatEndpoint must exist as a key in endpointConfigs`
      })
    )
  }),
  bs = q(X(Uo)),
  xs = q(X(zo)),
  Ss = q(X(Ho)),
  Cs = G({ min: H().nonnegative().optional(), max: H().positive().optional(), default: H().nonnegative().optional() })
    .refine((e) => (e.min == null) == (e.max == null), { message: `min and max must be both present or both absent` })
    .refine((e) => e.min == null || e.max == null || e.min <= e.max, {
      message: `min must be less than or equal to max`
    }),
  ws = q(X(Go)),
  Ts = K(`kind`, [
    G({ kind: J(`effort`), values: Q(ws, { min: 1 }), default: ws.optional() }),
    G({ kind: J(`budget`), min: H().nonnegative(), max: H().positive(), default: H().nonnegative().optional() }),
    G({ kind: J(`toggle`), default: U().optional() })
  ]),
  Es = q([`effort`, `budget`])
G({
  pattern: z().refine(
    (e) => {
      try {
        return new RegExp(e, `i`), !0
      } catch {
        return !1
      }
    },
    { message: `pattern must be a valid regular expression` }
  ),
  effort: Q(ws, { min: 1 }).optional(),
  toggle: U().optional(),
  budget: G({ min: H().nonnegative(), max: H().positive() })
    .refine((e) => e.min <= e.max, { message: `budget min must be <= max` })
    .optional(),
  template: J(!0).optional(),
  wireDialect: Es.optional()
}).refine(
  (e) =>
    e.template !== !0 || e.effort !== void 0 || e.toggle !== void 0 || e.budget !== void 0 || e.wireDialect !== void 0,
  { message: `a template rule with no knobs declares nothing — drop it or make it a profile` }
)
const Ds = G({
    controls: Q(Ts).optional(),
    thinkingTokenLimits: Cs.optional(),
    supportedEfforts: Q(ws).optional(),
    defaultEffort: ws.optional(),
    wireDialect: Es.optional()
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
  Os = q([`generate`, `edit`, `remix`, `upscale`, `merge`]),
  ks = G({ type: J(`switch`), default: U().optional() }),
  As = G({
    type: J(`enum`),
    options: W(z()).min(1),
    default: z().optional(),
    render: q([`select`, `chips`]).optional(),
    columns: H().int().positive().optional()
  }),
  js = G({ type: J(`range`), min: H(), max: H(), default: H().optional(), step: H().optional() }).refine(
    (e) => e.min <= e.max,
    { message: `min must be ≤ max` }
  ),
  Ms = G({
    type: J(`range`),
    min: H().int(),
    max: H().int(),
    default: H().int().optional(),
    step: H().int().positive().default(1)
  }).refine((e) => e.min <= e.max, { message: `min must be ≤ max` }),
  Ns = K(`type`, [
    ks,
    As,
    js,
    G({ type: J(`size`), minSide: H(), maxSide: H(), pairedEnumKey: z().optional() }),
    G({ type: J(`text`), multiline: U().optional() })
  ]),
  Ps = [Ho.NUM_IMAGES, Ho.MAX_IMAGES, Ho.NUM_INFERENCE_STEPS, Ho.SAFETY_TOLERANCE, Ho.OUTPUT_COMPRESSION],
  Fs = G({
    modes: po(
      Os,
      G({
        supports: po(Ss, Ns).transform((e, t) => {
          let n = { ...e }
          for (let r of Ps) {
            let i = e[r]
            if (i === void 0) continue
            let a = Ms.safeParse(i)
            if (a.success) n[r] = a.data
            else for (let e of a.error.issues) t.addIssue({ ...e, path: [r, ...e.path] })
          }
          return n
        }),
        maxInputImages: H().int().positive().optional(),
        vendorTransport: G({
          endpoint: z().regex(/^\/(?!\/)/, `vendor transport endpoint must be a root-relative path, not a URL`),
          isSync: U().optional()
        }).optional(),
        requirePrompt: U().optional()
      })
    )
  }),
  Is = G({
    temperature: G({ supported: U(), range: Yo.optional() }).default({ supported: !0 }),
    topP: G({ supported: U(), range: Yo.optional() }).default({ supported: !0 }),
    topK: G({ supported: U(), range: Yo.optional() }).default({ supported: !1 }),
    frequencyPenalty: U().default(!0),
    presencePenalty: U().default(!0),
    maxTokens: U().default(!0),
    stopSequences: U().default(!0),
    systemMessage: U().default(!0)
  }),
  Ls = G({
    input: Z,
    output: Z,
    cacheRead: Z.optional(),
    cacheWrite: Z.optional(),
    inputTokenTiers: W(
      G({
        minInputTokens: H().int().positive().refine(Number.isSafeInteger),
        input: Z,
        output: Z,
        cacheRead: Z.optional(),
        cacheWrite: Z.optional()
      })
    ).optional(),
    perImage: G({ price: H(), currency: Xo, unit: q([`image`, `pixel`]).optional() }).optional(),
    perMinute: G({ price: H(), currency: Xo }).optional()
  })
function Rs(e, t) {
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
    r = n[0]?.rate.currency ?? Wo.USD
  for (let { rate: e, path: i } of n)
    (e.currency ?? Wo.USD) !== r &&
      t.addIssue({ code: `custom`, path: [...i, `currency`], message: `pricing currencies must match` })
}
const zs = Ls.superRefine(Rs),
  Bs = Ls.partial().superRefine(Rs),
  Vs = G({
    version: Jo,
    models: Q(
      G({
        id: Ko,
        name: z(),
        description: z().optional(),
        capabilities: Q(xs)
          .refine((e) => new Set(e).size === e.length, { message: `Capabilities must be unique` })
          .optional(),
        inputModalities: Q(bs)
          .refine((e) => new Set(e).size === e.length, { message: `Input modalities must be unique` })
          .optional(),
        outputModalities: Q(bs)
          .refine((e) => new Set(e).size === e.length, { message: `Output modalities must be unique` })
          .optional(),
        endpointTypes: Q(ss).optional(),
        contextWindow: H().optional(),
        maxOutputTokens: H().optional(),
        maxInputTokens: H().optional(),
        pricing: zs.optional(),
        reasoning: Ds.optional(),
        parameterSupport: Is.optional(),
        imageGeneration: Fs.optional(),
        family: z().optional(),
        ownedBy: z().optional(),
        openWeights: U().optional(),
        metadata: Zo
      })
    )
  }),
  Hs = G({ add: Q(xs).optional(), remove: Q(xs).optional(), force: Q(xs).optional() }),
  Us = q([
    Y.OPENAI_RESPONSES,
    Y.OPENAI_CHAT_COMPLETIONS,
    Y.ANTHROPIC_MESSAGES,
    Y.GOOGLE_GENERATE_CONTENT,
    Y.OLLAMA_CHAT,
    Y.OLLAMA_GENERATE,
    Y.OPENAI_TEXT_COMPLETIONS
  ]),
  Ws = G({ support: Ds.optional(), wire: os.optional() }).refine((e) => e.support || e.wire, {
    message: `provider-model reasoning contract must declare support or wire`
  }),
  Gs = G({
    version: Jo,
    overrides: Q(
      G({
        providerId: qo,
        modelId: Ko,
        apiModelId: z().optional(),
        modelVariants: W(z().min(1)).optional(),
        capabilities: Hs.optional(),
        limits: G({
          contextWindow: H().optional(),
          maxOutputTokens: H().optional(),
          maxInputTokens: H().optional()
        }).optional(),
        pricing: Bs.optional(),
        reasoningContracts: po(Us, Ws).optional(),
        supportsFastMode: U().optional(),
        requestControls: G({ serviceTier: G({ options: fs }).optional() }).optional(),
        parameterSupport: Is.partial().optional(),
        endpointTypes: Q(ss).optional(),
        inputModalities: Q(bs).optional(),
        outputModalities: Q(bs).optional(),
        name: z().optional(),
        description: z().optional(),
        family: z().optional(),
        ownedBy: z().optional(),
        imageGeneration: Fs.optional(),
        disabled: U().optional(),
        replaceWith: Ko.optional(),
        reason: z().optional()
      })
    )
  }),
  Ks = `anthropic|amazon|meta|google|mistralai|cohere|openai|ai21|microsoft|nvidia`
;`${Ks}`, `${Ks}`
const qs = [`models.json`, `providers.json`, `provider-models.json`]
G({
  minAppVersion: z().min(1),
  sourceAppVersion: z().min(1),
  revision: H().int().nonnegative(),
  schemaVersion: H().int(),
  files: fo(z(), z())
})
const Js = { 'models.json': Vs, 'providers.json': ys, 'provider-models.json': Gs },
  Ys = 2
function Xs(e) {
  return e && typeof e == `object` && `issues` in e
    ? JSON.stringify(e.issues)
    : e instanceof Error
      ? e.message
      : String(e)
}
function Zs(e, t) {
  Js[e].parse(t)
}
function Qs(n) {
  for (let r of qs)
    try {
      Zs(r, JSON.parse(e(t.join(n, r), `utf8`)))
    } catch (e) {
      throw Error(`${r} is not compatible with registry schema v2: ${Xs(e)}`)
    }
}
if (process.argv[1] && t.resolve(process.argv[1]) === n(import.meta.url)) {
  let e = process.argv[2]
  if (!e) console.error(`Usage: node vN-validator.mjs <catalog-data-directory>`), (process.exitCode = 1)
  else
    try {
      Qs(t.resolve(e)), console.log(`Catalog is compatible with frozen registry schema v2`)
    } catch (e) {
      console.error(e instanceof Error ? e.message : e), (process.exitCode = 1)
    }
}
export { Ys as schemaVersion, Qs as validateCatalogDirectory, Zs as validateCatalogFile }
