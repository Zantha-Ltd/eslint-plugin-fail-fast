/**
 * require-envelope-check
 *
 * Some APIs signal operation failure in the response BODY of an HTTP 200 —
 * an "envelope" contract (e.g. Mintsoft's `Success: false` + `Message`,
 * Shopify GraphQL's `userErrors[]`). Transport-level error handling
 * (`res.ok`, try/catch) cannot see these: the refusal arrives as ordinary
 * data, the type system blesses it as the success shape, and downstream
 * code persists a rejection as if the operation succeeded. This is the
 * exact class behind the zantha-products PO-26-07-13-Q4 incident, where a
 * refused book-in closed a purchase order with nothing received — and it
 * is invisible to every syntactic error-disposal rule in this plugin,
 * because there is no catch block or fallback to flag.
 *
 * ESLint cannot know arbitrary envelope contracts, so this rule is
 * config-driven: the consuming repo registers its envelope-bearing client
 * functions and their discriminator property. Every registered call must
 * then have its result interrogated in the calling function:
 *
 *   // .eslintrc:
 *   // "@zantha-ltd/fail-fast/require-envelope-check": ["error", {
 *   //   "envelopes": [
 *   //     { "callee": "mintsoftRequest", "property": "Success",
 *   //       "guards": ["assertBodySuccess"] }
 *   //   ]
 *   // }]
 *
 *   const r = await mintsoftRequest('/ASN/1/BookIn')   // ❌ r.Success never read
 *   return await mintsoftRequest('/ASN/1/BookIn')      // ❌ raw return pushes the
 *                                                      //    obligation to untyped callers
 *   await mintsoftRequest('/ASN/1/BookIn')             // ❌ result discarded entirely
 *
 *   const r = await mintsoftRequest('/ASN/1/BookIn')
 *   if (r.Success === false) throw new Error(r.Message) // ✅ discriminator read
 *   return assertBodySuccess(await mintsoftRequest(url)) // ✅ routed through a guard
 *   const { Success, ID } = await mintsoftRequest(url)   // ✅ destructures discriminator
 *
 * Deliberately flagged: `return await callee(...)` from a thin wrapper.
 * Raw-returning wrappers are how the obligation evaporates — every caller
 * assumes someone else checked. Either check in the wrapper, route through
 * a guard, or (best) enforce the envelope centrally inside the client
 * function itself and DON'T register it here — a runtime guard that cannot
 * be forgotten beats a lint rule that must be configured.
 *
 * Scope (v1): direct-identifier callees only (`mintsoftRequest(...)`, not
 * `client.request(...)`); assigned-variable, direct-return, and discarded
 * forms. Promise-chain (`callee().then(...)`) is not covered.
 */

/** Build `envelopesByCallee` from rule options. */
function readOptions(context) {
  const options = context.options && context.options[0]
  const envelopes = (options && options.envelopes) || []
  const byCallee = new Map()
  for (const e of envelopes) {
    if (e && typeof e.callee === 'string' && typeof e.property === 'string') {
      byCallee.set(e.callee, {
        callee: e.callee,
        property: e.property,
        guards: new Set(Array.isArray(e.guards) ? e.guards : []),
      })
    }
  }
  return byCallee
}

/** `callee(...)` or `callee<T>(...)` with a bare Identifier callee. */
function getEnvelopeCall(node, byCallee) {
  if (!node || node.type !== 'CallExpression') return null
  if (node.callee.type !== 'Identifier') return null
  return byCallee.get(node.callee.name) || null
}

/** Unwrap `await <call>` → the call node (or the call itself, unawaited). */
function unwrapAwait(node) {
  if (!node) return null
  if (node.type === 'AwaitExpression') return node.argument
  return node
}

