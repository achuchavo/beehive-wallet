import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Last line of defence: a render error anywhere below this leaves a usable
 * screen instead of a blank page.
 *
 * A wallet that goes white is worse than one that shows an error, because the
 * user cannot tell whether their funds are affected. The recovery screen says
 * explicitly that they are not - wallets live in encrypted local storage and a
 * UI crash cannot touch them.
 *
 * The error message is NOT rendered. It can contain arbitrary values from
 * whatever threw, and this component sits above screens that handle seed
 * phrases; printing it is a needless way to put one on screen.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console only, and only in development. Shipping the stack to any remote
    // collector would be a way for wallet state to leave the device.
    if (import.meta.env.DEV) {
      console.error('Render error:', error, info.componentStack)
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">
          The app hit an unexpected error and stopped rendering this screen.
        </p>
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Your wallets are unaffected. They are stored encrypted on this device and are not
          touched by a display problem.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
        >
          Reload the app
        </button>
      </div>
    )
  }
}
