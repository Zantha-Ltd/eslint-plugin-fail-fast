/**
 * no-context-stripping
 *
 * Inside `catch (err) { ... }`, flags any `throw new Error(...)` (or any
 * identifier ending in `Error`) that does not chain the caught `err` via
 * the message argument or the options.cause property. These throws lose the
 * original stack trace and message, leaving callers with a useless wrapper
 * error and the real failure only in the hot path's memory.
 *
 *   // ❌ flagged — stack trace and original message lost
 *   catch (err) { throw new Error('Failed to deploy') }
 *
 *   // ✅ allowed — err interpolated into message
 *   catch (err) {
 *     throw new Error(`Failed to deploy: ${err instanceof Error ? err.message : err}`)
 *   }
 *
 *   // ✅ allowed — ES2022 cause option
 *   catch (err) {
 *     throw new Error('Failed to deploy', { cause: err })
 *   }
 *
 *   // ✅ allowed — bare rethrow preserves context natively
 *   catch (err) { throw err }
 *
 * Detection: collect every `ThrowStatement` inside the catch body (descending
 * through if/try/block but NOT nested function bodies). For each, if the
 * thrown expression is `new X(...)` with X = `Error` or `*Error`, require
 * that some argument tree contains a reference to `err` — either inside the
 * message string (template / concat) or inside `options.cause` (or any other
 * key of the options object, conservatively).
 */

const {
  collectThrows,
  isErrorConstructor,
  referencesName,
} = require('../utils')

function newExpressionReferencesErr(node, errName) {
  if (!node || node.type !== 'NewExpression') return false
  if (!errName) return false
  for (const arg of node.arguments) {
    if (referencesName(arg, errName)) return true
  }
  return false
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow catch blocks that throw a new Error without chaining the original err via message or { cause }.',
      category: 'Possible Errors',
    },
    schema: [],
    messages: {
      stripped:
        'throw new {{name}}(...) in a catch block discards the caught error ({{errName}}) — stack trace and original message are lost. Interpolate {{errName}}.message into the message string, or pass { cause: {{errName}} } as the second argument. See fail-fast-coding skill.',
    },
  },

  create(context) {
    return {
      CatchClause(node) {
        const param = node.param
        if (!param || param.type !== 'Identifier') return
        if (param.name.startsWith('_')) return
        const errName = param.name

        const throws = []
        collectThrows(node.body, throws)

        for (const t of throws) {
          const arg = t.argument
          if (!arg || arg.type !== 'NewExpression') continue
          if (!isErrorConstructor(arg.callee)) continue
          if (newExpressionReferencesErr(arg, errName)) continue

          context.report({
            node: t,
            messageId: 'stripped',
            data: {
              name: arg.callee.type === 'Identifier' ? arg.callee.name : 'Error',
              errName,
            },
          })
        }
      },
    }
  },
}
