/**
 * require-res-ok-check
 *
 * Flags Response body-parsing methods (`.json()` / `.text()` / `.blob()` /
 * `.arrayBuffer()` / `.formData()`) on a fetch() result when no `.ok`,
 * `.status`, `.statusText`, or `.headers` access is present in the scope
 * that could make the parse conditional on a success status. A non-2xx
 * response gets its error body parsed as if it were success, or throws a
 * cryptic SyntaxError on HTML error pages — both drop the real status on
 * the floor.
 *
 * Three forms covered:
 *
 *   // 1. Assigned-variable form
 *   const res = await fetch(url)
 *   const data = await res.json()              // ❌ flagged
 *
 *   // 2. Parenthesised-await form
 *   const data = await (await fetch(url)).json()  // ❌ flagged
 *
 *   // 3. Promise-chain form — the arrow's parameter is the response, and
 *   //    the parse happens inside the .then. We only flag when the arrow
 *   //    body never touches `.ok` / `.status` / etc. on that parameter.
 *   fetch(url).then(r => r.json())             // ❌ flagged
 *   fetch(url).then(r => { if (!r.ok) throw … ; return r.json() })  // ✅
 *
 * For the assigned-variable form we use ESLint scope analysis — any
 * reference to the variable that reads a check property counts as an ok
 * guard. For the other two forms we walk the enclosing expression / arrow
 * body directly.
 */

const PARSE_METHODS = new Set(['json', 'text', 'blob', 'arrayBuffer', 'formData'])
const CHECK_PROPS = new Set(['ok', 'status', 'statusText', 'headers'])

function isAwaitFetch(node) {
  if (!node || node.type !== 'AwaitExpression') return false
  const call = node.argument
  if (!call || call.type !== 'CallExpression') return false
  return call.callee.type === 'Identifier' && call.callee.name === 'fetch'
}

function isFetchCall(node) {
  if (!node || node.type !== 'CallExpression') return false
  return node.callee.type === 'Identifier' && node.callee.name === 'fetch'
}

/**
 * If `memberNode` is `object.<parseMethod>` and its parent is a
 * CallExpression with `object.<parseMethod>()` as callee, return the parse
 * method name. Otherwise null.
 */
function getParseCallMethod(memberNode) {
  if (!memberNode || memberNode.type !== 'MemberExpression' || memberNode.computed) return null
  if (memberNode.property.type !== 'Identifier') return null
  if (!PARSE_METHODS.has(memberNode.property.name)) return null
  const parent = memberNode.parent
  if (!parent || parent.type !== 'CallExpression' || parent.callee !== memberNode) return null
  return memberNode.property.name
}

/**
 * Walk a subtree and return { hasCheck, parseCalls } for references to an
 * identifier name. Skips nested function bodies (they're a different scope
 * for this purpose).
 */
