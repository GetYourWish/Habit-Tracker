import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    // Optionally reload the app or navigate home
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p className="error-message">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <pre style={{
            background: 'rgba(255,255,255,0.06)',
            padding: '12px',
            borderRadius: '8px',
            fontSize: '11px',
            color: '#f87171',
            overflow: 'auto',
            maxHeight: '300px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            marginTop: '12px',
            textAlign: 'left'
          }}>
            {this.state.error?.stack || 'No stack trace available'}
          </pre>
          <button onClick={this.handleReset} className="reset-btn">
            Reload Application
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
