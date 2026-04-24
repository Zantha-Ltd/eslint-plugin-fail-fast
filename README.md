# @zantha-ltd/eslint-plugin-fail-fast

ESLint rules that enforce the fail-fast error-handling principle: **every error must be visible to the user**. Never swallow, mask, or silently convert to null / empty / false.

Codifies the anti-pattern catalogue from the `fail-fast-coding` skill on zantha-roles so violations surface at dev / CI time rather than in production.

## Install

```bash
npm i -D @zantha-ltd/eslint-plugin-fail-fast
```

(Published to GitHub Packages — add `@zantha-ltd:registry=https://npm.pkg.github.com` to your `.npmrc`.)

## Usage — legacy config (`.eslintrc.json`)

```json
{
  "plugins": ["@zantha-ltd/fail-fast"],
  "rules": {
    "@zantha-ltd/fail-fast/no-swallowing-catch": "error",
    "@zantha-ltd/fail-fast/no-error-to-null": "error",
    "@zantha-ltd/fail-fast/no-context-stripping": "error"
  }
}
```

Or pull in the recommended preset:

```json
{
  "extends": ["plugin:@zantha-ltd/fail-fast/recommended"]
}
```

## Usage — flat config (`eslint.config.js`)

```js
import failFast from '@zantha-ltd/eslint-plugin-fail-fast'

export default [
  failFast.configs['flat/recommended'],
  // …your other config objects
]
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

### `no-error-to-null`

Flags handlers that silently convert every error into a bare default (`null`, `undefined`, `[]`, `{}`, `false`, `0`, `''`). The caller can't tell an expected absence from a real failure.

| Pattern | Fix |
|---|---|
| `catch (err) { return null }` | discriminate the expected case (e.g. `err.code === 'ENOENT'`) and re-throw unknowns |
| `catch { return [] }` | same — distinguish "legitimately empty" from "broken" |
| `.catch(() => null)` | check for the specific error, or drop the `.catch` and let it propagate |
| `.catch(err => { console.error(err); return null })` | surface the error (not just log), or re-throw |

Allowed forms:

```js
// Discriminator — expected case short-circuits, unknowns re-thrown
try { return await readRole(name) } catch (err) {
  if (err.code === 'ENOENT') return null
  throw err
}

// Surfacing — err is passed to a real handler before the sentinel return
try { await loadItem() } catch (err) {
  setError(err.message)
  return null
}
```

Legitimate escape hatch — inline disable with a justification:

```js
// eslint-disable-next-line @zantha-ltd/fail-fast/no-error-to-null -- ENOENT means file absent, expected
try { readFileSync(path) } catch { return null }
```

Intentional drops can also use `_` / `_err` as the parameter name (matches ESLint's `caughtErrorsIgnorePattern: '^_'` convention).

### `no-context-stripping`

Flags `throw new Error(...)` (or any `*Error` constructor) inside a `catch (err)` block whose arguments don't reference `err`. Losing the original error erases the stack trace and message — callers get a wrapper error with no pointer to the real failure.

| Pattern | Fix |
|---|---|
| `catch (err) { throw new Error('Failed') }` | interpolate: `` throw new Error(`Failed: ${err.message}`) `` |
| `catch (err) { throw new Error('Failed', { meta: true }) }` | options without `cause`: add `{ cause: err }` |
| `catch (err) { throw new TypeError('Bad input') }` | custom subclasses follow the same contract |

Allowed forms:

```js
// Bare rethrow — preserves everything natively
catch (err) { throw err }

// Interpolated message — err in the user-visible string
catch (err) { throw new Error(`Failed to deploy: ${err instanceof Error ? err.message : err}`) }

// ES2022 cause — err chained via the standard options
catch (err) { throw new Error('Failed to deploy', { cause: err }) }
```

If you alias `err` into a local (`const msg = err.message; throw new Error(msg)`), the rule still fires because the static check can't follow the reference — inline the template literal or switch to `{ cause: err }`.

Intentional drops: use `_` / `_err` as the catch parameter name to tell the rule the caught error is deliberately unused.

## Planned rules

- `no-generic-api-error` — flags API catch blocks that return `{ error: 'Server error' }` without including `err.message`.
- `require-res-ok-check` — flags `await fetch(...)` whose result reaches `.json()` / `.text()` without a `res.ok` guard.
- `no-error-masking` — flags `setError('Something went wrong')` in a catch that ignores the caught err (needs a convention list of surface-function names).

## Development

```bash
npm install
npm test
```

Rules are plain Node.js AST rules (no TS compile step). Tests use ESLint's `RuleTester` under Node's built-in `node:test` runner.

## Versioning & publish

Tag `v<semver>` to trigger the publish workflow. GitHub Actions runs the test suite and publishes to GitHub Packages.
