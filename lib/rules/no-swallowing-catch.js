/**
 * no-swallowing-catch
 *
 * Flags catch blocks that silently swallow errors — the most common fail-fast
 * violation. Four sub-cases:
 *
 *   1. `catch { ... }`                    — no err binding at all
 *   2. `catch (err) { }`                  — empty body
 *   3. `catch (err) { ... }`              — err never referenced inside body
 *   4. `catch (err) { console.x(err) }`   — err only logged, never surfaced
 *   5. `catch (err) { console.x(err); n++ }` — logged, then only a counter or flag,
 *      `continue`, `break`, or a bare `return` / `return null|undefined` (2.0.0)
 *
 * An intentional swallow must be annotated with an inline disable comment
 * that includes a justification (enforced separately by eslint-comments).
 *
 *   // eslint-disable-next-line @zantha-ltd/fail-fast/no-swallowing-catch -- ENOENT means file absent, expected
 *   catch { return null }
 *
 * If the justification reads like an explanation of what went wrong rather
 * than why swallowing is correct, that is a code smell — see the skill's
 * "explanatory-comment-is-a-tell" anti-pattern row.
 */

const { isConsoleCall, statementReferencesName } = require('../utils')

function isNothingValue(arg) {
  if (!arg) return true
  if (arg.type === 'Literal' && arg.value === null) return true
  if (arg.type === 'Identifier' && arg.name === 'undefined') return true
  if (arg.type === 'UnaryExpression' && arg.operator === 'void') return true
  return false
}

function isFlagValue(node) {
  if (!node) return false
  if (node.type === 'Literal') return true
  if (node.type === 'Identifier' && node.name === 'undefined') return true
  if (node.type === 'UnaryExpression' && node.argument && node.argument.type === 'Literal') return true
  return false
}

/** A counter or flag lives in a variable or on `this`; a write to anything else (location.href, a store) is a real act. */
function isLocalTarget(node) {
  if (!node) return false
  if (node.type === 'Identifier') return true
  return node.type === 'MemberExpression' && node.object.type === 'ThisExpression'
}

/** A statement after the log that does nothing with the failure: a counter, a flag, continue, break, or a bare return. */
function dropsTheError(stmt, errName) {
  if (statementReferencesName(stmt, errName)) return false
  if (stmt.type === 'ContinueStatement' || stmt.type === 'BreakStatement') return true
  if (stmt.type === 'ReturnStatement') return isNothingValue(stmt.argument)
  if (stmt.type !== 'ExpressionStatement') return false
  const e = stmt.expression
  if (e.type === 'UpdateExpression') return isLocalTarget(e.argument)
  if (e.type === 'AssignmentExpression') return isLocalTarget(e.left) && isFlagValue(e.right)
  return false
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow catch blocks that silently swallow errors (fail-fast principle).',
      category: 'Possible Errors',
    },
    schema: [],
    messages: {
      noErrBinding:
        'catch clause has no err binding. If a comment explains why, that is a "tell" — restructure or bind err and surface it. See fail-fast-coding skill.',
      emptyBody:
        'Empty catch body silently swallows the error. Rethrow with context, or remove the try/catch.',
      errUnused:
        'Caught error "{{name}}" is never referenced — equivalent to an empty catch. Surface or rethrow it.',
      onlyLogged:
        'Caught error is only logged to console, never surfaced. console.{{method}}(err) is invisible to the user.',
      loggedThenDropped:
        'Caught error is logged with console.{{method}} and then dropped: a counter, a flag, continue, break or a bare return after a log still swallows it. Rethrow, return something the caller must handle, or call a real recovery path.',
    },
  },

  create(context) {
    return {
      CatchClause(node) {
        const body = node.body.body
        const param = node.param

        if (!param) {
          context.report({ node, messageId: 'noErrBinding' })
          return
        }

        if (param.type !== 'Identifier') return

        if (param.name.startsWith('_')) return

        if (body.length === 0) {
          context.report({ node, messageId: 'emptyBody' })
          return
        }

        const anyRef = body.some(stmt => statementReferencesName(stmt, param.name))
        if (!anyRef) {
          context.report({ node: param, messageId: 'errUnused', data: { name: param.name } })
          return
        }

        let logs = 0
        while (logs < body.length && body[logs].type === 'ExpressionStatement' && isConsoleCall(body[logs].expression)) logs++
        if (logs === 0) return
        const method = body[0].expression.callee.property.name
        const tail = body.slice(logs)
        if (tail.length === 0) {
          context.report({ node, messageId: 'onlyLogged', data: { method } })
          return
        }
        if (tail.every(stmt => dropsTheError(stmt, param.name))) {
          context.report({ node, messageId: 'loggedThenDropped', data: { method } })
        }
      },
    }
  },
}
