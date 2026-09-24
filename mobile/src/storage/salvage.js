// salvage.js — best-effort structural recovery of a damaged habit.json.
//
// WHY THIS EXISTS (2026-09 remote incident): two overlapping SAF document
// writes interleaved their chunked output, leaving habit.json holding a
// valid JSON PREFIX, a seam of mixed bytes, and a valid JSON TAIL. JSON.parse
// rejects the whole file; this scanner instead walks the text structurally
// and keeps every complete value it can reach:
//
//  - complete values in the undamaged prefix are always kept
//  - when a value fails to parse, the scanner RESYNCHRONIZES at the next
//    plausible token boundary — a full `"key":` shape inside objects, a
//    value start inside arrays — dropping only the damaged fragment
//  - a container that can neither continue nor close truncates gracefully
//    with everything complete it already collected
//
// Guarantees:
//  - NEVER invents data: every kept byte comes from the input; the result is
//    a subset of the file's own values (damage may DROP entries, never alter
//    surviving ones — keys/strings/numbers are taken verbatim)
//  - BOUNDED work: depth, resync count and skipped-byte budgets cap the scan
//    on pathological inputs
//  - The result is NOT trusted blindly: the caller runs it through the same
//    schema gate + heal as a normal load, and the damaged original is
//    preserved byte-for-byte in .corrupt/ before anything is written
//
// Pure module — no imports, no I/O, runs identically under Hermes and Node.

const MAX_DEPTH = 64 // real files nest ~5 levels
const MAX_RESYNCS = 24
const MAX_SKIPPED = 262144 // 256 KB of cumulative damage is plenty

// result shapes:
//   parseValue → { ok: true, value, end, truncated? } | { ok: false, at }
//   salvageJson → { ok: true, value, droppedBytes, resyncs } | { ok: false, reason }

function skipWs(t, i) {
  while (i < t.length) {
    const c = t[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++
    else break
  }
  return i
}

function isDigit(c) {
  return c >= '0' && c <= '9'
}

function isValueStart(t, i) {
  if (i >= t.length) return false
  const c = t[i]
  return (
    c === '{' ||
    c === '[' ||
    c === '"' ||
    c === '-' ||
    isDigit(c) ||
    t.startsWith('true', i) ||
    t.startsWith('false', i) ||
    t.startsWith('null', i)
  )
}

function isLiteralStart(t, i) {
  return t.startsWith('true', i) || t.startsWith('false', i) || t.startsWith('null', i)
}

// --- primitives -----------------------------------------------------------

function unescape(t, start, end) {
  // fast path: no backslash inside the slice
  let bs = t.indexOf('\\', start)
  if (bs === -1 || bs >= end) return t.substring(start, end)
  let out = ''
  let j = start
  while (j < end) {
    const c = t[j]
    if (c !== '\\') {
      out += c
      j++
      continue
    }
    const e = t[j + 1]
    switch (e) {
      case '"': out += '"'; j += 2; break
      case '\\': out += '\\'; j += 2; break
      case '/': out += '/'; j += 2; break
      case 'b': out += '\b'; j += 2; break
      case 'f': out += '\f'; j += 2; break
      case 'n': out += '\n'; j += 2; break
      case 'r': out += '\r'; j += 2; break
      case 't': out += '\t'; j += 2; break
      case 'u': {
        const hex = t.substring(j + 2, j + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16))
          j += 6
        } else {
          out += c // tolerate a malformed escape instead of failing the string
          j++
        }
        break
      }
      default:
        out += c // tolerate
        j++
    }
  }
  return out
}

function parseString(t, i) {
  // t[i] must be '"'
  let j = i + 1
  while (j < t.length) {
    const c = t[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '"') {
      return { ok: true, value: unescape(t, i + 1, j), end: j + 1 }
    }
    j++
  }
  return { ok: false, at: i } // unterminated
}

function parseNumber(t, i) {
  let j = i
  if (t[j] === '-') j++
  let digits = 0
  while (j < t.length && isDigit(t[j])) {
    j++
    digits++
  }
  if (digits === 0) return { ok: false, at: i }
  if (t[j] === '.') {
    j++
    let frac = 0
    while (j < t.length && isDigit(t[j])) {
      j++
      frac++
    }
    if (frac === 0) return { ok: false, at: i }
  }
  if (t[j] === 'e' || t[j] === 'E') {
    j++
    if (t[j] === '+' || t[j] === '-') j++
    let exp = 0
    while (j < t.length && isDigit(t[j])) {
      j++
      exp++
    }
    if (exp === 0) return { ok: false, at: i }
  }
  return { ok: true, value: Number(t.substring(i, j)), end: j }
}

// --- resynchronization ----------------------------------------------------

function budgetLeft(b) {
  return b.resyncs < MAX_RESYNCS && b.skipped < MAX_SKIPPED
}