/** Is this identifier reference passed directly to a registered guard fn? */
function isGuardArgument(ident, envelope) {
  const parent = ident.parent
  if (!parent || parent.type !== 'CallExpression') return false
  if (!parent.arguments.includes(ident)) return false
  const callee = parent.callee
  if (callee.type === 'Identifier') return envelope.guards.has(callee.name)
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier'
  ) {
    return envelope.guards.has(callee.property.name)
  }
  return false
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require the result of a registered envelope-bearing API call (HTTP 200 + body-level failure flag, e.g. Success:false or userErrors[]) to have its discriminator property checked, destructured, or routed through a named guard in the calling function.',
      category: 'Possible Errors',
    },
    schema: [
      {
        type: 'object',
        properties: {
          envelopes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                callee: { type: 'string' },
                property: { type: 'string' },
                guards: { type: 'array', items: { type: 'string' } },
              },
              required: ['callee', 'property'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      envelopeUncheckedVar:
        'Result "{{name}}" of {{callee}}() is used without checking {{name}}.{{property}} — this API signals failure in a 200 body, so an unchecked result treats a refusal as success. Read .{{property}} (or pass it through a guard{{guardHint}}). See fail-fast-coding skill.',
      envelopeReturnedRaw:
        'Raw return of {{callee}}() pushes the .{{property}} envelope check onto every caller — that is how the obligation evaporates. Check .{{property}} here, route through a guard{{guardHint}}, or enforce the envelope centrally inside {{callee}} and unregister it from this rule.',
      envelopeDiscarded:
        'Result of {{callee}}() is discarded — a body-level refusal ({{property}}) would vanish without a trace. Bind the result and check .{{property}}{{guardHint}}.',
    },
  },

  create(context) {
    const byCallee = readOptions(context)
    if (byCallee.size === 0) return {}
    const sourceCode = context.sourceCode || context.getSourceCode()

    function guardHint(envelope) {
      return envelope.guards.size > 0 ? `, e.g. ${[...envelope.guards].join('/')}` : ''
    }

    return {
      // Form 1 + 2: const X = await callee(...) / return await callee(...)
      VariableDeclarator(node) {
        const call = unwrapAwait(node.init)
        const envelope = getEnvelopeCall(call, byCallee)
        if (!envelope) return

        // Destructuring: pass when the discriminator (or a rest element)
        // is among the extracted properties, flag otherwise.
        if (node.id.type === 'ObjectPattern') {
          const covered = node.id.properties.some(p => {
            if (p.type === 'RestElement') return true
            return (
              p.type === 'Property' &&
              !p.computed &&
              p.key.type === 'Identifier' &&
              p.key.name === envelope.property
            )
          })
          if (!covered) {
            context.report({
              node,
              messageId: 'envelopeUncheckedVar',
              data: {
                name: '(destructured)',
                callee: envelope.callee,
                property: envelope.property,
                guardHint: guardHint(envelope),
              },
            })
          }
          return
        }

        if (node.id.type !== 'Identifier') return

        const scope = typeof sourceCode.getScope === 'function'
          ? sourceCode.getScope(node)
          : context.getScope()
        const variable = scope.variables.find(v => v.name === node.id.name)
          || scope.references.find(r => r.identifier === node.id)?.resolved
        if (!variable) return

        let hasCheck = false
        for (const ref of variable.references) {
          const ident = ref.identifier
          if (ref.init) continue
          const parent = ident.parent
          if (
            parent &&
            parent.type === 'MemberExpression' &&
            parent.object === ident &&
            !parent.computed &&
            parent.property.type === 'Identifier' &&
            parent.property.name === envelope.property
          ) {
            hasCheck = true
            break
          }
          if (isGuardArgument(ident, envelope)) {
            hasCheck = true
            break
          }
        }

        if (!hasCheck) {
          context.report({
            node,
            messageId: 'envelopeUncheckedVar',
            data: {
              name: node.id.name,
              callee: envelope.callee,
              property: envelope.property,
              guardHint: guardHint(envelope),
            },
          })
        }
      },

      // Form 3: return await callee(...) — raw-return leak.
      ReturnStatement(node) {
        const call = unwrapAwait(node.argument)
        const envelope = getEnvelopeCall(call, byCallee)
        if (!envelope) return
        context.report({
          node,
          messageId: 'envelopeReturnedRaw',
          data: {
            callee: envelope.callee,
            property: envelope.property,
            guardHint: guardHint(envelope),
          },
        })
      },

      // Arrow shorthand: const f = () => callee(...) — same raw-return leak.
      ArrowFunctionExpression(node) {
        if (node.body.type === 'BlockStatement') return
        const call = unwrapAwait(node.body)
        const envelope = getEnvelopeCall(call, byCallee)
        if (!envelope) return
        context.report({
          node: node.body,
          messageId: 'envelopeReturnedRaw',
          data: {
            callee: envelope.callee,
            property: envelope.property,
            guardHint: guardHint(envelope),
          },
        })
      },

      // Form 4: bare `await callee(...)` statement — result discarded.
      ExpressionStatement(node) {
        const call = unwrapAwait(node.expression)
        const envelope = getEnvelopeCall(call, byCallee)
        if (!envelope) return
        context.report({
          node,
          messageId: 'envelopeDiscarded',
          data: {
            callee: envelope.callee,
            property: envelope.property,
            guardHint: guardHint(envelope),
          },
        })
      },
    }
  },
}
