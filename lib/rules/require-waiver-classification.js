/**
 * require-waiver-classification
 *
 * A fail-fast waiver must CLASSIFY the swallow it permits, not reassure the
 * reader about it. This rule checks that an `eslint-disable*` comment targeting
 * a `@zantha-ltd/fail-fast/*` rule carries a justification that names which of
 * three things the swallow is:
 *
 *   (a) NOT A FAILURE            — a platform fact or an expected branch
 *   (b) RECOVERABLE TRANSIENT    — a NAMED condition something recovers from
 *   (c) BOUNDED DEGRADATION      — a real, unrecoverable failure whose blast
 *                                  radius and surfacing channel are both named
 *
 * ── WHAT THIS RULE DOES *NOT* DO, stated first because the gap is the point ──
 * It checks that a CLAIM WAS MADE. It cannot check that the claim is TRUE.
 * Whether a (c) justification really names a blast radius and a real surfacing
 * channel is a human review question, and this rule does not pretend otherwise.
 * Its whole value is forcing the author to commit to a category — which is a
 * different act from writing something that sounds prudent, and is reviewable
 * in a way that prose alone is not.
 *
 * ── WHY IT DOES NOT MATCH ON "RESILIENCE" VOCABULARY ─────────────────────────
 * The obvious implementation is a blocklist: reject "must not abort", "keep
 * running", "non-fatal". That was tried on paper and rejected, because the
 * phrase is not the test. `fail-fast`'s own canonical best-effort example is
 * commented "must not block the response", and the published Hydrogen
 * deferred-data waiver reads "a failed footer query must not 500 the page".
 * A blocklist fires on both — the code we publish as the right answer — while
 * missing any author who simply avoids the words. False positives on good code
 * and false negatives on bad: strictly worse than no rule, because a gate that
 * flags correct code teaches contributors the enforcement is wrong.
 *
 * ── SHIPS OFF BY DEFAULT ─────────────────────────────────────────────────────
 * NOT in `recommended` or `flat/recommended`. Every existing waiver in the
 * estate predates this convention (65 in zantha-mcp, 43 in zantha-radio before
 * its sweep), so enabling it by default would fail every onboarded repo on the
 * day it published. Repos opt in when they are ready to migrate, exactly as
 * `require-envelope-check` stays inert until a repo registers its clients.
 *
 *   "@zantha-ltd/fail-fast/require-waiver-classification": "error"
 *
 * ── KNOWN GAP ────────────────────────────────────────────────────────────────
 * A BLANKET `/* eslint-disable *\/` with no rule list disables everything,
 * including the fail-fast rules, and carries no rule names for this to match on
 * — so it passes silently. That is a different problem with a different fix
 * (`eslint-comments/no-unlimited-disable`) and is not papered over here.
 *
 * Waiver-count CREEP is covered separately and already fleet-wide by the
 * ratchet step in Zantha-Ltd/.github fail-fast-lint.yml. That counts; this
 * classifies. Neither substitutes for the other.
 */

// eslint-disable* forms. The rule list and the justification are split on the
// ` -- ` separator by INDEX, not by regex alternation: rule names are full of
// hyphens (`no-swallowing-catch`), so any pattern that treats `-` as a boundary
// truncates the rule list and the fail-fast match silently stops firing. Caught
// by running it.
const DISABLE_RE = /^\s*eslint-disable(?:-next-line|-line)?\s+([\s\S]*)$/
const SEPARATOR_RE = /\s--(?:\s|$)/

// A class marker: (a) / (b) / (c), or the spelled-out forms. Deliberately
// permissive about surrounding prose — the marker is the checkable part, the
// sentence around it is the author's to write.
const CLASS_MARKER_RE = /\((?:a|b|c)\)|\b(?:not[- ]a[- ]failure|recoverable[- ]transient|bounded[- ]degradation)\b/i

const FAIL_FAST_RULE_RE = /@zantha-ltd\/fail-fast\//

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require a fail-fast waiver to classify the swallow it permits — (a) not a failure, (b) named recoverable transient, or (c) bounded degradation.',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      missingJustification:
        'This waiver disables {{rules}} with no justification at all. Add one after " -- " naming which this is: (a) not a failure, (b) a named recoverable transient, or (c) bounded degradation naming both the blast radius and the channel the error still surfaces on.',
      missingClassification:
        'This waiver justifies disabling {{rules}} without CLASSIFYING it. Name the category: (a) not a failure — a platform fact or expected branch; (b) a named recoverable transient — say which condition; (c) bounded degradation — name both the blast radius and the channel the error still surfaces on. "Resilience", "must not abort" and "keep running" describe an intention, not a category, and a swallow that names no radius and no channel does not tolerate a failure, it erases it.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode()

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          const match = DISABLE_RE.exec(comment.value)
          if (!match) continue

          const rest = match[1]
          const sepIndex = rest.search(SEPARATOR_RE)
          const ruleList = sepIndex === -1 ? rest : rest.slice(0, sepIndex)
          if (!FAIL_FAST_RULE_RE.test(ruleList)) continue

          const rules = ruleList.trim()
          const justification =
            sepIndex === -1 ? '' : rest.slice(sepIndex).replace(SEPARATOR_RE, '').trim()

          if (justification === '') {
            context.report({ node: comment, messageId: 'missingJustification', data: { rules } })
            continue
          }

          if (!CLASS_MARKER_RE.test(justification)) {
            context.report({ node: comment, messageId: 'missingClassification', data: { rules } })
          }
        }
      },
    }
  },
}
