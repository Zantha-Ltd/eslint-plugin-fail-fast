/**
 * no-error-masking
 *
 * Inside `catch (err) { ... }`, flags calls that look like error-surface
 * functions (setError, toast.error, setMessage, etc.) whose first argument
 * does not surface the caught err. The anti-pattern: the developer
 * console.logs err but shows the user a generic "Something went wrong" —
 * user has no idea what actually broke, real error only in browser console.
 *
 *   // ❌ flagged
 *   catch (err) {
 *     console.error(err)
 *     setError('Something went wrong')
 *   }
 *
 *   // ✅ allowed — err interpolated into the surface message
 *   catch (err) {
 *     setError(err instanceof Error ? err.message : 'Something went wrong')
 *   }
 *
 *   // ✅ allowed — err chained through a local alias the rule follows
 *   catch (err) {
 *     const message = err instanceof Error ? err.message : 'Unknown'
 *     setError(message)
 *     // or: toast.error(`Save failed: ${message}`)
 *   }
 *
 * Surface-function detection is name-pattern-based:
 *   - Identifier callees matching `/^(set|show|display|report|notify|flash)[A-Z]/`
 *     (e.g. setError, showMessage, reportWarning, displayAlert).
 *   - Identifier callees `toast*` / `flash*` ending in an error/warning/etc. suffix
 *     (e.g. toastError, flashMessage).
 *   - Bare `alert(...)` (browser).
 *   - Member expressions `<obj>.error` / `.warn` / `.warning` / `.fail` /
 *     `.failure` (e.g. toast.error, notify.warn, ui.failure).
 *
 * This list is deliberately fuzzy-but-narrow: it catches the common
 * React / toast-library / UI-kit patterns without flagging every
 * `set*` setter. If a surface function isn't matched, the rule silently
 * passes — false positives are worse than false negatives.
 *
 * `no-swallowing-catch` already catches the case where err is bound but
 * NEVER referenced (single setError('literal') with no other err usage).
 * This rule is scoped to the harder gap: err is "touched" somewhere
 * (console.error, a logger, etc.) but the user-visible surface is still
 * a literal.
 */

const { referencesName } = require('../utils')

// Prefix that indicates a UI state setter. Requires camelCase
// (setError not setstatus) to avoid matching random lowercase functions.
const PREFIX_RE = /^(set|show|display|report|notify|flash)[A-Z]/
// Must ALSO contain an error-like word — the prefix alone matches
// setState/setUser/setLoading, which aren't error surfaces.
const ERROR_WORD_RE = /(error|warning|message|failure|fault|fail|alert|issue|notice|problem)/i
// Standalone toast / flash callees (no prefix split).
const TOAST_RE = /^(toast|flash)(Error|Warning|Message|Failure|Fault|Alert|Status|Issue|Notice|Info)s?$/i
const SURFACE_MEMBER_PROPS = new Set(['error', 'warn', 'warning', 'fail', 'failure'])

function isSurfaceIdent(name) {
  if (!name) return false
  if (name === 'alert') return true
  if (TOAST_RE.test(name)) return true
  if (PREFIX_RE.test(name) && ERROR_WORD_RE.test(name)) return true
  return false
}

function describeCallee(callee) {
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    const obj = callee.object.type === 'Identifier' ? callee.object.name : '<expr>'
    return `${obj}.${callee.property.name}`
  }
  return '<call>'
}

function getSurfaceCall(node) {
  if (!node || node.type !== 'CallExpression') return null
  const callee = node.callee
  if (callee.type === 'Identifier' && isSurfaceIdent(callee.name)) {
    return { call: node, firstArg: node.arguments[0], calleeLabel: callee.name }
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    SURFACE_MEMBER_PROPS.has(callee.property.name)
  ) {
    // Exclude console.error — no-swallowing-catch already owns that.
    if (callee.object.type === 'Identifier' && callee.object.name === 'console') return null
    return { call: node, firstArg: node.arguments[0], calleeLabel: describeCallee(callee) }
  }
  return null
}

function collectSurfaceCalls(node, out) {
  if (!node || typeof node !== 'object') return
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  ) {
    return
  }
  const surface = getSurfaceCall(node)
  if (surface) out.push(surface)

  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const value = node[key]
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v === 'object') collectSurfaceCalls(v, out)
    } else if (typeof value.type === 'string') {
      collectSurfaceCalls(value, out)
    }
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow catch-block error surfaces (setError, toast.error, …) that pass a literal string without referencing the caught err.',
      category: 'Possible Errors',
    },
    schema: [],
    messages: {
      masking:
        '`{{callee}}(...)` in a catch block does not surface the caught error ({{errName}}) — user sees a generic message while the real failure is invisible. Interpolate {{errName}}.message into the argument (e.g. `{{errName}}.message` or `{{errName}} instanceof Error ? {{errName}}.message : \'fallback\'`). See fail-fast-coding skill.',
    },
  },

  create(context) {
    return {
      CatchClause(node) {
        const param = node.param
        if (!param || param.type !== 'Identifier') return
        if (param.name.startsWith('_')) return
        const errName = param.name

        // Locals aliased from err-referencing expressions — the same
        // escape hatch as no-generic-api-error for the canonical
        //   const msg = err instanceof Error ? err.message : 'X'
        //   setError(msg)
        // fix pattern.
        const errDerivedLocals = new Set()
        for (const stmt of node.body.body) {
          if (stmt.type !== 'VariableDeclaration') continue
          for (const decl of stmt.declarations) {
            if (decl.id.type !== 'Identifier') continue
            if (decl.init && referencesName(decl.init, errName)) {
              errDerivedLocals.add(decl.id.name)
            }
          }
        }

        function valueSurfacesErr(value) {
          if (!value) return false
          if (referencesName(value, errName)) return true
          if (value.type === 'Identifier' && errDerivedLocals.has(value.name)) return true
          if (value.type === 'TemplateLiteral') {
            return value.expressions.some(valueSurfacesErr)
          }
          if (value.type === 'BinaryExpression' && value.operator === '+') {
            return valueSurfacesErr(value.left) || valueSurfacesErr(value.right)
          }
          if (value.type === 'ConditionalExpression') {
            return valueSurfacesErr(value.consequent) || valueSurfacesErr(value.alternate)
          }
          if (value.type === 'LogicalExpression') {
            return valueSurfacesErr(value.left) || valueSurfacesErr(value.right)
          }
          if (value.type === 'ObjectExpression') {
            return value.properties.some(p =>
              p.type === 'Property' && valueSurfacesErr(p.value)
            )
          }
          return false
        }

        const calls = []
        collectSurfaceCalls(node.body, calls)

        for (const c of calls) {
          if (!c.firstArg) continue
          if (valueSurfacesErr(c.firstArg)) continue

          context.report({
            node: c.firstArg,
            messageId: 'masking',
            data: { callee: c.calleeLabel, errName },
          })
        }
      },
    }
  },
}
