/**
 * RuleTester suite for no-swallowing-catch. Run with: npm test
 */

const { RuleTester } = require('eslint')
const { test } = require('node:test')

const rule = require('../lib/rules/no-swallowing-catch')

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

test('no-swallowing-catch', () => {
  ruleTester.run('no-swallowing-catch', rule, {
    valid: [
      {
        name: 'rethrow with context',
        code: `
          function f() {
            try { risky() } catch (err) { throw new Error('failed: ' + (err instanceof Error ? err.message : err)) }
          }
        `,
      },
      {
        name: 'surfaces err via setError',
        code: `
          function f() {
            try { risky() } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
          }
        `,
      },
      {
        name: 'underscore-prefixed param — intentional drop (matches eslint caughtErrorsIgnorePattern)',
        code: `
          function f() {
            try { risky() } catch (_err) { return null }
          }
        `,
      },
      {
        name: 'err referenced in return value',
        code: `
          function f() {
            try { risky(); return null } catch (err) { return { error: err.message } }
          }
        `,
      },
      {
        name: 'err referenced in template literal',
        code: `
          function f() {
            try { risky() } catch (err) { throw new Error(\`wrapper: \${err}\`) }
          }
        `,
      },
      {
        name: 'non-console logger (known limitation — not flagged)',
        code: `
          function f() {
            try { risky() } catch (err) { log.debug('risky failed', err) }
          }
        `,
      },
      {
        name: 'err used in nested conditional',
        code: `
          function f() {
            try { risky() } catch (err) {
              if (err instanceof TypeError) { throw err }
              setError(String(err))
            }
          }
        `,
      },
    ],

    invalid: [
      {
        name: 'no err binding (the bug that motivated this rule)',
        code: `
          function f() {
            try { risky() } catch { /* non-JSON body */ }
          }
        `,
        errors: [{ messageId: 'noErrBinding' }],
      },
      {
        name: 'empty catch body',
        code: `
          function f() {
            try { risky() } catch (err) {}
          }
        `,
        errors: [{ messageId: 'emptyBody' }],
      },
      {
        name: 'err caught but never referenced',
        code: `
          function f() {
            try { risky() } catch (err) { doSomethingElse() }
          }
        `,
        errors: [{ messageId: 'errUnused', data: { name: 'err' } }],
      },
      {
        name: 'err only logged to console.error',
        code: `
          function f() {
            try { risky() } catch (err) { console.error(err) }
          }
        `,
        errors: [{ messageId: 'onlyLogged', data: { method: 'error' } }],
      },
      {
        name: 'err only logged to console.warn',
        code: `
          function f() {
            try { risky() } catch (err) { console.warn('oops', err) }
          }
        `,
        errors: [{ messageId: 'onlyLogged', data: { method: 'warn' } }],
      },
      {
        name: 'err only logged to console.log',
        code: `
          function f() {
            try { risky() } catch (err) { console.log(err) }
          }
        `,
        errors: [{ messageId: 'onlyLogged', data: { method: 'log' } }],
      },
      {
        name: 'no err binding + body that does something unrelated',
        code: `
          function f() {
            try { risky() } catch { doSomethingElse() }
          }
        `,
        errors: [{ messageId: 'noErrBinding' }],
      },
    ],
  })
})
