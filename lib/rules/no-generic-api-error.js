/**
 * no-generic-api-error
 *
 * Inside `catch (err) { ... }`, flags API error responses whose body is an
 * object literal with a literal `error` string that does not reference the
 * caught err. These responses mask the real failure: callers see
 * "Server error" with no pointer to what actually broke, while the real
 * message only lives in the route's console log.
 *
 * Covered API shapes (all require status >= 500 as a numeric literal):
 *
 *   // Next.js App Router / web standard
 *   return NextResponse.json({ error: 'Server error' }, { status: 500 })
 *   return Response.json({ error: 'X' }, { status: 500 })
 *   return new NextResponse({ error: 'X' }, { status: 500 })
 *
 *   // Fastify (chained form — .code(N).send(body) or .status(N).send(body))
 *   return reply.code(500).send({ error: 'X' })
 *   reply.status(502).send({ error: 'X' })
 *
 * Detection (narrow by design):
 *   - We only act when we can statically see status >= 500 (numeric Literal).
 *     4xx responses are out of scope (usually deliberate client errors).
 *   - The body argument must be an ObjectExpression with an `error` /
 *     `message` / `detail` property. Opaque builder functions are skipped.
 *   - That property's value does NOT surface the caught err anywhere in
 *     its subtree (descending through templates, ternaries, concatenation,
 *     conditional, logical, and through locals declared in the same catch
 *     body with err-referencing initialisers).
 *
 * If any of these checks doesn't apply (status not a literal, body not an
 * object, error key missing), the rule silently passes — false positives
 * are worse than false negatives for this class of anti-pattern.
 */

const { referencesName } = require('../utils')

const ERROR_LIKE_KEYS = new Set(['error', 'message', 'detail'])
const FASTIFY_STATUS_METHODS = new Set(['code', 'status'])

function getStatusFromOptsObject(optsNode) {
  if (!optsNode || optsNode.type !== 'ObjectExpression') return null
  for (const prop of optsNode.properties) {
    if (prop.type !== 'Property' || prop.computed) continue
    const key = prop.key.type === 'Identifier' ? prop.key.name
      : (prop.key.type === 'Literal' ? prop.key.value : null)
    if (key !== 'status') continue
    if (prop.value.type !== 'Literal') return null
    return typeof prop.value.value === 'number' ? prop.value.value : null
  }
  return null
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
 * Detect Fastify-style `X.code(N).send(body)` or `X.status(N).send(body)`.
 * Returns { body, statusValue } if the chain is statically resolvable with
 * a numeric status literal, otherwise null.
 *
 *   reply.code(500).send({ error: 'X' })
 *   AST:
 *     CallExpression
 *       callee: MemberExpression
 *         object: CallExpression  ← the .code(500) call
 *           callee: MemberExpression .code
 *           arguments: [Literal 500]
 *         property: .send
 *       arguments: [ObjectExpression]
 */
function extractFastifyChain(callNode) {
  if (!callNode || callNode.type !== 'CallExpression') return null
  const callee = callNode.callee
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return null
  if (callee.property.type !== 'Identifier' || callee.property.name !== 'send') return null

  const inner = callee.object
  if (!inner || inner.type !== 'CallExpression') return null
  const innerCallee = inner.callee
  if (!innerCallee || innerCallee.type !== 'MemberExpression' || innerCallee.computed) return null
  if (innerCallee.property.type !== 'Identifier') return null
  if (!FASTIFY_STATUS_METHODS.has(innerCallee.property.name)) return null

  const statusArg = inner.arguments[0]
  if (!statusArg || statusArg.type !== 'Literal' || typeof statusArg.value !== 'number') return null

  const bodyArg = callNode.arguments[0]
  if (!bodyArg) return null

  return { body: bodyArg, statusValue: statusArg.value }
}

/**
 * Normalise every flagged API response to a uniform shape for the inner
 * check loop. Each entry: { body, statusValue, reportNode }.
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

  // NextResponse.json / Response.json
  if (node.type === 'CallExpression' && isNextResponseJsonCall(node.callee)) {
    const [body, opts] = node.arguments
    const statusValue = getStatusFromOptsObject(opts)
    if (body && statusValue !== null) {
      out.push({ body, statusValue, reportNode: node })
    }
  }
  // new NextResponse(...) / new Response(...)
  else if (isNewNextResponse(node)) {
    const [body, opts] = node.arguments
    const statusValue = getStatusFromOptsObject(opts)
    if (body && statusValue !== null) {
      out.push({ body, statusValue, reportNode: node })
    }
  }
  // Fastify reply.code(N).send(body) / reply.status(N).send(body)
  else if (node.type === 'CallExpression') {
    const chain = extractFastifyChain(node)
    if (chain) {
      out.push({ body: chain.body, statusValue: chain.statusValue, reportNode: node })
    }
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
        'Disallow API error responses (status >= 500) that return a literal error string without chaining the caught err. Covers Next.js NextResponse / Response and Fastify reply.code(N).send(...).',
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

        // Collect locals initialised from an err-referencing expression so
        // the skill's documented "const message = ... err ...; { error: message }"
        // fix pattern passes.
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
          return false
        }

        const calls = []
        collectResponseCalls(node.body, calls)

        for (const c of calls) {
          if (c.statusValue < 500) continue
          if (c.body.type !== 'ObjectExpression') continue

          const errorProp = findErrorProperty(c.body)
          if (!errorProp) continue
          if (valueSurfacesErr(errorProp.value)) continue

          const key = errorProp.key.type === 'Identifier' ? errorProp.key.name : errorProp.key.value

          context.report({
            node: errorProp,
            messageId: 'genericError',
            data: { status: c.statusValue, key, errName },
          })
        }
      },
    }
  },
}
