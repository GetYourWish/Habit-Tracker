import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ErrorBoundary from '../components/ErrorBoundary'

afterEach(cleanup)

// The original crash: the fallback's <pre style="background: ..."> passed a
// raw CSS string as the style prop -> React #62 while handling the error,
// which unmounted the whole app. The fallback must render cleanly and
// surface the original error instead.

function Bomb({ message }) {
  throw new Error(message)
}

describe('ErrorBoundary fallback (React #62 regression)', () => {
  it('renders the fallback with the original error message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Bomb message="Simulated underlying app crash" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Simulated underlying app crash')).toBeInTheDocument()
    expect(screen.getByText('Reload Application')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('fallback <pre> never crashes with React #62 while handling an error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <ErrorBoundary>
        <Bomb message="boom" />
      </ErrorBoundary>
    )
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    // The error message paragraph shows the exact original message
    expect(screen.getByText('boom')).toBeInTheDocument()
    spy.mockRestore()
  })
})
