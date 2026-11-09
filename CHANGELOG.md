# Changelog

## 2.0.0

### Breaking

- `no-swallowing-catch`: a catch that logs the error with `console.*` and then only bumps a counter (`n++`, `n += 1`), sets a flag on a variable or `this` (`ok = false`), or exits with `continue`, `break`, a bare `return` or `return null` / `return undefined` now fails with `loggedThenDropped`. Before 2.0.0 the rule flagged a logged error only when the log was the whole catch body, so any second statement let it pass. Several logging calls with nothing after them now fail with `onlyLogged` too. Unchanged: a log followed by a call (a recovery such as a redirect or sign-in), a throw, a return of a value, or a write to anything other than a local variable or `this` (for example `location.href`) passes. Kanban #3183.
