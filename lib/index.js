/**
 * @zantha/eslint-plugin-fail-fast
 *
 * Rules that enforce the fail-fast error-handling principle — errors must be
 * visible, never swallowed, masked, or silently converted to null/empty/false.
 *
 * See the fail-fast-coding skill on zantha-roles for the full anti-pattern
 * catalogue this plugin is growing towards.
 */

const noSwallowingCatch = require('./rules/no-swallowing-catch')

module.exports = {
  rules: {
    'no-swallowing-catch': noSwallowingCatch,
  },
  configs: {
    recommended: {
      plugins: ['@zantha/fail-fast'],
      rules: {
        '@zantha/fail-fast/no-swallowing-catch': 'error',
      },
    },
  },
}
