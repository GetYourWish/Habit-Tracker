// Theme — visual parity with the desktop app (desktop/src/index.css).
// The desktop theme is an "aurora glass" design over a plain --bg-primary
// body; these constants mirror its CSS variables so both apps look like one
// product. Android-native behaviors (Material ripples, elevation,
// edge-to-edge) are layered on top — native UX, familiar skin.
//
// v1.0.11: the background is a SINGLE SOLID COLOR per theme (bgCanvas) —
// the aurora gradient + blobs were replaced by the user's request ("solid
// whole color following current theme"); light keeps the desktop canvas
// tint (#EEF2FF, indigo-50), dark keeps the deep-canvas navy (#0B0D12).

// v1.0.11: CANVAS (gradient stops) and AURORA (blob list) were removed —
// the background is now the single solid bgCanvas color on every theme.

// flowState / flowStatePressed are REQUIRED on every theme object: the FAB,
// filled buttons, text buttons and the Switch track all read them. They were
// missing until v1.0.7, which made every one of those controls render with an
// UNDEFINED color — the FAB had no background pill, filled buttons were
// transparent with white labels (invisible), and text buttons fell back to the
// system default (near-black — unreadable on the dark theme). That was the
// remote-reported "the text doesnt look well enough".
export const LIGHT = {
  dark: false,
  bgPrimary: '#ffffff',
  bgSecondary: '#f5f5f5',
  bgTertiary: '#e8e8e8',
  textPrimary: '#1a1a1a',
  textSecondary: '#666666',
  textMuted: '#999999',
  border: '#e0e0e0',
  glassBg: 'rgba(255,255,255,0.78)',
  surface: '#FFFFFF',
  glassBorder: 'rgba(255,255,255,0.6)',
  rowFill: 'rgba(15,23,42,0.04)',
  rowFillSelected: 'rgba(15,23,42,0.10)',
  ripple: 'rgba(15,23,42,0.12)',
  scrim: 'rgba(15,23,42,0.45)',
  shadow: '#0f172a',
  // solid app background (v1.0.11) — desktop light canvas tint
  bgCanvas: '#EEF2FF',
  // violet-600 family — readable on white surfaces
  flowState: '#7c3aed',
  flowStatePressed: '#6d28d9',
  danger: '#dc2626'
}

export const DARK = {
  dark: true,
  bgPrimary: '#1a1a1a',
  bgSecondary: '#2a2a2a',
  bgTertiary: '#3a3a3a',
  textPrimary: '#f0f0f0',
  textSecondary: '#b0b0b0',
  textMuted: '#707070',
  border: '#3a3a3a',
  glassBg: 'rgba(17,20,28,0.88)',
  surface: '#171B24',
  glassBorder: 'rgba(255,255,255,0.08)',
  rowFill: 'rgba(255,255,255,0.04)',
  rowFillSelected: 'rgba(255,255,255,0.10)',
  ripple: 'rgba(255,255,255,0.10)',
  scrim: 'rgba(0,0,0,0.60)',
  shadow: '#000000',
  // solid app background (v1.0.11) — desktop deep canvas navy
  bgCanvas: '#0B0D12',
  // violet-500 family — pops on dark surfaces
  flowState: '#8b5cf6',
  flowStatePressed: '#7c3aed',
  danger: '#ef4444'
}

// Shared accents (theme-independent, same values as desktop)
export const ACCENTS = {
  flowState: '#8b5cf6', // settings.flowStateColor default — working-on highlight
  danger: '#dc2626',
  success: '#4ade80',
  warning: '#fbbf24'
}

// Shared type scale — one place so every screen renders text with the same
// voice (sizes are dp, mirroring the desktop CSS px values 1:1).
export const TYPE = {
  appTitle: { fontSize: 20, fontWeight: '700', letterSpacing: 0.15 },
  appSubtitle: { fontSize: 12, fontWeight: '400', letterSpacing: 0.3 },
  sectionTitle: { fontSize: 11.5, fontWeight: '700', letterSpacing: 1.0 },
  cardTitle: { fontSize: 16, fontWeight: '600', letterSpacing: 0.1 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  secondary: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  caption: { fontSize: 12.5, fontWeight: '400', lineHeight: 17 },
  button: { fontSize: 14.5, fontWeight: '600', letterSpacing: 0.2 },
  score: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 }
}

// Desktop component CSS is scaled 1:1 (px) — RN density-independent pixels
// match CSS px on Android, so radii/paddings transfer directly.
export const RADIUS = { sm: 6, md: 8, lg: 12, xl: 20, fab: 16, sheet: 28 }

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }

export function buildTheme(preference, systemScheme) {
  // preference: 'system' | 'light' | 'dark' (settings.theme; default 'system')
  const resolved =
    preference === 'light' || preference === 'dark'
      ? preference
      : (systemScheme === 'dark' ? 'dark' : 'light')
  const base = resolved === 'dark' ? DARK : LIGHT
  return { ...base, resolved }
}

// Guard used by tests: every control color the UI kit reads must exist on
// every theme object (the missing-flowState bug shipped invisible buttons).
export function themeColorGuard(theme) {
  const required = [
    'flowState',
    'flowStatePressed',
    'textPrimary',
    'textSecondary',
    'textMuted',
    'bgPrimary',
    'bgCanvas',
    'surface',
    'bgSecondary',
    'border',
    'ripple',
    'scrim'
  ]
  const missing = required.filter(k => typeof theme[k] !== 'string' || theme[k].length === 0)
  return { ok: missing.length === 0, missing }
}
