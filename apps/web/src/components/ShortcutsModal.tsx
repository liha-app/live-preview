import { Modal } from './Dialogs.js';
import { useT } from '../i18n/index.js';
import type { MessageKey } from '../i18n/en.js';

const GROUPS: { title: MessageKey; items: [string, MessageKey][] }[] = [
  {
    title: 'shortcuts.tools',
    items: [
      ['V', 'tool.inspect.hint'],
      ['P', 'tool.pin'],
      ['R', 'tool.rect'],
      ['D', 'tool.freehand'],
      ['A', 'tool.arrow'],
    ],
  },
  {
    title: 'shortcuts.comments',
    items: [
      ['C', 'shortcuts.startComment'],
      ['⌘ ↵', 'shortcuts.submit'],
      ['J / K', 'shortcuts.nextPrev'],
      ['E', 'shortcuts.resolve'],
      ['Esc', 'shortcuts.escape'],
    ],
  },
  {
    title: 'shortcuts.view',
    items: [
      ['1 – 4', 'shortcuts.viewports'],
      ['T', 'shortcuts.theme'],
      ['?', 'shortcuts.thisList'],
    ],
  },
];

export function ShortcutsModal({ onClose }: { onClose(): void }) {
  const t = useT();

  return (
    <Modal title={t('shortcuts.title')} onClose={onClose}>
      <div className="shortcuts">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h4>{t(group.title)}</h4>
            <dl>
              {group.items.map(([keys, description]) => (
                <div key={keys}>
                  <dt>
                    <kbd>{keys}</kbd>
                  </dt>
                  <dd>{t(description)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="modal__actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
