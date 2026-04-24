/**
 * no-if-res-ok-no-else
 *
 * Flags `if (<var>.ok) { … }` statements that have no `else` branch. The
 * consequent handles the success path; without an else, non-OK responses
 * are silently ignored — caller falls through past the `if` as though
 * nothing happened.
 *
 *   // ❌ flagged
 *   if (res.ok) {
 *     const data = await res.json()
 *     setItems(data)
 *   }
 *   // !ok case: user sees an empty list with no error indication.
 *
 *   // ✅ allowed — else handles the error
 *   if (res.ok) {
 *     const data = await res.json()
 *     setItems(data)
 *   } else {
 *     throw new Error(`Failed: ${res.status}`)
 *   }
 *
 *   // ✅ idiomatic — guard the failure case first, then fall through
 *   if (!res.ok) throw new Error(`Failed: ${res.status}`)
 *   const data = await res.json()
 *
 * Scope (v1):
 *   - Only positive tests on a MemberExpression `.ok` property. The
 *     negated form `if (!res.ok) { ... }` is not flagged — it guards the
 *     error case and normally terminates with throw/return; assessing
 *     whether it does requires more analysis than this rule takes on.
 *   - Only simple tests — `if (res.ok)` alone. Compound tests like
 *     `if (res.ok && hasPayload)` or `if (res.ok === true)` are out of
 *     scope to avoid false positives.
 *   - Any absent `alternate` fires — the consequent could itself `throw`
 *     or `return`, but the developer's failure to write the else branch
 *     is the tell that the non-ok case wasn't considered.
 */

function isSimpleOkTest(testNode) {
  if (!testNode) return false
  if (testNode.type !== 'MemberExpression') return false
  if (testNode.computed) return false
  if (testNode.property.type !== 'Identifier') return false
  if (testNode.property.name !== 'ok') return false
  if (testNode.object.type !== 'Identifier') return false
  return true
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `if (<var>.ok) { ... }` without an `else` branch — the non-OK response path is silently ignored.',
      category: 'Possible Errors',
    },
    schema: [],
    messages: {
      noElse:
        '`if ({{name}}.ok)` has no else branch — if the response is not OK, control falls through with no error handling. Either add an else that throws, or restructure as `if (!{{name}}.ok) throw new Error(...)` followed by the success path. See fail-fast-coding skill.',
    },
  },

  create(context) {
    return {
      IfStatement(node) {
        if (!isSimpleOkTest(node.test)) return
        if (node.alternate) return
        context.report({
          node,
          messageId: 'noElse',
          data: { name: node.test.object.name },
        })
      },
    }
  },
}