// Scan forward from `from` for the next position where a plausible
// object key ("string" + ':' + value start) or array element (value
// start, strings must close) begins. Always skips at least one byte, so
// every accepted resync strictly advances the parse. Returns the new
// position or null when the input offers no plausible continuation.
function findResync(t, from, budget, mode) {
  if (!budgetLeft(budget)) return null
  let j = from + 1
  while (j < t.length) {
    if (mode === 'object') {
      if (t[j] === '"') {
        const k = parseString(t, j)
        if (k.ok) {
          const afterKey = skipWs(t, k.end)
          if (t[afterKey] === ':' && isValueStart(t, skipWs(t, afterKey + 1))) {
            budget.resyncs++
            budget.skipped += j - from
            return j
          }
        }
      }
    } else {
      // 'array' / 'top': any plausible value start (strings must close)
      if (isValueStart(t, j)) {
        if (t[j] !== '"') {
          budget.resyncs++
          budget.skipped += j - from
          return j
        }
        const s = parseString(t, j)
        if (s.ok) {
          budget.resyncs++
          budget.skipped += j - from
          return j
        }
      }
    }
    j++
  }
  return null
}

// --- containers -----------------------------------------------------------

function parseObject(t, i, budget, depth) {
  const obj = {}
  let j = skipWs(t, i + 1)
  if (t[j] === '}') return { ok: true, value: obj, end: j + 1 }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (t[j] === '"') {
      const k = parseString(t, j)
      if (k.ok) {
        const afterKey = skipWs(t, k.end)
        if (t[afterKey] === ':') {
          const afterColon = skipWs(t, afterKey + 1)
          const v = parseValue(t, afterColon, budget, depth + 1)
          if (v.ok) {
            obj[k.value] = v.value
            const afterVal = skipWs(t, v.end)
            if (t[afterVal] === ',') {
              j = skipWs(t, afterVal + 1)
              continue
            }
            if (t[afterVal] === '}') return { ok: true, value: obj, end: afterVal + 1 }
            if (afterVal >= t.length) return { ok: true, value: obj, end: afterVal, truncated: true }
            const rs = findResync(t, afterVal, budget, 'object')
            if (rs == null) return { ok: true, value: obj, end: afterVal, truncated: true }
            j = rs
            continue
          }
        }
      }
    }
    // the pair starting at j is damaged (or j is mid-garbage)
    if (j >= t.length) return { ok: true, value: obj, end: j, truncated: true }
    const rs = findResync(t, j, budget, 'object')
    if (rs == null) return { ok: true, value: obj, end: j, truncated: true }
    j = rs
  }
}

function parseArray(t, i, budget, depth) {
  const arr = []
  let j = skipWs(t, i + 1)
  if (t[j] === ']') return { ok: true, value: arr, end: j + 1 }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (isValueStart(t, j)) {
      const v = parseValue(t, j, budget, depth + 1)
      if (v.ok) {
        arr.push(v.value)
        const afterVal = skipWs(t, v.end)
        if (t[afterVal] === ',') {
          j = skipWs(t, afterVal + 1)
          continue
        }
        if (t[afterVal] === ']') return { ok: true, value: arr, end: afterVal + 1 }
        if (afterVal >= t.length) return { ok: true, value: arr, end: afterVal, truncated: true }
        const rs = findResync(t, afterVal, budget, 'array')
        if (rs == null) return { ok: true, value: arr, end: afterVal, truncated: true }
        j = rs
        continue
      }
    }
    if (j >= t.length) return { ok: true, value: arr, end: j, truncated: true }
    const rs = findResync(t, j, budget, 'array')
    if (rs == null) return { ok: true, value: arr, end: j, truncated: true }
    j = rs
  }
}

function parseValue(t, i, budget, depth) {
  if (depth > MAX_DEPTH) return { ok: false, at: i }
  const c = t[i]
  if (c === '{') return parseObject(t, i, budget, depth)
  if (c === '[') return parseArray(t, i, budget, depth)
  if (c === '"') return parseString(t, i)
  if (c === '-' || isDigit(c)) return parseNumber(t, i)
  if (isLiteralStart(t, i)) {
    if (t.startsWith('true', i)) return { ok: true, value: true, end: i + 4 }
    if (t.startsWith('false', i)) return { ok: true, value: false, end: i + 6 }
    return { ok: true, value: null, end: i + 4 }
  }
  return { ok: false, at: i }
}

// --- entry point ----------------------------------------------------------

// Recover the readable structure of a damaged JSON document.
// Returns { ok: true, value, droppedBytes, resyncs } or { ok: false, reason }.
export function salvageJson(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, reason: 'the file is empty' }
  }
  const budget = { resyncs: 0, skipped: 0 }
  let i = skipWs(text, 0)
  let attempts = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (isValueStart(text, i)) {
      const r = parseValue(text, i, budget, 0)
      if (r.ok) {
        const value = r.value
        if (
          value === null ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.keys(value).length === 0
        ) {
          // salvage only runs after JSON.parse failed — an empty/scalar
          // result means nothing real was recovered (a legitimate `{}`
          // would have parsed normally and never reached the salvager)
          return { ok: false, reason: 'nothing readable was found in the file' }
        }
        return { ok: true, value, droppedBytes: budget.skipped, resyncs: budget.resyncs }
      }
    }
    if (attempts >= 3) break
    const next = findResync(text, i, budget, 'top')
    if (next == null) break
    i = next
    attempts++
  }
  return { ok: false, reason: 'no readable JSON found in the file' }
}
