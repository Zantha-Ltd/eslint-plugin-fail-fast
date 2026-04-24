/**
 * RuleTester suite for no-if-res-ok-no-else. Run with: npm test
 */

const { RuleTester } = require('eslint')
const { test } = require('node:test')

const rule = require('../lib/rules/no-if-res-ok-no-else')

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

test('no-if-res-ok-no-else', () => {
  ruleTester.run('no-if-res-ok-no-else', rule, {
    valid: [
      {
        name: 'if (res.ok) { … } else { … } — both paths handled',
        code: `
          async function f() {
            const res = await fetch('/x')
            if (res.ok) {
              const data = await res.json()
              setItems(data)
            } else {
              throw new Error('Failed: ' + res.status)
            }
          }
        `,
      },
      {
        name: 'if (!res.ok) — negated form is out of scope (requires terminator analysis)',
        code: `
          async function f() {
            const res = await fetch('/x')
            if (!res.ok) throw new Error('Failed')
            const data = await res.json()
          }
        `,
      },
      {
        name: 'if (res.ok && …) — compound test is out of scope',
        code: `
          async function f() {
            const res = await fetch('/x')
            if (res.ok && hasPayload) {
              setItems(await res.json())
            }
          }
        `,
      },
      {
        name: 'if (someOther.flag) — non-.ok property not flagged',
        code: `
          function f(thing) {
            if (thing.ready) {
              doStuff()
            }
          }
        `,
      },
      {
        name: 'if (getResponse().ok) — test is a call result, not a simple ident.ok',
        code: `
          function f() {
            if (getResponse().ok) {
              handleSuccess()
            }
          }
        `,
      },
    ],

    invalid: [
      {
        name: 'bare if (res.ok) { … }',
        code: `
          async function f() {
            const res = await fetch('/x')
            if (res.ok) {
              const data = await res.json()
              setItems(data)
            }
          }
        `,
        errors: [{ messageId: 'noElse', data: { name: 'res' } }],
      },
      {
        name: 'single-statement if (response.ok) setItems(...)',
        code: `
          async function f() {
            const response = await fetch('/x')
            if (response.ok) setItems(await response.json())
          }
        `,
        errors: [{ messageId: 'noElse', data: { name: 'response' } }],
      },
      {
        name: 'if (res.ok) return res.json() — implicit fallthrough to undefined',
        code: `
          async function f() {
            const res = await fetch('/x')
            if (res.ok) return res.json()
          }
        `,
        errors: [{ messageId: 'noElse', data: { name: 'res' } }],
      },
      {
        name: 'custom response var name',
        code: `
          async function f() {
            const reply = await fetch('/x')
            if (reply.ok) {
              const data = await reply.json()
              return data
            }
          }
        `,
        errors: [{ messageId: 'noElse', data: { name: 'reply' } }],
      },
    ],
  })
})
