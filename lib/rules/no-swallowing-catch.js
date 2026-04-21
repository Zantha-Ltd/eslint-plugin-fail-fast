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
 *   // eslint-disable-next-line local-rules/no-swallowing-catch -- ENOENT means file absent, expected
 *   catch { return null }
 *
 * If the justification reads like an explanation of what went wrong rather
 * than why swallowing is correct, that is a code smell — see the skill's
 * "explanatory-comment-is-a-tell" anti-pattern row.
 */

const CONSOLE_METHODS = new Set(['log', 'warn', 'error', 'info', 'debug', 'trace'])

/** Does this statement re-throw, return, or otherwise propagate the error? */
function propagates(body, errName) {
  for (const stmt of body) {
    if (stmt.type === 'ThrowStatement') return true
    if (stmt.type === 'ReturnStatement') {
      // return without a value is still a swallow; return with a value that
      // references err is propagation (e.g. `return { error: err.message }`)
      if (stmt.argument && referencesName(stmt.argument, errName)) return true
    }
    // Expression statements calling setError/setState/etc. with err count
    if (stmt.type === 'ExpressionStatement' && referencesName(stmt.expression, errName)) {
      // Exclude pure console logging — flagged separately
      if (!isConsoleCall(stmt.expression)) return true
    }
    // If the body contains any reference to err (assignment, etc.), call it
    // propagation — the surface check relies on var-usage analysis.
  }
  return false
}

function referencesName(node, name) {
  if (!node || !name) return false
  if (node.type === 'Identifier') return node.name === name
  if (node.type === 'MemberExpression') {
    return referencesName(node.object, name) || (!node.computed && false) || (node.computed && referencesName(node.property, name))
  }
  if (node.type === 'CallExpression') {
    return referencesName(node.callee, name) || node.arguments.some(a => referencesName(a, name))
  }
  if (node.type === 'NewExpression') {
    return referencesName(node.callee, name) || node.arguments.some(a => referencesName(a, name))
  }
  if (node.type === 'TemplateLiteral') {
    return node.expressions.some(e => referencesName(e, name))
  }
  if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
    return referencesName(node.left, name) || referencesName(node.right, name)
  }
  if (node.type === 'ConditionalExpression') {
    return referencesName(node.test, name) || referencesName(node.consequent, name) || referencesName(node.alternate, name)
  }
  if (node.type === 'ObjectExpression') {
    return node.properties.some(p => p.type === 'Property' && referencesName(p.value, name))
  }
  if (node.type === 'ArrayExpression') {
    return node.elements.some(e => e && referencesName(e, name))
  }
  if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion' || node.type === 'TSNonNullExpression') {
    return referencesName(node.expression, name)
  }
  if (node.type === 'AwaitExpression' || node.type === 'UnaryExpression' || node.type === 'SpreadElement') {
    return referencesName(node.argument, name)
  }
  if (node.type === 'AssignmentExpression') {
    return referencesName(node.left, name) || referencesName(node.right, name)
  }
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    // Conservative: treat a function body referencing err as propagation
    if (node.body.type === 'BlockStatement') {
      return node.body.body.some(s => statementReferencesName(s, name))
    }
    return referencesName(node.body, name)
  }
  return false
}

function statementReferencesName(stmt, name) {
  if (!stmt) return false
  if (stmt.type === 'ExpressionStatement') return referencesName(stmt.expression, name)
  if (stmt.type === 'ReturnStatement') return stmt.argument ? referencesName(stmt.argument, name) : false
  if (stmt.type === 'ThrowStatement') return referencesName(stmt.argument, name)
  if (stmt.type === 'VariableDeclaration') return stmt.declarations.some(d => d.init && referencesName(d.init, name))
  if (stmt.type === 'IfStatement') {
    return referencesName(stmt.test, name) ||
      statementReferencesName(stmt.consequent, name) ||
      (stmt.alternate && statementReferencesName(stmt.alternate, name))
  }
  if (stmt.type === 'BlockStatement') return stmt.body.some(s => statementReferencesName(s, name))
  return false
}

function isConsoleCall(expr) {
  if (!expr || expr.type !== 'CallExpression') return false
  const callee = expr.callee
  return callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'console' &&
    callee.property.type === 'Identifier' &&
    CONSOLE_METHODS.has(callee.property.name)
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
    },
  },

  create(context) {
    return {
      CatchClause(node) {
        const body = node.body.body
        const param = node.param

        // Case 1: no err binding at all (catch { ... })
        if (!param) {
          context.report({ node, messageId: 'noErrBinding' })
          return
        }

        // Only handle identifier params for now; destructured catch is rare
        // and the unused-var rule already covers basic cases.
        if (param.type !== 'Identifier') return

        // Ignore intentional `_` / `_err` names — matches
        // caughtErrorsIgnorePattern: '^_' in the repo's eslint config.
        if (param.name.startsWith('_')) return

        // Case 2: empty body
        if (body.length === 0) {
          context.report({ node, messageId: 'emptyBody' })
          return
        }

        // Case 3: err unused in body
        const anyRef = body.some(stmt => statementReferencesName(stmt, param.name))
        if (!anyRef) {
          context.report({ node: param, messageId: 'errUnused', data: { name: param.name } })
          return
        }

        // Case 4: only a single statement that is `console.x(err)` or similar
        if (body.length === 1 && body[0].type === 'ExpressionStatement' && isConsoleCall(body[0].expression)) {
          const method = body[0].expression.callee.property.name
          context.report({ node, messageId: 'onlyLogged', data: { method } })
          return
        }

        // If we got here, err is referenced. Propagation (throw/return/setError
        // etc.) is considered adequate surfacing for this rule's scope. The
        // anti-pattern entries around error-masking / context-stripping are
        // candidates for separate rules.
        void propagates // reserved for future sub-checks
      },
    }
  },
}
