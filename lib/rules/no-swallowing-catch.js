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

        if (body.length === 1 && body[0].type === 'ExpressionStatement' && isConsoleCall(body[0].expression)) {
          const method = body[0].expression.callee.property.name
          context.report({ node, messageId: 'onlyLogged', data: { method } })
        }
      },
    }
  },
}
