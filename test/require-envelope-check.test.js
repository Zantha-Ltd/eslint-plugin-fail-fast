/**
 * RuleTester suite for require-envelope-check. Run with: npm test
 */

const { RuleTester } = require('eslint')
const { test } = require('node:test')

const rule = require('../lib/rules/require-envelope-check')

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

const OPTIONS = [
  {
    envelopes: [
      { callee: 'mintsoftRequest', property: 'Success', guards: ['assertBodySuccess'] },
      { callee: 'shopifyMutation', property: 'userErrors' },
    ],
  },
]

test('require-envelope-check', () => {
  ruleTester.run('require-envelope-check', rule, {
    valid: [
      {
        name: 'no options — rule is inert without registered envelopes',
        code: `
          async function f() {
            return await mintsoftRequest('/ASN/1/BookIn')
          }
        `,
      },
      {
        name: 'discriminator checked on assigned result',
        options: OPTIONS,
        code: `
          async function f() {
            const result = await mintsoftRequest('/ASN/1/BookIn')
            if (result.Success === false) throw new Error(result.Message)
            return result
          }
        `,
      },
      {
        name: 'discriminator checked via negation',
        options: OPTIONS,
        code: `
          async function f() {
            const r = await mintsoftRequest('/Warehouse/StockMovement')
            if (!r.Success) throw new Error(r.Message || 'refused')
          }
        `,
      },
      {
        name: 'result routed through a registered guard',
        options: OPTIONS,
        code: `
          async function f() {
            const r = await mintsoftRequest('/ASN/1/Confirm')
            return assertBodySuccess(r, 'confirm')
          }
        `,
      },
      {
        name: 'guard wrapping the call inline',
        options: OPTIONS,
        code: `
          async function f() {
            return assertBodySuccess(await mintsoftRequest('/ASN/1/Confirm'), 'confirm')
          }
        `,
      },
      {
        name: 'guard called as a method',
        options: OPTIONS,
        code: `
          async function f() {
            const r = await mintsoftRequest('/ASN/1')
            return mintsoft.assertBodySuccess(r)
          }
        `,
      },
      {
        name: 'destructuring that extracts the discriminator',
        options: OPTIONS,
        code: `
          async function f() {
            const { Success, Message, ID } = await mintsoftRequest('/Product', { method: 'PUT' })
            if (!Success) throw new Error(Message)
            return ID
          }
        `,
      },
      {
        name: 'destructuring with rest element (conservative pass)',
        options: OPTIONS,
        code: `
          async function f() {
            const { ID, ...rest } = await mintsoftRequest('/Product')
            return { ID, rest }
          }
        `,
      },
      {
        name: 'unregistered callee is ignored',
        options: OPTIONS,
        code: `
          async function f() {
            return await otherClient('/whatever')
          }
        `,
      },
      {
        name: 'second registered envelope: userErrors checked',
        options: OPTIONS,
        code: `
          async function f() {
            const data = await shopifyMutation(PRICE_MUTATION)
            const errs = data.userErrors
            if (errs.length > 0) throw new Error(errs[0].message)
          }
        `,
      },
    ],

    invalid: [
      {
        name: 'the incident shape: raw return from a thin wrapper',
        options: OPTIONS,
        code: `
          async function bookInASN(asnId) {
            return await mintsoftRequest('/ASN/' + asnId + '/BookIn', { method: 'GET' })
          }
        `,
        errors: [{ messageId: 'envelopeReturnedRaw' }],
      },
      {
        name: 'raw return without await',
        options: OPTIONS,
        code: `
          function f(id) {
            return mintsoftRequest('/ASN/' + id)
          }
        `,
        errors: [{ messageId: 'envelopeReturnedRaw' }],
      },
      {
        name: 'arrow shorthand raw return',
        options: OPTIONS,
        code: `
          const bookIn = (id) => mintsoftRequest('/ASN/' + id + '/BookIn')
        `,
        errors: [{ messageId: 'envelopeReturnedRaw' }],
      },
      {
        name: 'assigned result used but discriminator never read',
        options: OPTIONS,
        code: `
          async function f() {
            const asn = await mintsoftRequest('/ASN/1/BookIn')
            await db.query('UPDATE pos SET response = $1', [JSON.stringify(asn)])
            return { booked: true, asn }
          }
        `,
        errors: [{ messageId: 'envelopeUncheckedVar' }],
      },
      {
        name: 'result discarded entirely',
        options: OPTIONS,
        code: `
          async function f() {
            await mintsoftRequest('/ASN/1/Items/Receive', { method: 'POST', body: [] })
          }
        `,
        errors: [{ messageId: 'envelopeDiscarded' }],
      },
      {
        name: 'destructuring that skips the discriminator',
        options: OPTIONS,
        code: `
          async function f() {
            const { ProductId } = await mintsoftRequest('/Product', { method: 'PUT' })
            return ProductId
          }
        `,
        errors: [{ messageId: 'envelopeUncheckedVar' }],
      },
      {
        name: 'passed to a non-guard function does not discharge the check',
        options: OPTIONS,
        code: `
          async function f() {
            const r = await mintsoftRequest('/ASN/1')
            log.debug(r)
            return { done: true }
          }
        `,
        errors: [{ messageId: 'envelopeUncheckedVar' }],
      },
      {
        name: 'second envelope: userErrors never read',
        options: OPTIONS,
        code: `
          async function f() {
            const data = await shopifyMutation(PRICE_MUTATION)
            return data.priceList.id
          }
        `,
        errors: [{ messageId: 'envelopeUncheckedVar' }],
      },
    ],
  })
})
