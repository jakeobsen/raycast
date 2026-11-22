// @raycast/eslint-config@2.1.1 exports a nested array (the `raycast.configs.recommended`
// entry is itself an array that isn't spread upstream). ESLint 9's flat config validator
// rejects nested arrays, so we flatten one level here.
module.exports = require("@raycast/eslint-config").flat();
