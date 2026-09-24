// ID generation — the ONLY implementation allowed in the monorepo.
// uuid v4 guarantees the identical format on every platform (Chromium,
// Electron main, Node, Hermes/RN with the random-byte polyfill).
const { v4: uuidv4 } = require('uuid')

function generateId() {
  return uuidv4()
}

module.exports = { generateId }
