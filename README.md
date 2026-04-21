# @zantha/eslint-plugin-fail-fast

ESLint rules that enforce the fail-fast error-handling principle: **every error must be visible to the user**. Never swallow, mask, or silently convert to null / empty / false.

Codifies the anti-pattern catalogue from the `fail-fast-coding` skill on zantha-roles so violations surface at dev / CI time rather than in production.

## Install

```bash
npm i -D @zantha/eslint-plugin-fail-fast
```

(Published to GitHub Packages — add `@zantha:registry=https://npm.pkg.github.com` to your `.npmrc`.)

## Usage — legacy config (`.eslintrc.json`)

```json
{
  "plugins": ["@zantha/fail-fast"],
  "rules": {
    "@zantha/fail-fast/no-swallowing-catch": "error"
  }
}
```

Or pull in the recommended preset:

```json
{
  "extends": ["plugin:@zantha/fail-fast/recommended"]
}
```

## Rules

### `no-swallowing-catch`

Flags `catch` clauses that silently swallow the error. Four sub-cases:

| Pattern | Message |
|---|---|
| `try { … } catch { /* reason */ }` | no err binding — explanatory-comment-is-a-tell |
| `try { … } catch (err) { }` | empty body |
| `try { … } catch (err) { doOther() }` | err never referenced |
| `try { … } catch (err) { console.error(err) }` | err only logged to console, never surfaced |

Legitimate escape hatch — use an inline disable with a justification:

```js
// eslint-disable-next-line @zantha/fail-fast/no-swallowing-catch -- ENOENT means file absent, expected
try { readFileSync(path) } catch { return null }
```

Intentional drops can also use `_` / `_err` as the parameter name (matches ESLint's `caughtErrorsIgnorePattern: '^_'` convention).

## Planned rules

- `no-bare-json-parse-catch` — flags `JSON.parse` wrapped in a swallowing `.catch()` or try/catch.
- `no-unref-err-rethrow` — flags `catch (err) { throw new Error('foo') }` where the new Error doesn't chain `err`.
- `no-generic-500-response` — flags API catch blocks that return `{ error: 'Server error' }` without including `err.message`.

## Development

```bash
npm install
npm test
```

Rules are plain Node.js AST rules (no TS compile step). Tests use ESLint's `RuleTester` under Node's built-in `node:test` runner.

## Versioning & publish

Tag `v<semver>` to trigger the publish workflow. GitHub Actions runs the test suite and publishes to GitHub Packages.
