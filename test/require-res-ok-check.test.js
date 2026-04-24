/**
 * RuleTester suite for require-res-ok-check. Run with: npm test
 */

const { RuleTester } = require('eslint')
const { test } = require('node:test')

const rule = require('../lib/rules/require-res-ok-check')

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

test('require-res-ok-check', () => {
  ruleTester.run('require-res-ok-check', rule, {
    valid: [
      {
        name: 'guarded: res.ok checked before json()',
        code: `
          async function f() {
            const res = await fetch('/api/items')
            if (!res.ok) throw new Error('Failed: ' + res.status)
            const data = await res.json()
            return data
          }
        `,
      },
      {
        name: 'guarded: res.status used in manual check',
        code: `
          async function f() {
            const res = await fetch('/api/items')
            if (res.status >= 400) throw new Error('HTTP ' + res.status)
            return await res.json()
          }
        `,
      },
      {
        name: 'guarded: res.statusText referenced (unusual but ok)',
        code: `
          async function f() {
            const res = await fetch('/x')
            console.log(res.statusText)
            if (!res.ok) throw new Error(res.statusText)
            return await res.text()
          }
        `,
      },
      {
        name: 'no parse call — just returning res (downstream consumer parses)',
        code: `
          async function f() {
            const res = await fetch('/x')
            return res
          }
        `,
      },
      {
        name: 'parse via .clone() — .clone is not in the parse set',
        code: `
          async function f() {
            const res = await fetch('/x')
            if (!res.ok) throw new Error('fail')
            const copy = res.clone()
            return await copy.text()
          }
        `,
      },
      {
        name: 'await not on fetch — different function entirely',
        code: `
          async function f() {
            const res = await otherThing('/x')
            return await res.json()
          }
        `,
      },
      {
        name: 'headers counts as a check — developer inspected response',
        code: `
          async function f() {
            const res = await fetch('/x')
            const contentType = res.headers.get('content-type') || ''
            if (!contentType.includes('application/json')) throw new Error('not json')
            return await res.json()
          }
        `,
      },
      {
        name: 'promise chain with ok guard in arrow body',
        code: `
          async function f() {
            return fetch('/x').then(r => {
              if (!r.ok) throw new Error('fail')
              return r.json()
            })
          }
        `,
      },
      {
        name: 'promise chain with status guard',
        code: `
          async function f() {
            return fetch('/x').then(r => {
              if (r.status >= 400) throw new Error('bad')
              return r.text()
            })
          }
        `,
      },
      {
        name: 'promise chain with underscore param — intentional ignore',
        code: `
          async function f() {
            return fetch('/x').then(_r => somethingElse())
          }
        `,
      },
      {
        name: 'non-fetch .then chain is ignored',
        code: `
          async function f() {
            return someOther('/x').then(r => r.json())
          }
        `,
      },
    ],

    invalid: [
      {
        name: 'unguarded: const res = await fetch; res.json()',
        code: `
          async function f() {
            const res = await fetch('/api/items')
            const data = await res.json()
            return data
          }
        `,
        errors: [{ messageId: 'noResOkCheckVar', data: { name: 'res', method: 'json' } }],
      },
      {
        name: 'unguarded: res.text()',
        code: `
          async function f() {
            const res = await fetch('/x')
            return await res.text()
          }
        `,
        errors: [{ messageId: 'noResOkCheckVar', data: { name: 'res', method: 'text' } }],
      },
      {
        name: 'unguarded: res.blob()',
        code: `
          async function f() {
            const r = await fetch('/file')
            const blob = await r.blob()
            return blob
          }
        `,
        errors: [{ messageId: 'noResOkCheckVar', data: { name: 'r', method: 'blob' } }],
      },
      {
        name: 'unguarded even with a console log (logging is not a check)',
        code: `
          async function f() {
            const res = await fetch('/x')
            console.log('fetched')
            return await res.json()
          }
        `,
        errors: [{ messageId: 'noResOkCheckVar' }],
      },
      {
        name: 'unguarded: multiple parses both fire',
        code: `
          async function f() {
            const res = await fetch('/x')
            const data = await res.json()
            const text = await res.text()
            return { data, text }
          }
        `,
        errors: [
          { messageId: 'noResOkCheckVar', data: { name: 'res', method: 'json' } },
          { messageId: 'noResOkCheckVar', data: { name: 'res', method: 'text' } },
        ],
      },
      {
        name: 'unguarded: let-declared var',
        code: `
          async function f() {
            let res = await fetch('/x')
            return await res.json()
          }
        `,
        errors: [{ messageId: 'noResOkCheckVar' }],
      },
      {
        name: 'unguarded: arrayBuffer parse',
        code: `
          async function f() {
            const res = await fetch('/file')
            return await res.arrayBuffer()
          }
        `,
        errors: [{ messageId: 'noResOkCheckVar', data: { name: 'res', method: 'arrayBuffer' } }],
      },
      {
        name: 'promise chain: fetch(url).then(r => r.json())',
        code: `
          async function f() {
            return fetch('/x').then(r => r.json())
          }
        `,
        errors: [{ messageId: 'noResOkCheckThen', data: { method: 'json' } }],
      },
      {
        name: 'promise chain block body without guard',
        code: `
          async function f() {
            return fetch('/x').then(r => {
              return r.text()
            })
          }
        `,
        errors: [{ messageId: 'noResOkCheckThen', data: { method: 'text' } }],
      },
      {
        name: 'promise chain with console log only (not a check)',
        code: `
          async function f() {
            return fetch('/x').then(r => {
              console.log('got response')
              return r.json()
            })
          }
        `,
        errors: [{ messageId: 'noResOkCheckThen', data: { method: 'json' } }],
      },
      {
        name: 'parenthesised await fetch().json()',
        code: `
          async function f() {
            const data = await (await fetch('/x')).json()
            return data
          }
        `,
        errors: [{ messageId: 'noResOkCheckAwaitChain', data: { method: 'json' } }],
      },
      {
        name: 'parenthesised await fetch().text()',
        code: `
          async function f() {
            return await (await fetch('/x')).text()
          }
        `,
        errors: [{ messageId: 'noResOkCheckAwaitChain', data: { method: 'text' } }],
      },
    ],
  })
})
