# @zantha-ltd/eslint-plugin-fail-fast

ESLint rules that enforce the fail-fast error-handling principle: **every error must be visible to the user**. Never swallow, mask, or silently convert to null / empty / false.

Codifies the anti-pattern catalogue from the `fail-fast-coding` skill on zantha-roles so violations surface at dev / CI time rather than in production.

## Rules at a glance

| Rule | Catches |
|---|---|
| [`no-swallowing-catch`](#no-swallowing-catch) | empty catches, unused err, console-only surfacing |
| [`no-error-to-null`](#no-error-to-null) | `catch { return null }` / `.catch(() => [])` silent degradations |
| [`no-context-stripping`](#no-context-stripping) | `throw new Error('Failed')` that drops err's stack / message |
| [`no-generic-api-error`](#no-generic-api-error) | 5xx responses with literal error strings (Next.js + Fastify) |
| [`require-res-ok-check`](#require-res-ok-check) | `res.json()` without checking `res.ok` / `.status` |
| [`no-error-masking`](#no-error-masking) | `setError('Something went wrong')` in a catch that doesn't use err |
| [`no-if-res-ok-no-else`](#no-if-res-ok-no-else) | `if (res.ok) { … }` with no else — non-OK case silently ignored |

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
    "@zantha-ltd/fail-fast/no-context-stripping": "error",
    "@zantha-ltd/fail-fast/no-generic-api-error": "error",
    "@zantha-ltd/fail-fast/require-res-ok-check": "error",
    "@zantha-ltd/fail-fast/no-error-masking": "error",
    "@zantha-ltd/fail-fast/no-if-res-ok-no-else": "error"
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

## Repo CI gate setup

Installing the plugin and enabling it in ESLint config makes violations show up in `npm run lint`. To make those violations *block PR merges* — the wall the rules are designed to be — three more pieces are required:

1. **Caller workflow** (`.github/workflows/fail-fast.yml`) that calls the org reusable workflow `Zantha-Ltd/.github/.github/workflows/fail-fast-lint.yml@main`. Template + inputs in [Zantha-Ltd/.github/docs/onboard-repo.md §2e](https://github.com/Zantha-Ltd/.github/blob/main/docs/onboard-repo.md).
2. **Org ruleset entry** — add the repo to `conditions.repository_name.include` in `Zantha-Ltd/.github/rulesets/fail-fast-required.json`, then run `./rulesets/apply-all.sh`. This requires the `lint / fail-fast-lint` status check on `main`, admin-bypass only. See onboard-repo.md §2g.
3. **Repo merge settings — `allow_auto_merge` and `delete_branch_on_merge`** (see below). Without these the gate technically works but PRs sit unmerged, stale branches accumulate, and main diverges from in-flight work. This is the step most often forgotten.

### Auto-merge — turn it on

GitHub repos default to `allow_auto_merge: false`. With that flag off, `gh pr merge <N> --auto` silently does nothing: a passing lint check produces no automatic outcome, every PR needs a manual click. Stuck PRs accumulate, main moves forward via the PRs that *do* get clicked, and the stuck ones drift into merge conflicts.

```bash
# Check current state
gh api repos/Zantha-Ltd/<repo> --jq '{allow_auto_merge, delete_branch_on_merge}'

# Flip both (one-time per repo)
gh api -X PATCH repos/Zantha-Ltd/<repo> \
  -f allow_auto_merge=true \
  -f delete_branch_on_merge=true
```

Why both:

- `allow_auto_merge: true` enables `gh pr merge <N> --auto --merge`. With the fail-fast ruleset on, the PR merges automatically the moment `lint / fail-fast-lint` goes green — no human in the loop.
- `delete_branch_on_merge: true` retires merged feature branches automatically. Without it, stale `feat/*` / `refactor/*` branches accumulate on origin.

For the repo author's day-to-day flow that uses these settings, see `content/workflows/git-deploy.md` in `Zantha-Ltd/zantha-mcp` — the canonical "ship code via PR + auto-merge" workflow.

---

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

### `no-generic-api-error`

Flags API error responses whose body is an object with a literal error string that doesn't reference the caught err. Covers both Next.js and Fastify idioms:

- `NextResponse.json(body, { status: N })`
- `Response.json(body, { status: N })`
- `new NextResponse(body, { status: N })`
- `reply.code(N).send(body)` / `reply.status(N).send(body)` (Fastify — chained form only)

Only fires when `N ≥ 500` as a numeric literal. 4xx responses are deliberately out of scope — usually intentional client errors.

Follows aliases through `const <id> = <expr with err>` declarations, template literals, `+` concatenation, ternaries, and object-property values — so `{ error: `Failed to X: ${msg}` }` passes when `msg` is err-derived.

| Pattern | Fix |
|---|---|
| `return NextResponse.json({ error: 'Server error' }, { status: 500 })` | interpolate: `{ error: err instanceof Error ? err.message : 'Unknown error' }` |
| `return Response.json({ message: 'Internal' }, { status: 502 })` | same — `error` / `message` / `detail` keys all flagged |
| `reply.code(500).send({ error: 'upstream gone' })` | same — Fastify form |

Allowed forms:

```js
// Direct err.message interpolation
catch (err) {
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'Unknown error' },
    { status: 500 }
  )
}

// Local var aliased from err — rule follows the declaration, including
// through templates / concat prefixes
catch (err) {
  const message = err instanceof Error ? err.message : 'Unknown error'
  return NextResponse.json({ error: `Failed to save: ${message}` }, { status: 500 })
}

// Discriminator: 4xx responses are out of scope
catch (err) {
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: 'Missing field: sku' }, { status: 400 })
  }
  return NextResponse.json({ error: err.message }, { status: 500 })
}
```

Rule scope is deliberately narrow: opaque body expressions (non-object-literal, e.g. `buildErrorBody(err)`) and non-literal status codes are skipped to keep false positives low.

### `require-res-ok-check`

Flags `res.json()` / `res.text()` / `res.blob()` / `res.arrayBuffer()` / `res.formData()` calls on a fetch result when no `res.ok` / `res.status` / `res.statusText` / `res.headers` access exists in the enclosing scope. A non-2xx response silently gets its error body parsed as if it were success, or throws a cryptic `SyntaxError` on HTML error pages.

Three forms covered:

| Shape | Example |
|---|---|
| Assigned variable | `const res = await fetch(url); res.json()` |
| Parenthesised await | `(await fetch(url)).json()` |
| Promise chain | `fetch(url).then(r => r.json())` |

| Pattern | Fix |
|---|---|
| `const res = await fetch(...); const data = await res.json()` | add `if (!res.ok) throw new Error(...)` before the parse |
| `fetch(url).then(r => r.json())` | `fetch(url).then(r => { if (!r.ok) throw …; return r.json() })` |
| `(await fetch(url)).json()` | bind to a variable, guard it, then parse |

Allowed forms:

```js
// Standard ok guard
const res = await fetch('/api/items')
if (!res.ok) throw new Error(`Failed: ${res.status}`)
const data = await res.json()

// Manual status check — .status reference is enough
const res = await fetch('/api/items')
if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
return await res.json()

// Content-type branch — .headers reference is enough
const res = await fetch('/api/items')
const contentType = res.headers.get('content-type') || ''
if (!contentType.includes('application/json')) throw new Error('not json')
return await res.json()

// Promise chain with in-callback guard
return fetch(url).then(r => {
  if (!r.ok) throw new Error(`Failed: ${r.status}`)
  return r.json()
})
```

### `no-error-masking`

Flags calls that look like error-surface functions (setError, toast.error, setMessage, showWarning, etc.) inside a `catch (err)` whose first argument doesn't surface the caught err. The anti-pattern: the developer console.logs err but shows the user a generic "Something went wrong" — user has no idea what actually broke.

| Pattern | Fix |
|---|---|
| `catch (err) { console.error(err); setError('Something went wrong') }` | `setError(err instanceof Error ? err.message : 'Something went wrong')` |
| `catch (err) { toast.error('Save failed') }` | `` toast.error(`Save failed: ${err.message}`) `` |
| `catch (err) { setMessage({ type: 'error', text: 'Internal error' }) }` | `setMessage({ type: 'error', text: err.message })` |

Surface-function detection is name-pattern-based and scoped to avoid false positives:

- Identifier callees matching `/^(set|show|display|report|notify|flash)[A-Z]/` AND containing an error-like word (`error|warning|message|failure|fault|fail|alert|issue|notice|problem`). So `setError` / `setMessage` / `setSaveMessage` / `showWarning` / `reportFailure` match; `setState` / `setUser` / `setLoading` don't.
- Standalone `toastError`, `flashMessage` etc.
- `alert(…)` browser builtin.
- MemberExpression `<obj>.error` / `.warn` / `.warning` / `.fail` / `.failure` (e.g. `toast.error`, `notify.warn`). `console.error` is excluded — `no-swallowing-catch` owns that.

Allowed forms:

```js
// Direct err reference
catch (err) { setError(err.message) }

// Ternary with fallback
catch (err) { setError(err instanceof Error ? err.message : 'Failed') }

// Template literal interpolation
catch (err) { toast.error(`Save failed: ${err.message}`) }

// Object carrying err-derived text
catch (err) { setMessage({ type: 'error', text: err.message }) }

// Local alias the rule follows
catch (err) {
  const msg = err instanceof Error ? err.message : 'Unknown'
  setError(msg)
}
```

### `no-if-res-ok-no-else`

Flags `if (<var>.ok) { … }` statements with no else branch. The consequent handles the success path; without an else the non-OK response silently falls through.

| Pattern | Fix |
|---|---|
| `if (res.ok) { setItems(await res.json()) }` | add an else that throws, or flip to guard-first |
| `if (res.ok) return res.json()` | same — implicit return undefined on !ok |

Allowed forms:

```js
// Idiomatic: guard-first, then success path falls through
if (!res.ok) throw new Error(`Failed: ${res.status}`)
const data = await res.json()

// Explicit else
if (res.ok) {
  const data = await res.json()
  setItems(data)
} else {
  throw new Error(`Failed: ${res.status}`)
}
```

Scope (v1): only positive tests `if (<ident>.ok)` on a simple MemberExpression. Negated form (`if (!res.ok) throw …`) is the idiomatic guard and is not flagged. Compound tests (`if (res.ok && …)`) and call-result tests (`if (getRes().ok)`) are out of scope.

## Development

```bash
npm install
npm test
```

Rules are plain Node.js AST rules (no TS compile step). Tests use ESLint's `RuleTester` under Node's built-in `node:test` runner.

## Versioning & publish

Tag `v<semver>` to trigger the publish workflow. GitHub Actions runs the test suite and publishes to GitHub Packages.
