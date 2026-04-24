/**
 * RuleTester suite for no-context-stripping. Run with: npm test
 */

const { RuleTester } = require('eslint')
const { test } = require('node:test')

const rule = require('../lib/rules/no-context-stripping')

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

test('no-context-stripping', () => {
  ruleTester.run('no-context-stripping', rule, {
    valid: [
      {
        name: 'bare rethrow preserves context natively',
        code: `
          function f() {
            try { risky() } catch (err) { throw err }
          }
        `,
      },
      {
        name: 'err interpolated into template message',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new Error(\`Failed to deploy: \${err instanceof Error ? err.message : err}\`)
            }
          }
        `,
      },
      {
        name: 'err concatenated into message',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new Error('Failed to deploy: ' + err.message)
            }
          }
        `,
      },
      {
        name: 'err passed as cause',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new Error('Failed to deploy', { cause: err })
            }
          }
        `,
      },
      {
        name: 'err passed as cause via helper call',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new Error('Failed to deploy', { cause: wrapError(err) })
            }
          }
        `,
      },
      {
        name: 'underscore-prefixed param — intentional ignore',
        code: `
          function f() {
            try { risky() } catch (_err) { throw new Error('ignored') }
          }
        `,
      },
      {
        name: 'throw in nested arrow belongs to a different scope',
        code: `
          function f() {
            try { risky() } catch (err) {
              const onRetry = () => { throw new Error('retry failed') }
              setError(err.message)
              onRetry()
            }
          }
        `,
      },
      {
        name: 'throwing a non-Error constructor (e.g. a CustomErrorlike class without Error suffix)',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new DomainFault('not an error-named class') // out of scope for v1
            }
          }
        `,
      },
      {
        name: 'TypeError subclass — err interpolated',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new TypeError(\`Bad input: \${err.message}\`)
            }
          }
        `,
      },
      {
        name: 'custom *Error subclass — cause chained',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new AuthError('Session invalid', { cause: err })
            }
          }
        `,
      },
    ],

    invalid: [
      {
        name: 'plain new Error with literal message, no cause',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new Error('Failed')
            }
          }
        `,
        errors: [{ messageId: 'stripped', data: { name: 'Error', errName: 'err' } }],
      },
      {
        name: 'new Error with template that does not reference err',
        code: `
          function f() {
            try { risky() } catch (err) {
              const count = 3
              throw new Error(\`Failed after \${count} attempts\`)
            }
          }
        `,
        errors: [{ messageId: 'stripped' }],
      },
      {
        name: 'new Error with concat that does not reference err',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new Error('Failed: ' + 'hardcoded')
            }
          }
        `,
        errors: [{ messageId: 'stripped' }],
      },
      {
        name: 'new Error with options but no cause',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new Error('Failed', { meta: true })
            }
          }
        `,
        errors: [{ messageId: 'stripped' }],
      },
      {
        name: 'new Error with cause referencing something else',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new Error('Failed', { cause: otherThing })
            }
          }
        `,
        errors: [{ messageId: 'stripped' }],
      },
      {
        name: 'TypeError subclass with literal message',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new TypeError('Bad input')
            }
          }
        `,
        errors: [{ messageId: 'stripped', data: { name: 'TypeError', errName: 'err' } }],
      },
      {
        name: 'custom *Error subclass with literal message',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new AuthError('Session invalid')
            }
          }
        `,
        errors: [{ messageId: 'stripped', data: { name: 'AuthError', errName: 'err' } }],
      },
      {
        name: 'throw inside nested if — still flagged',
        code: `
          function f() {
            try { risky() } catch (err) {
              if (isBadState()) {
                throw new Error('Bad state detected')
              }
              setError(err.message)
            }
          }
        `,
        errors: [{ messageId: 'stripped' }],
      },
      {
        name: 'no-arg new Error',
        code: `
          function f() {
            try { risky() } catch (err) {
              throw new Error()
            }
          }
        `,
        errors: [{ messageId: 'stripped' }],
      },
      {
        name: 'throw of err-derived local var — rule is strict; use { cause: err } or inline',
        code: `
          function f() {
            try { risky() } catch (err) {
              const detail = err.message
              throw new Error(detail)
            }
          }
        `,
        errors: [{ messageId: 'stripped' }],
      },
    ],
  })
})
