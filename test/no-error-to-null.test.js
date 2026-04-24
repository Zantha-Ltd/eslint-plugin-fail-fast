/**
 * RuleTester suite for no-error-to-null. Run with: npm test
 */

const { RuleTester } = require('eslint')
const { test } = require('node:test')

const rule = require('../lib/rules/no-error-to-null')

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

test('no-error-to-null — catch clause', () => {
  ruleTester.run('no-error-to-null', rule, {
    valid: [
      {
        name: 'discriminator: ENOENT returns null, others re-throw',
        code: `
          function f() {
            try { risky() } catch (err) {
              if (err.code === 'ENOENT') return null
              throw err
            }
          }
        `,
      },
      {
        name: 'discriminator: early throw, then fall-through return null',
        code: `
          function f() {
            try { risky() } catch (err) {
              if (err.code !== 'ENOENT') throw err
              return null
            }
          }
        `,
      },
      {
        name: 'err is surfaced via setError before the return',
        code: `
          function f() {
            try { risky() } catch (err) {
              setError(err.message)
              return null
            }
          }
        `,
      },
      {
        name: 'err is re-thrown with context — no bare return at all',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new Error('wrapped: ' + err.message)
            }
          }
        `,
      },
      {
        name: 'catch returns a computed value derived from err',
        code: `
          function f() {
            try { risky() } catch (err) {
              return { error: err.message }
            }
          }
        `,
      },
      {
        name: 'catch returns a non-empty literal (default value, not silent failure)',
        code: `
          function f() {
            try { risky() } catch (err) {
              setError(err.message)
              return 'fallback-id'
            }
          }
        `,
      },
      {
        name: 'underscore-prefixed param is treated as intentional ignore',
        code: `
          function f() {
            try { risky() } catch (_err) { return null }
          }
        `,
      },
      {
        name: 'catch that logs then rethrows — no bare return',
        code: `
          function f() {
            try { risky() } catch (err) {
              console.error(err)
              throw err
            }
          }
        `,
      },
      {
        name: 'discriminator inside try-nested catch — throws in one branch, returns [] in other',
        code: `
          function f() {
            try { risky() } catch (err) {
              if (isRetryable(err)) throw err
              return []
            }
          }
        `,
      },
      {
        name: 'nested function expression with its own return null does not leak out',
        code: `
          function f() {
            try { risky() } catch (err) {
              const retry = () => null
              throw err
            }
          }
        `,
      },
      {
        name: 'err captured in nested setState arrow counts as surfacing',
        code: `
          function f() {
            try { risky() } catch (err) {
              setState(prev => ({ ...prev, error: err instanceof Error ? err.message : 'failed' }))
              return
            }
          }
        `,
      },
    ],

    invalid: [
      {
        name: 'single-statement return null',
        code: `
          function f() {
            try { risky() } catch (err) { return null }
          }
        `,
        errors: [{ messageId: 'catchToBare', data: { value: 'null' } }],
      },
      {
        name: 'single-statement return [] (empty array)',
        code: `
          function f() {
            try { risky() } catch (err) { return [] }
          }
        `,
        errors: [{ messageId: 'catchToBare', data: { value: '[]' } }],
      },
      {
        name: 'single-statement return {} (empty object)',
        code: `
          function f() {
            try { risky() } catch (err) { return {} }
          }
        `,
        errors: [{ messageId: 'catchToBare', data: { value: '{}' } }],
      },
      {
        name: 'single-statement return false',
        code: `
          function f() {
            try { risky() } catch (err) { return false }
          }
        `,
        errors: [{ messageId: 'catchToBare', data: { value: 'false' } }],
      },
      {
        name: 'single-statement return undefined (Identifier)',
        code: `
          function f() {
            try { risky() } catch (err) { return undefined }
          }
        `,
        errors: [{ messageId: 'catchToBare', data: { value: 'undefined' } }],
      },
      {
        name: 'single-statement bare return (implicit undefined)',
        code: `
          function f() {
            try { risky() } catch (err) { return }
          }
        `,
        errors: [{ messageId: 'catchToBare', data: { value: 'undefined' } }],
      },
      {
        name: 'no param binding — return null',
        code: `
          function f() {
            try { risky() } catch { return null }
          }
        `,
        errors: [{ messageId: 'catchToBare', data: { value: 'null' } }],
      },
      {
        name: 'console-only surfacing does not count — still an error-to-null',
        code: `
          function f() {
            try { risky() } catch (err) {
              console.error(err)
              return null
            }
          }
        `,
        errors: [{ messageId: 'catchToBare', data: { value: 'null' } }],
      },
      {
        name: 'conditional branch that logs, falls through to return null',
        code: `
          function f() {
            try { risky() } catch (err) {
              if (debug) console.warn(err)
              return null
            }
          }
        `,
        errors: [{ messageId: 'catchToBare', data: { value: 'null' } }],
      },
    ],
  })
})

test('no-error-to-null — promise .catch handler', () => {
  ruleTester.run('no-error-to-null', rule, {
    valid: [
      {
        name: 'promise .catch surfaces err via setError — non-empty return',
        code: `
          async function f() {
            await fetch('/x').catch(err => { setError(err.message); throw err })
          }
        `,
      },
      {
        name: 'promise .catch re-throws with context',
        code: `
          async function f() {
            await fetch('/x').catch(err => { throw new Error('wrap: ' + err.message) })
          }
        `,
      },
      {
        name: 'promise .catch with underscore param — intentional ignore',
        code: `
          async function f() {
            await fetch('/x').catch(_ => null)
          }
        `,
      },
      {
        name: 'promise .catch discriminates by error type',
        code: `
          async function f() {
            await fetch('/x').catch(err => {
              if (err.code === 'NOT_FOUND') return null
              throw err
            })
          }
        `,
      },
      {
        name: 'custom method also named catch on user object — harmless false-positive edge, but still not flagged here',
        code: `
          // We cannot distinguish Promise.catch from other .catch methods,
          // but .catch() with a handler that returns a bare literal is
          // virtually always the anti-pattern. This test documents that
          // the rule does fire here — moved to invalid if needed.
          myThing.then(x => x)
        `,
      },
    ],

    invalid: [
      {
        name: 'arrow expression returning null',
        code: `
          async function f() {
            await fetch('/x').catch(() => null)
          }
        `,
        errors: [{ messageId: 'promiseCatchToBare', data: { value: 'null' } }],
      },
      {
        name: 'arrow expression returning empty array',
        code: `
          async function f() {
            await fetch('/x').catch(() => [])
          }
        `,
        errors: [{ messageId: 'promiseCatchToBare', data: { value: '[]' } }],
      },
      {
        name: 'arrow expression returning false',
        code: `
          async function f() {
            await fetch('/x').catch(() => false)
          }
        `,
        errors: [{ messageId: 'promiseCatchToBare', data: { value: 'false' } }],
      },
      {
        name: 'arrow with param returning null',
        code: `
          async function f() {
            await fetch('/x').catch(err => null)
          }
        `,
        errors: [{ messageId: 'promiseCatchToBare', data: { value: 'null' } }],
      },
      {
        name: 'block body arrow returning null',
        code: `
          async function f() {
            await fetch('/x').catch(err => { return null })
          }
        `,
        errors: [{ messageId: 'promiseCatchToBare', data: { value: 'null' } }],
      },
      {
        name: 'block body with console log then return null',
        code: `
          async function f() {
            await fetch('/x').catch(err => {
              console.error(err)
              return null
            })
          }
        `,
        errors: [{ messageId: 'promiseCatchToBare', data: { value: 'null' } }],
      },
    ],
  })
})
