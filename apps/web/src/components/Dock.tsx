import {
  ArrowUpRight,
  MapPin,
  Maximize,
  Monitor,
  MousePointer2,
  Pen,
  Smartphone,
  Square,
  Tablet,
  type LucideIcon,
} from 'lucide-react';
import { VIEWPORTS, type ViewportId } from './PreviewStage.js';
import type { Tool } from './AnnotationLayer.js';
import { useT } from '../i18n/index.js';
import type { MessageKey } from '../i18n/en.js';

const TOOLS: { id: Tool; label: MessageKey; hint: MessageKey; Icon: LucideIcon }[] = [
  { id: 'cursor', label: 'tool.inspect', hint: 'tool.inspect.hint', Icon: MousePointer2 },
  { id: 'pin', label: 'tool.pin', hint: 'tool.pin.hint', Icon: MapPin },
  { id: 'rect', label: 'tool.rect', hint: 'tool.rect.hint', Icon: Square },
  { id: 'freehand', label: 'tool.freehand', hint: 'tool.freehand.hint', Icon: Pen },
  { id: 'arrow', label: 'tool.arrow', hint: 'tool.arrow.hint', Icon: ArrowUpRight },
];

const VIEWPORT_ICONS: Record<ViewportId, LucideIcon> = {
  fit: Maximize,
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

interface Props {
  tool: Tool;
  viewportId: ViewportId;
  showViewports: boolean;
  onToolChange(tool: Tool): void;
  onViewportChange(viewport: ViewportId): void;
}

/** The only control surface over the artifact: one floating toolbar, bottom centre. */
export function Dock({ tool, viewportId, showViewports, onToolChange, onViewportChange }: Props) {
  const t = useT();

  return (
    <div className="dock">
      {TOOLS.map(({ id, label, hint, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={tool === id}
          aria-label={t(label)}
          title={`${t(label)} — ${t(hint)}`}
          onClick={() => onToolChange(id)}
        >
          <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ))}

      {showViewports && (
        <>
          <span className="dock__divider" aria-hidden="true" />
          {VIEWPORTS.map((viewport) => {
            const Icon = VIEWPORT_ICONS[viewport.id];
            const label = viewport.width
              ? t('viewport.width', { width: viewport.width })
              : t('viewport.fit');
            return (
              <button
                key={viewport.id}
                type="button"
                aria-pressed={viewportId === viewport.id}
                aria-label={label}
                title={label}
                onClick={() => onViewportChange(viewport.id)}
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
