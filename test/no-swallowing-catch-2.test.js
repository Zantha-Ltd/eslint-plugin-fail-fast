const { test } = require('node:test')
const path = require('path')
const req = require('module').createRequire(path.join(process.env.ESLINT_FROM || path.join(__dirname, '..', 'node_modules'), 'x.js'))
const { RuleTester } = req('eslint')
const major = Number(req('eslint/package.json').version.split('.')[0])
const rule = require('../lib/rules/no-swallowing-catch')

const tester = new RuleTester(major >= 9
  ? { languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } }
  : { parserOptions: { ecmaVersion: 2022, sourceType: 'module' } })
const wrap = (body) => `async function f(items) { for (const it of items) { try { await it.run() } catch (err) { ${body} } } }`

test('no-swallowing-catch 2.0.0: a log followed only by a counter, flag, continue, break or bare return is a swallow', () => {
  tester.run('no-swallowing-catch', rule, {
    valid: [
      { code: wrap('console.error(err); toSignIn()') },
      { code: wrap('console.error(err); throw err') },
      { code: wrap('console.error(err); return mapped(err)') },
      { code: wrap('console.error(err); return { ok: false, error: err.message }') },
      { code: wrap('failures.push(err)') },
      { code: wrap('console.warn("auth failed", err); window.location.href = "/auth/signin"') },
    ],
    invalid: [
      { code: wrap('console.error(err)'), errors: [{ messageId: 'onlyLogged' }] },
      { code: wrap('console.error(err); failed++'), errors: [{ messageId: 'loggedThenDropped' }] },
      { code: wrap('console.error(err); failed += 1'), errors: [{ messageId: 'loggedThenDropped' }] },
      { code: wrap('console.error(err); ok = false'), errors: [{ messageId: 'loggedThenDropped' }] },
      { code: wrap('console.error(err); continue'), errors: [{ messageId: 'loggedThenDropped' }] },
      { code: wrap('console.error(err); break'), errors: [{ messageId: 'loggedThenDropped' }] },
      { code: wrap('console.error(err); return'), errors: [{ messageId: 'loggedThenDropped' }] },
      { code: wrap('console.error(err); return null'), errors: [{ messageId: 'loggedThenDropped' }] },
      { code: wrap('console.error(err); return undefined'), errors: [{ messageId: 'loggedThenDropped' }] },
      { code: wrap('console.warn("x", err); console.error(err)'), errors: [{ messageId: 'onlyLogged' }] },
    ],
  })
})
