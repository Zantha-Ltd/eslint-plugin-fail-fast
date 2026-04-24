/**
 * RuleTester suite for no-error-masking. Run with: npm test
 */

const { RuleTester } = require('eslint')
const { test } = require('node:test')

const rule = require('../lib/rules/no-error-masking')

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

test('no-error-masking', () => {
  ruleTester.run('no-error-masking', rule, {
    valid: [
      {
        name: 'setError with err.message',
        code: `
          function f() {
            try { risky() } catch (err) {
              setError(err.message)
            }
          }
        `,
      },
      {
        name: 'setError with instanceof ternary',
        code: `
          function f() {
            try { risky() } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed')
            }
          }
        `,
      },
      {
        name: 'toast.error with template referencing err',
        code: `
          function f() {
            try { risky() } catch (err) {
              toast.error(\`Save failed: \${err.message}\`)
            }
          }
        `,
      },
      {
        name: 'setMessage with object carrying err.message',
        code: `
          function f() {
            try { risky() } catch (err) {
              setMessage({ type: 'error', text: err.message })
            }
          }
        `,
      },
      {
        name: 'setError with err-derived local alias',
        code: `
          function f() {
            try { risky() } catch (err) {
              const msg = err instanceof Error ? err.message : 'Unknown'
              setError(msg)
            }
          }
        `,
      },
      {
        name: 'setMessage with object carrying err-derived local in template',
        code: `
          function f() {
            try { risky() } catch (err) {
              const msg = err instanceof Error ? err.message : 'Unknown'
              setMessage({ type: 'error', text: \`Failed to X: \${msg}\` })
            }
          }
        `,
      },
      {
        name: 'underscore-prefixed param — intentional ignore',
        code: `
          function f() {
            try { risky() } catch (_err) {
              setError('Something went wrong')
            }
          }
        `,
      },
      {
        name: 'non-surface call with a literal — skipped',
        code: `
          function f() {
            try { risky() } catch (err) {
              trackEvent('retry_clicked', 'Something went wrong')
              setError(err.message)
            }
          }
        `,
      },
      {
        name: 'setState unrelated to error surface — skipped',
        code: `
          function f() {
            try { risky() } catch (err) {
              setState({ loading: false })
              setError(err.message)
            }
          }
        `,
      },
      {
        name: 'console.error is NOT a surface — covered by no-swallowing-catch',
        code: `
          function f() {
            try { risky() } catch (err) {
              console.error('generic', err)
              setError(err.message)
            }
          }
        `,
      },
    ],

    invalid: [
      {
        name: 'classic: console then setError with literal',
        code: `
          function f() {
            try { risky() } catch (err) {
              console.error(err)
              setError('Something went wrong')
            }
          }
        `,
        errors: [{ messageId: 'masking', data: { callee: 'setError', errName: 'err' } }],
      },
      {
        name: 'toast.error with literal',
        code: `
          function f() {
            try { risky() } catch (err) {
              console.warn(err)
              toast.error('Save failed')
            }
          }
        `,
        errors: [{ messageId: 'masking', data: { callee: 'toast.error', errName: 'err' } }],
      },
      {
        name: 'setMessage object with literal text field',
        code: `
          function f() {
            try { risky() } catch (err) {
              console.error(err)
              setMessage({ type: 'error', text: 'Internal error' })
            }
          }
        `,
        errors: [{ messageId: 'masking', data: { callee: 'setMessage', errName: 'err' } }],
      },
      {
        name: 'setWarning with literal',
        code: `
          function f() {
            try { risky() } catch (err) {
              console.error(err)
              setWarning('Could not load')
            }
          }
        `,
        errors: [{ messageId: 'masking', data: { callee: 'setWarning', errName: 'err' } }],
      },
      {
        name: 'showError with literal',
        code: `
          function f() {
            try { risky() } catch (err) {
              console.error(err)
              showError('Oops')
            }
          }
        `,
        errors: [{ messageId: 'masking', data: { callee: 'showError', errName: 'err' } }],
      },
      {
        name: 'notify.error with literal',
        code: `
          function f() {
            try { risky() } catch (err) {
              console.error(err)
              notify.error('Failed')
            }
          }
        `,
        errors: [{ messageId: 'masking', data: { callee: 'notify.error', errName: 'err' } }],
      },
      {
        name: 'setError with template that does not reference err',
        code: `
          function f() {
            try { risky() } catch (err) {
              console.error(err)
              const userId = getUserId()
              setError(\`Could not save for user \${userId}\`)
            }
          }
        `,
        errors: [{ messageId: 'masking', data: { callee: 'setError', errName: 'err' } }],
      },
    ],
  })
})
