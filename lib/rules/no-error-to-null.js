/**
 * no-error-to-null
 *
 * Flags the "error-to-default" anti-pattern: a catch block (or Promise
 * `.catch()` handler) whose effect is to silently convert every failure into
 * a bare default value (null, undefined, [], {}, false, 0, ''). The caller
 * cannot distinguish an expected absence (file-not-found, no-rows) from an
 * unexpected failure (network down, bug) and silently degrades.
 *
 *   // ❌ flagged
 *   try { return await readRole(name) } catch { return null }
 *   fetch('/api/x').then(r => r.json()).catch(() => [])
 *
 *   // ✅ allowed — expected case is discriminated, unknowns re-throw
 *   try { return await readRole(name) } catch (err) {
 *     if (err.code === 'ENOENT') return null
 *     throw err
 *   }
 *
 *   // ✅ allowed — err is surfaced before returning null for the data state
 *   try { await loadItems() } catch (err) {
 *     setError(err.message)
 *     return null
 *   }
 *
 * Firing logic (catch clause):
 *   - Top-level statement is `return <bare literal>` (or `return;`)
 *   - No preceding top-level statement contains a `throw` anywhere in its
 *     subtree (that would be a discriminator)
 *   - No preceding top-level statement surfaces the caught error by a
 *     non-console reference
 *   - Param is not underscore-prefixed (matches caughtErrorsIgnorePattern)
 *
 * Firing logic (`.catch(fn)` handler):
 *   - fn is an arrow or function expression
 *   - Arrow expression body is a bare literal, OR block body has a top-level
 *     bare-literal return meeting the same discriminator/surfacing checks
 *   - First param (if any) is not underscore-prefixed
 */

const {
  containsThrow,
  describeBareLiteral,
  isBareLiteral,
  statementSurfacesErr,
} = require('../utils')

function isIgnoredParam(param) {
  return param && param.type === 'Identifier' && param.name.startsWith('_')
}

/**
 * Walk top-level body. Return the first `return <bare>` statement that is
 * not guarded by a preceding throw OR a preceding err-surfacing statement.
 * Returns null if no unguarded bare return is present.
 */
function findUnguardedBareReturn(bodyStatements, errName) {
  for (let i = 0; i < bodyStatements.length; i++) {
    const stmt = bodyStatements[i]
    if (stmt.type !== 'ReturnStatement') continue
    if (!isBareLiteral(stmt.argument)) continue

    const earlier = bodyStatements.slice(0, i)
    const hasPrecedingThrow = earlier.some(containsThrow)
    if (hasPrecedingThrow) continue

    const hasPrecedingSurface = errName
      ? earlier.some(s => statementSurfacesErr(s, errName))
      : false
    if (hasPrecedingSurface) continue

    return stmt
  }
  return null
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow catch/.catch handlers that convert every error into a bare default (null, [], {}, false, 0, undefined) without discrimination or surfacing.',
      category: 'Possible Errors',
    },
    schema: [],
    messages: {
      catchToBare:
        'catch block returns {{value}} for every error — caller cannot tell a real failure from an expected absence. Discriminate the expected case (e.g. err.code === \'ENOENT\') and re-throw unknowns, or surface the error first. See fail-fast-coding skill.',
      promiseCatchToBare:
        '.catch(() => {{value}}) converts every promise rejection to {{value}} — the original error is lost. Check for the specific error you expect, or remove the .catch and let it propagate.',
    },
  },

  create(context) {
    return {
      CatchClause(node) {
        const param = node.param
        if (isIgnoredParam(param)) return

        const errName = param && param.type === 'Identifier' ? param.name : null
        const body = node.body.body
        const badReturn = findUnguardedBareReturn(body, errName)
        if (!badReturn) return

        context.report({
          node: badReturn,
          messageId: 'catchToBare',
          data: { value: describeBareLiteral(badReturn.argument) },
        })
      },

      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') return
        if (node.callee.computed) return
        if (node.callee.property.type !== 'Identifier') return
        if (node.callee.property.name !== 'catch') return
        if (node.arguments.length === 0) return

        const handler = node.arguments[0]
        if (handler.type !== 'ArrowFunctionExpression' && handler.type !== 'FunctionExpression') return

        const param = handler.params[0]
        if (isIgnoredParam(param)) return

        const errName = param && param.type === 'Identifier' ? param.name : null

        if (handler.body.type !== 'BlockStatement') {
          if (isBareLiteral(handler.body)) {
            context.report({
              node: handler.body,
              messageId: 'promiseCatchToBare',
              data: { value: describeBareLiteral(handler.body) },
            })
          }
          return
        }

        const body = handler.body.body
        const badReturn = findUnguardedBareReturn(body, errName)
        if (!badReturn) return

        context.report({
          node: badReturn,
          messageId: 'promiseCatchToBare',
          data: { value: describeBareLiteral(badReturn.argument) },
        })
      },
    }
  },
}
