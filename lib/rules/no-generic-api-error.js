/**
 * no-generic-api-error
 *
 * Inside `catch (err) { ... }`, flags API error responses whose body is an
 * object literal with a literal `error` string that does not reference the
 * caught err. These responses mask the real failure: callers see
 * "Server error" with no pointer to what actually broke, while the real
 * message only lives in the route's console log.
 *
 *   // ❌ flagged
 *   catch (err) {
 *     console.error(err)
 *     return NextResponse.json({ error: 'Server error' }, { status: 500 })
 *   }
 *
 *   // ✅ allowed — err interpolated into the error message
 *   catch (err) {
 *     const message = err instanceof Error ? err.message : 'Unknown error'
 *     return NextResponse.json({ error: message }, { status: 500 })
 *   }
 *
 * Detection (narrow by design):
 *   - The catch body contains a CallExpression whose callee is
 *     `NextResponse.json`, `Response.json`, or `new NextResponse(...)`.
 *   - The SECOND argument is an ObjectExpression with a `status` property
 *     whose value is a numeric Literal >= 500. (4xx responses are typically
 *     deliberate client errors — out of scope.)
 *   - The FIRST argument is an ObjectExpression containing an `error` (or
 *     `message`) property.
 *   - That property's value does NOT reference the caught err anywhere in
 *     its subtree (descending through templates, ternaries, calls, etc.).
 *
 * If any of these checks doesn't apply (status not a literal, body not an
 * object, error key missing), the rule silently passes — false positives
 * are worse than false negatives for this class of anti-pattern.
 */

const { referencesName } = require('../utils')

const ERROR_LIKE_KEYS = new Set(['error', 'message', 'detail'])

function isStatusGte500(optsNode) {
  if (!optsNode || optsNode.type !== 'ObjectExpression') return false
  for (const prop of optsNode.properties) {
    if (prop.type !== 'Property' || prop.computed) continue
    const key = prop.key.type === 'Identifier' ? prop.key.name
      : (prop.key.type === 'Literal' ? prop.key.value : null)
    if (key !== 'status') continue
    if (prop.value.type !== 'Literal') return false
    return typeof prop.value.value === 'number' && prop.value.value >= 500
  }
  return false
}

function findErrorProperty(bodyNode) {
  if (!bodyNode || bodyNode.type !== 'ObjectExpression') return null
  for (const prop of bodyNode.properties) {
    if (prop.type !== 'Property' || prop.computed) continue
    const key = prop.key.type === 'Identifier' ? prop.key.name
      : (prop.key.type === 'Literal' ? prop.key.value : null)
    if (ERROR_LIKE_KEYS.has(key)) return prop
  }
  return null
}

function isNextResponseJsonCall(callee) {
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false
  if (callee.property.type !== 'Identifier' || callee.property.name !== 'json') return false
  if (callee.object.type !== 'Identifier') return false
  return callee.object.name === 'NextResponse' || callee.object.name === 'Response'
}

function isNewNextResponse(node) {
  if (!node || node.type !== 'NewExpression') return false
  if (node.callee.type !== 'Identifier') return false
  return node.callee.name === 'NextResponse' || node.callee.name === 'Response'
}

/**
 * Collect calls that look like API error responses in the catch body,
 * descending through nested blocks / if / try but not into nested functions.
 */
function collectResponseCalls(node, out) {
  if (!node || typeof node !== 'object') return
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  ) {
    return
  }
  if (node.type === 'CallExpression' && isNextResponseJsonCall(node.callee)) {
    out.push({ args: node.arguments, loc: node })
  } else if (isNewNextResponse(node)) {
    out.push({ args: node.arguments, loc: node })
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const value = node[key]
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v && typeof v === 'object') collectResponseCalls(v, out)
      }
    } else if (typeof value.type === 'string') {
      collectResponseCalls(value, out)
    }
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow API error responses (status >= 500) that return a literal error string without chaining the caught err.',
      category: 'Possible Errors',
    },
    schema: [],
    messages: {
      genericError:
        'API error response (status {{status}}) returns a literal "{{key}}" string that does not reference the caught error ({{errName}}). Surface err.message in the response body so callers see the real failure, not just "Server error". See fail-fast-coding skill.',
    },
  },

  create(context) {
    return {
      CatchClause(node) {
        const param = node.param
        if (!param || param.type !== 'Identifier') return
        if (param.name.startsWith('_')) return
        const errName = param.name

        // Collect the names of locals initialised from an err-referencing
        // expression. The skill's documented fix pattern is:
        //   const message = err instanceof Error ? err.message : 'Unknown'
        //   return NextResponse.json({ error: message }, { status: 500 })
        // A static check that requires the error VALUE itself to reference err
        // would flag that canonical pattern — so we also accept Identifier
        // values whose declaration is in this catch body with an init that
        // contains err.
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
          // Descend through compositions that commonly wrap an err-derived
          // alias in a contextual prefix:
          //   `Failed to X: ${msg}`  →  TemplateLiteral with expressions=[msg]
          //   'prefix: ' + msg       →  BinaryExpression('+', 'prefix: ', msg)
          //   flag ? msg : fallback  →  ConditionalExpression
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
          return false
        }

        const calls = []
        collectResponseCalls(node.body, calls)

        for (const c of calls) {
          const [bodyArg, optsArg] = c.args
          if (!bodyArg || bodyArg.type !== 'ObjectExpression') continue
          if (!isStatusGte500(optsArg)) continue

          const errorProp = findErrorProperty(bodyArg)
          if (!errorProp) continue
          if (valueSurfacesErr(errorProp.value)) continue

          const statusProp = optsArg.properties.find(p =>
            p.type === 'Property' && !p.computed &&
            ((p.key.type === 'Identifier' && p.key.name === 'status') ||
             (p.key.type === 'Literal' && p.key.value === 'status'))
          )
          const status = statusProp && statusProp.value.type === 'Literal' ? statusProp.value.value : '?'
          const key = errorProp.key.type === 'Identifier' ? errorProp.key.name : errorProp.key.value

          context.report({
            node: errorProp,
            messageId: 'genericError',
            data: { status, key, errName },
          })
        }
      },
    }
  },
}
