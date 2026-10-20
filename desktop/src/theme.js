import { useEffect } from 'react'

// Theme application — single home for the DOM side of theming.
//
// Two sources, in priority order:
//  1. data.settings.theme — the user's choice as saved in habit.json, which
//     SYNCS between devices (this is what the mobile app reads). A desktop
//     install on a new machine, or one whose localStorage was cleared, now
//     starts in the theme the user actually picked, and follows a theme
//     change made on the phone after the next sync.
//  2. localStorage 'pt-theme' — the pre-paint cache read by the inline
//     script in index.html so the first frame is already correct. We keep
//     writing it so the next launch's flash-free boot stays in theme.
//
// 'system' is live: the OS-level color scheme is watched while the app is
// open, so flipping the OS theme repaints the app without a restart
// (parity with mobile, where useColorScheme is reactive).

const STORAGE_KEY = 'pt-theme'

export function applyTheme(theme) {
  try {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else if (theme === 'light') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      // 'system' — resolve now; live updates handled by useAppTheme
      const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      if (sysDark) document.documentElement.setAttribute('data-theme', 'dark')
      else document.documentElement.removeAttribute('data-theme')
    }
    localStorage.setItem(STORAGE_KEY, theme)
  } catch (e) { /* non-fatal */ }
}

export function readStoredTheme() {
  try { return localStorage.getItem(STORAGE_KEY) || 'system' } catch (e) { return 'system' }
}

// Applies `preference` (undefined → the localStorage cache) and, while it
// resolves to 'system', follows OS dark/light switches in real time.
export function useAppTheme(preference) {
  useEffect(() => {
    const pref = preference || readStoredTheme()
    applyTheme(pref)
    if (pref !== 'system' || typeof window.matchMedia !== 'function') return undefined

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    // addEventListener (standard) with addListener fallback (older Chromium)
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    if (typeof mq.addListener === 'function') {
      mq.addListener(onChange)
      return () => mq.removeListener(onChange)
    }
    return undefined
  }, [preference])
}
