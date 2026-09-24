// Text sanitization shared by every client.

// Sanitize text input - prevent XSS and limit length
function sanitizeInput(text, maxLength = 500) {
  if (!text) return ''
  const trimmed = text.trim().slice(0, maxLength)
  // Basic XSS prevention - escape HTML entities
  return trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

module.exports = { sanitizeInput }
