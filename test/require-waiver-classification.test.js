/**
 * Suite for require-waiver-classification. Run with: npm test
 *
 * The valid cases below deliberately include the estate's REAL published
 * waivers (from the fail-fast skill's references/disable-patterns.md), because
 * the design failure this rule was built to avoid is a gate that fires on the
 * code we publish as the right answer.
 *
 * ── WHY THIS ONE USES `Linter` AND NOT `RuleTester` LIKE ITS SIBLINGS ────────
 * Every fixture here contains a real `eslint-disable` directive naming a
 * `@zantha-ltd/fail-fast/*` rule — that is the input this rule exists to read.
 * RuleTester registers only the rule under test, so ESLint resolves those names
 * against nothing and emits "Definition for rule ... was not found", which lands
 * as an error on every VALID case and fails the suite for a reason that has
 * nothing to do with the rule. `Linter` lets the referenced rule names be
 * defined, so the directives resolve and the only findings are this rule's own.
 * The house pattern is right for rules that read CODE; a rule that reads
 * DIRECTIVES needs the directives to be real.
 */

const { Linter } = require('eslint')
const { test } = require('node:test')
const assert = require('node:assert')

const rule = require('../lib/rules/require-waiver-classification')

const RULE = 'zantha-fail-fast/require-waiver-classification'

// The rule names our fixtures disable. Defined as no-ops purely so ESLint can
// resolve the directives; none of them ever reports.
const REFERENCED = [
  '@zantha-ltd/fail-fast/no-swallowing-catch',
  '@zantha-ltd/fail-fast/no-error-to-null',
  '@zantha-ltd/fail-fast/no-context-stripping',
]

const linter = new Linter()
linter.defineRule(RULE, rule)
for (const name of REFERENCED) {
  linter.defineRule(name, { meta: { schema: [] }, create: () => ({}) })
}

const CONFIG = {
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: { [RULE]: 'error' },
}

function findings(code) {
  return linter.verify(code, CONFIG).filter(m => m.ruleId === RULE)
}

function run({ valid, invalid }) {
  for (const c of valid) {
    const got = findings(c.code)
    assert.deepStrictEqual(
      got.map(m => m.messageId),
      [],
      `VALID case reported when it should not have — "${c.name}": ${JSON.stringify(got.map(m => m.message))}`,
    )
  }
  for (const c of invalid) {
    const got = findings(c.code)
    assert.deepStrictEqual(
      got.map(m => m.messageId),
      c.errors.map(e => e.messageId),
      `INVALID case did not report as expected — "${c.name}"`,
    )
  }
}

test('require-waiver-classification', () => {
  run({
    valid: [
      {
        name: 'class (a) marker',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-swallowing-catch -- (a) localStorage throws in private-mode browsers; not a fault
          try { read() } catch { }
        `,
      },
      {
        name: 'class (b) marker naming the condition',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-swallowing-catch -- (b) ECONNRESET only; attempts 1..N-1 of a retry that rethrows on the last
          try { read() } catch { }
        `,
      },
      {
        name: 'REAL published exemplar — Hydrogen deferred footer, classified (c)',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-error-to-null -- (c) Hydrogen deferred-data idiom: a failed footer query must not 500 the page. Error is console-logged for ops; footer degrades to empty.
          const footer = null
        `,
      },
      {
        name: 'REAL published exemplar — multi-rule disable with hyphenated rule names',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-swallowing-catch, @zantha-ltd/fail-fast/no-error-to-null -- (a) localStorage read can throw in private-mode browsers; a null return falls through to the network-fetched user
          const cached = null
        `,
      },
      {
        name: 'spelled-out class, no parenthesised marker',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-swallowing-catch -- not-a-failure: the optional config file is simply absent
          try { read() } catch { }
        `,
      },
      {
        name: 'bounded degradation spelled out',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-error-to-null -- bounded degradation: radius is this card's sparkline only, error goes to the metrics channel
          const spark = null
        `,
      },
      {
        name: 'block-form eslint-disable with a classified justification',
        code: `
          /* eslint-disable @zantha-ltd/fail-fast/no-swallowing-catch -- (a) platform fact: /proc is absent off Linux */
          try { read() } catch { }
        `,
      },
      {
        name: 'a NON-fail-fast disable is none of this rule’s business',
        code: `
          // eslint-disable-next-line no-console
          console.log('fine')
        `,
      },
      {
        name: 'unjustified disable of an unrelated rule is still not ours',
        code: `
          // eslint-disable-next-line no-unused-vars
          const x = 1
        `,
      },
      {
        name: 'no disable comments at all',
        code: `const x = 1`,
      },
      {
        name: 'KNOWN GAP, asserted so it is a decision and not a surprise: a blanket disable carries no rule list and passes',
        code: `
          /* eslint-disable */
          try { read() } catch { }
        `,
      },
    ],

    invalid: [
      {
        name: 'no justification at all',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-swallowing-catch
          try { read() } catch { }
        `,
        errors: [{ messageId: 'missingJustification' }],
      },
      {
        name: 'THE CANONICAL POISON — resilience language, no classification',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-swallowing-catch -- must not abort the loop
          try { read() } catch { }
        `,
        errors: [{ messageId: 'missingClassification' }],
      },
      {
        name: 'plausible but unclassified — the dark-radio shape',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-swallowing-catch -- the stream can drop, so we reconnect and keep running
          try { read() } catch { }
        `,
        errors: [{ messageId: 'missingClassification' }],
      },
      {
        name: 'explains what might go wrong rather than which category it is',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-error-to-null -- the upstream API is flaky and sometimes 500s
          const v = null
        `,
        errors: [{ messageId: 'missingClassification' }],
      },
      {
        name: 'separator present but justification empty',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-swallowing-catch --
          try { read() } catch { }
        `,
        errors: [{ messageId: 'missingJustification' }],
      },
      {
        name: 'multi-rule disable, hyphenated names, unclassified — proves the rule list is parsed whole',
        code: `
          // eslint-disable-next-line @zantha-ltd/fail-fast/no-swallowing-catch, @zantha-ltd/fail-fast/no-context-stripping -- non-fatal, we log it
          try { read() } catch { }
        `,
        errors: [{ messageId: 'missingClassification' }],
      },
    ],
  })
})
