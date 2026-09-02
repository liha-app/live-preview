import { useState } from 'react';
import { Modal } from './Dialogs.js';
import { useT } from '../i18n/index.js';
import { dismissForever, type AccountState } from '../lib/account.js';

/**
 * The offer to keep what you have made.
 *
 * Shown after somebody has done something rather than on arrival: before that
 * there is nothing to keep, and asking would be asking for its own sake.
 *
 * "Don't ask again" is honoured permanently, which is why signing in also has a
 * permanent home elsewhere — a dismissed prompt must not be the only door.
 */
export function AccountModal({ account, onClose }: { account: AccountState; onClose(): void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={t('account.title')} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        {t('account.why', {
          anonymous: String(account.retentionDays.anonymous),
          signedIn: String(account.retentionDays.signedIn),
        })}
      </p>

      <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
        <li>{t('account.benefitList')}</li>
        <li>{t('account.benefitActivity')}</li>
        <li>{t('account.benefitDevices')}</li>
      </ul>

      <div className="modal__actions" style={{ justifyContent: 'space-between' }}>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => {
            dismissForever();
            onClose();
          }}
        >
          {t('account.never')}
        </button>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            {t('account.later')}
          </button>
          <a
            className="btn btn--primary"
            href={account.signInHref(window.location.href)}
            onClick={() => setBusy(true)}
            aria-disabled={busy}
          >
            {t('me.signIn')}
          </a>
        </div>
      </div>
    </Modal>
  );
}
