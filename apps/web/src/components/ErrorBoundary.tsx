import { Component, type ErrorInfo, type ReactNode } from 'react';
import { en } from '../i18n/en.js';
import { ja } from '../i18n/ja.js';
import { readLocale } from '../i18n/index.js';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A rendering crash should not leave a blank page.
 *
 * Reviewers reach this app through a link someone sent them; if something
 * throws, they need to know what happened and how to get out, not a white
 * screen with no explanation.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The single place to wire up an error reporter in a real deployment.
    console.error('[liha] render error', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    // The provider may be the thing that failed, so read the locale directly
    // rather than through context.
    const t = readLocale() === 'ja' ? ja : en;

    return (
      <div className="center-pane">
        <div className="stack" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>{t['error.title']}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {t['error.body']}
          </p>
          <pre className="snippet" style={{ textAlign: 'left', whiteSpace: 'pre-wrap' }}>
            {error.message}
          </pre>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => window.location.reload()}
            >
              {t['error.reload']}
            </button>
            <a className="btn" href="/">
              {t['error.startOver']}
            </a>
          </div>
        </div>
      </div>
    );
  }
}