function scanForParamUsage(node, name) {
  const parseCalls = []
  let hasCheck = false

  function walk(n) {
    if (!n || typeof n !== 'object') return
    if (
      n.type === 'FunctionDeclaration' ||
      n.type === 'FunctionExpression' ||
      n.type === 'ArrowFunctionExpression'
    ) {
      return
    }
    if (
      n.type === 'MemberExpression' &&
      !n.computed &&
      n.object.type === 'Identifier' &&
      n.object.name === name &&
      n.property.type === 'Identifier'
    ) {
      const propName = n.property.name
      if (CHECK_PROPS.has(propName)) {
        hasCheck = true
      } else if (PARSE_METHODS.has(propName)) {
        const parent = n.parent
        if (parent && parent.type === 'CallExpression' && parent.callee === n) {
          parseCalls.push({ call: parent, method: propName })
        }
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue
      const value = n[key]
      if (!value || typeof value !== 'object') continue
      if (Array.isArray(value)) {
        for (const v of value) if (v && typeof v === 'object') walk(v)
      } else if (typeof value.type === 'string') {
        walk(value)
      }
    }
  }

  walk(node)
  return { hasCheck, parseCalls }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require res.ok (or res.status) to be checked before parsing the body of a fetch() response. Covers `const X = await fetch(...)`, `(await fetch(...)).json()`, and `fetch(...).then(r => r.json())`.',
      category: 'Possible Errors',
    },
    schema: [],
    messages: {
      noResOkCheckVar:
        'Response "{{name}}" is parsed with .{{method}}() without checking {{name}}.ok or {{name}}.status first — non-2xx responses silently get treated as success. Add an ok guard before the parse (e.g. `if (!{{name}}.ok) throw new Error(...)`). See fail-fast-coding skill.',
      noResOkCheckAwaitChain:
        'Parenthesised `(await fetch(...)).{{method}}()` parses the response body without a chance to check .ok or .status — non-2xx responses silently get treated as success. Bind the response to a variable first and guard it.',
      noResOkCheckThen:
        '.then((r) => r.{{method}}()) parses the response body without checking r.ok / r.status first — non-2xx responses silently get treated as success. Guard with `if (!r.ok) throw new Error(...)` before the parse.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode()

    return {
      // Form 1: const res = await fetch(url); ...res.json()...
      VariableDeclarator(node) {
        if (!isAwaitFetch(node.init)) return
        if (!node.id || node.id.type !== 'Identifier') return

        const scope = typeof sourceCode.getScope === 'function'
          ? sourceCode.getScope(node)
          : context.getScope()

        const variable = scope.variables.find(v => v.name === node.id.name)
          || scope.references.find(r => r.identifier === node.id)?.resolved
        if (!variable) return

        let hasCheck = false
        const parseCalls = []

        for (const ref of variable.references) {
          const ident = ref.identifier
          if (ref.init) continue
          const parent = ident.parent
          if (
            !parent ||
            parent.type !== 'MemberExpression' ||
            parent.object !== ident ||
            parent.computed ||
            parent.property.type !== 'Identifier'
          ) continue

          const propName = parent.property.name
          if (CHECK_PROPS.has(propName)) {
            hasCheck = true
            continue
          }
          if (PARSE_METHODS.has(propName)) {
            const gp = parent.parent
            if (gp && gp.type === 'CallExpression' && gp.callee === parent) {
              parseCalls.push({ call: gp, method: propName })
            }
          }
        }

        if (hasCheck) return
        for (const { call, method } of parseCalls) {
          context.report({
            node: call,
            messageId: 'noResOkCheckVar',
            data: { name: node.id.name, method },
          })
        }
      },

      // Form 2: (await fetch(...)).json() / .text() / etc.
      // The MemberExpression's object is an AwaitExpression of a fetch call.
      MemberExpression(node) {
        if (node.computed) return
        if (node.property.type !== 'Identifier') return
        const method = node.property.name
        if (!PARSE_METHODS.has(method)) return
        if (!isAwaitFetch(node.object)) return
        const parent = node.parent
        if (!parent || parent.type !== 'CallExpression' || parent.callee !== node) return

        context.report({
          node: parent,
          messageId: 'noResOkCheckAwaitChain',
          data: { method },
        })
      },

      // Form 3: fetch(url).then((r) => r.json()) — scan the arrow body.
      // Also detect .then((r) => { return r.json() }) block form.
      CallExpression(node) {
        const callee = node.callee
        if (!callee || callee.type !== 'MemberExpression' || callee.computed) return
        if (callee.property.type !== 'Identifier' || callee.property.name !== 'then') return
        if (!isFetchCall(callee.object)) return

        const handler = node.arguments[0]
        if (!handler) return
        if (handler.type !== 'ArrowFunctionExpression' && handler.type !== 'FunctionExpression') return

        const param = handler.params[0]
        if (!param || param.type !== 'Identifier') return
        if (param.name.startsWith('_')) return

        const body = handler.body.type === 'BlockStatement' ? handler.body : handler.body
        const { hasCheck, parseCalls } = scanForParamUsage(body, param.name)
        if (hasCheck) return

        for (const { call, method } of parseCalls) {
          context.report({
            node: call,
            messageId: 'noResOkCheckThen',
            data: { method },
          })
        }
      },
    }
  },
}
