/**
 * require-res-ok-check
 *
 * After `const res = await fetch(...)`, flags `res.json()` / `res.text()` /
 * `res.blob()` / `res.arrayBuffer()` / `res.formData()` calls when neither
 * `res.ok` nor `res.status` is referenced anywhere in the enclosing scope.
 * A non-2xx response gets its error body parsed as if it were success, or
 * throws a cryptic JSON SyntaxError on HTML error pages — both drop the
 * real status on the floor.
 *
 *   // ❌ flagged
 *   const res = await fetch('/api/items')
 *   const data = await res.json()
 *
 *   // ✅ allowed — explicit ok guard
 *   const res = await fetch('/api/items')
 *   if (!res.ok) throw new Error(`Failed: ${res.status}`)
 *   const data = await res.json()
 *
 *   // ✅ allowed — manual status check
 *   const res = await fetch('/api/items')
 *   if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
 *   const data = await res.json()
 *
 * Scope (v1):
 *   - Only `const/let/var X = await fetch(...)` form. Chained
 *     `fetch(url).then(r => r.json())` and parenthesised
 *     `(await fetch(url)).json()` are out of scope for now.
 *   - "Check" = any reference to `.ok`, `.status`, `.statusText`, or
 *     `.headers` on the bound variable. If the developer accesses any of
 *     those, we trust they've handled the error path.
 *   - Parse methods scoped to the standard Response body-reading set;
 *     `.clone()` and `.body` aren't flagged.
 */

const PARSE_METHODS = new Set(['json', 'text', 'blob', 'arrayBuffer', 'formData'])
const CHECK_PROPS = new Set(['ok', 'status', 'statusText', 'headers'])

function isAwaitFetch(node) {
  if (!node || node.type !== 'AwaitExpression') return false
  const call = node.argument
  if (!call || call.type !== 'CallExpression') return false
  return call.callee.type === 'Identifier' && call.callee.name === 'fetch'
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require res.ok (or res.status) to be checked before parsing the body of a fetch() response.',
      category: 'Possible Errors',
    },
    schema: [],
    messages: {
      noResOkCheck:
        'Response "{{name}}" is parsed with .{{method}}() without checking {{name}}.ok or {{name}}.status first — non-2xx responses silently get treated as success. Add an ok guard before the parse (e.g. `if (!{{name}}.ok) throw new Error(...)`). See fail-fast-coding skill.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode()

    return {
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
          if (ref.init) continue  // the `const X = ...` binding itself
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
            messageId: 'noResOkCheck',
            data: { name: node.id.name, method },
          })
        }
      },
    }
  },
}
