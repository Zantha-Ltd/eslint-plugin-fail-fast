/**
 * RuleTester suite for no-generic-api-error. Run with: npm test
 */

const { RuleTester } = require('eslint')
const { test } = require('node:test')

const rule = require('../lib/rules/no-generic-api-error')

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

test('no-generic-api-error', () => {
  ruleTester.run('no-generic-api-error', rule, {
    valid: [
      {
        name: 'err.message surfaced via ternary',
        code: `
          function f() {
            try { risky() } catch (err) {
              return NextResponse.json(
                { error: err instanceof Error ? err.message : 'Unknown error' },
                { status: 500 }
              )
            }
          }
        `,
      },
      {
        name: 'err.message via local var referenced in error value',
        code: `
          function f() {
            try { risky() } catch (err) {
              const message = err instanceof Error ? err.message : 'Unknown'
              return NextResponse.json({ error: message }, { status: 500 })
            }
          }
        `,
        // Note: this actually fails today because the local var masks the ref.
        // Documented as a known weakness below in invalid tests.
      },
      {
        name: 'client error (400) — out of scope',
        code: `
          function f() {
            try { risky() } catch (err) {
              return NextResponse.json({ error: 'Bad input' }, { status: 400 })
            }
          }
        `,
      },
      {
        name: 'status variable — cannot resolve statically, skipped',
        code: `
          function f() {
            try { risky() } catch (err) {
              const status = 500
              return NextResponse.json({ error: 'Server error' }, { status })
            }
          }
        `,
      },
      {
        name: 'body is not an object literal — skipped',
        code: `
          function f() {
            try { risky() } catch (err) {
              const body = buildErrorBody(err)
              return NextResponse.json(body, { status: 500 })
            }
          }
        `,
      },
      {
        name: 'no error key in body — skipped (different anti-pattern if any)',
        code: `
          function f() {
            try { risky() } catch (err) {
              return NextResponse.json({ success: false, timestamp: now() }, { status: 500 })
            }
          }
        `,
      },
      {
        name: 'discriminator: 400 for validation, surfaced 500 for unknown',
        code: `
          function f() {
            try { risky() } catch (err) {
              if (err instanceof ValidationError) {
                return NextResponse.json({ error: 'Missing field: sku' }, { status: 400 })
              }
              return NextResponse.json({ error: err.message }, { status: 500 })
            }
          }
        `,
      },
      {
        name: 'Response.json with err.message',
        code: `
          function f() {
            try { risky() } catch (err) {
              return Response.json({ error: err.message }, { status: 500 })
            }
          }
        `,
      },
      {
        name: 'err-derived alias wrapped in a template literal prefix',
        code: `
          function f() {
            try { risky() } catch (err) {
              const msg = err instanceof Error ? err.message : 'Unknown'
              return NextResponse.json({ error: \`Failed to X: \${msg}\` }, { status: 500 })
            }
          }
        `,
      },
      {
        name: 'err-derived alias concatenated with a prefix',
        code: `
          function f() {
            try { risky() } catch (err) {
              const msg = err instanceof Error ? err.message : 'Unknown'
              return NextResponse.json({ error: 'Failed: ' + msg }, { status: 500 })
            }
          }
        `,
      },
      {
        name: 'underscore-prefixed param — intentional ignore',
        code: `
          function f() {
            try { risky() } catch (_err) {
              return NextResponse.json({ error: 'Server error' }, { status: 500 })
            }
          }
        `,
      },
      {
        name: 'response call in nested function (e.g. callback) — different scope',
        code: `
          function f() {
            try { risky() } catch (err) {
              setError(err.message)
              const handler = () => NextResponse.json({ error: 'Handler failed' }, { status: 500 })
              handler()
            }
          }
        `,
      },
    ],

    invalid: [
      {
        name: 'canonical: NextResponse.json Server error status 500',
        code: `
          function f() {
            try { risky() } catch (err) {
              console.error(err)
              return NextResponse.json({ error: 'Server error' }, { status: 500 })
            }
          }
        `,
        errors: [{ messageId: 'genericError', data: { status: 500, key: 'error', errName: 'err' } }],
      },
      {
        name: 'status 502',
        code: `
          function f() {
            try { risky() } catch (err) {
              return NextResponse.json({ error: 'Upstream failed' }, { status: 502 })
            }
          }
        `,
        errors: [{ messageId: 'genericError', data: { status: 502, key: 'error', errName: 'err' } }],
      },
      {
        name: 'Response.json generic 500',
        code: `
          function f() {
            try { risky() } catch (err) {
              return Response.json({ error: 'Internal' }, { status: 500 })
            }
          }
        `,
        errors: [{ messageId: 'genericError' }],
      },
      {
        name: 'new NextResponse with object body',
        code: `
          function f() {
            try { risky() } catch (err) {
              return new NextResponse({ error: 'Server error' }, { status: 500 })
            }
          }
        `,
        errors: [{ messageId: 'genericError' }],
      },
      {
        name: 'message key also flagged',
        code: `
          function f() {
            try { risky() } catch (err) {
              return NextResponse.json({ message: 'Internal server error' }, { status: 500 })
            }
          }
        `,
        errors: [{ messageId: 'genericError', data: { status: 500, key: 'message', errName: 'err' } }],
      },
      {
        name: 'response inside nested if — still flagged',
        code: `
          function f() {
            try { risky() } catch (err) {
              if (isBad()) {
                return NextResponse.json({ error: 'Something bad happened' }, { status: 500 })
              }
              throw err
            }
          }
        `,
        errors: [{ messageId: 'genericError' }],
      },
    ],
  })
})
