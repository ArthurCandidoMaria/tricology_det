import { useEffect, useState } from 'react';
import { Columns2, Eye, Layers, Ruler, ScanEye, Sparkles, X } from 'lucide-react';
import { formatNumber, formatThickness } from '@/lib/formatters';

export interface InspectablePhoto {
  title: string;
  subtitle?: string;
  originalUrl?: string | null;
  annotatedUrl?: string | null;
  hairMaskUrl?: string | null;
  scalpMaskUrl?: string | null;
  bulbCount?: number | null;
  strandCount?: number | null;
  avgThicknessPx?: number | null;
  hairCoveragePct?: number | null;
  grayThreshold?: number | null;
}

type LayerMode = 'combined' | 'hair-mask' | 'scalp-mask' | 'original' | 'compare';

interface Props {
  photo: InspectablePhoto;
  onClose: () => void;
}

export function PhotoAnalysisModal({ photo, onClose }: Props) {
  const hasHairMask = Boolean(photo.hairMaskUrl);
  const hasScalpMask = Boolean(photo.scalpMaskUrl);
  const hasSeparatedMasks = hasHairMask || hasScalpMask;
  const hasDistinctOriginal = Boolean(photo.originalUrl && photo.originalUrl !== photo.annotatedUrl);

  const [mode, setMode] = useState<LayerMode>('combined');

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const activeImageUrl =
    mode === 'hair-mask'
      ? photo.hairMaskUrl || photo.annotatedUrl || photo.originalUrl || ''
      : mode === 'scalp-mask'
        ? photo.scalpMaskUrl || photo.originalUrl || photo.annotatedUrl || ''
        : mode === 'original'
          ? photo.originalUrl || photo.annotatedUrl || ''
          : photo.annotatedUrl || photo.originalUrl || '';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/80 backdrop-blur-sm p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + Layer Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-bold text-ink-900 truncate">{photo.title}</h2>
            {photo.subtitle && <p className="text-xs text-ink-400">{photo.subtitle}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <LayerButton
              active={mode === 'combined'}
              onClick={() => setMode('combined')}
              icon={<ScanEye size={14} />}
              label="Bulbos + Fios"
            />
            {hasHairMask && (
              <LayerButton
                active={mode === 'hair-mask'}
                onClick={() => setMode('hair-mask')}
                icon={<Sparkles size={14} />}
                label="Máscara de Fios"
              />
            )}
            {hasScalpMask && (
              <LayerButton
                active={mode === 'scalp-mask'}
                onClick={() => setMode('scalp-mask')}
                icon={<Layers size={14} />}
                label="Couro Cabeludo"
              />
            )}
            {hasDistinctOriginal && (
              <LayerButton
                active={mode === 'original'}
                onClick={() => setMode('original')}
                icon={<Eye size={14} />}
                label="Original"
              />
            )}
            {hasSeparatedMasks && (
              <LayerButton
                active={mode === 'compare'}
                onClick={() => setMode('compare')}
                icon={<Columns2 size={14} />}
                label="Comparar"
              />
            )}

            <button
              type="button"
              onClick={onClose}
              className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-xl text-ink-500 hover:bg-ink-100 hover:text-ink-900 transition-colors"
              aria-label="Fechar visualização"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Image viewport */}
        <div className="flex-1 overflow-y-auto bg-ink-950 p-3 sm:p-4">
          {mode === 'compare' && hasSeparatedMasks ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CompareTile
                title="Detecção combinada (Bulbos + Fios)"
                url={photo.annotatedUrl || photo.originalUrl || ''}
              />
              <CompareTile
                title="Máscara de fios (Grayscale)"
                url={photo.hairMaskUrl || ''}
              />
              <CompareTile
                title="Máscara do couro cabeludo"
                url={photo.scalpMaskUrl || ''}
              />
              <CompareTile
                title="Imagem original"
                url={photo.originalUrl || photo.annotatedUrl || ''}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <img
                src={activeImageUrl}
                alt={photo.title}
                className="max-h-[64vh] w-full object-contain rounded-lg"
              />
            </div>
          )}
        </div>

        {/* Metrics Footer */}
        <div className="border-t border-ink-100 bg-ink-50/70 px-5 py-3.5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricPill
              label="Bulbos (Origem/Tracking)"
              value={photo.bulbCount != null ? formatNumber(photo.bulbCount) : '—'}
              tone="rose"
            />
            <MetricPill
              label="Fios detectados"
              value={photo.strandCount != null ? formatNumber(photo.strandCount) : '—'}
              tone="teal"
            />
            <MetricPill
              label="Espessura média"
              value={formatThickness(photo.avgThicknessPx)}
              icon={<Ruler size={13} />}
              tone="brand"
            />
            <MetricPill
              label="Cobertura / Limiar"
              value={
                photo.hairCoveragePct != null
                  ? `${formatNumber(photo.hairCoveragePct, 1)}%${photo.grayThreshold != null ? ` · ≤ ${Math.round(photo.grayThreshold)}` : ''}`
                  : '—'
              }
              tone="neutral"
            />
          </div>
          {!hasSeparatedMasks && (
            <p className="mt-2.5 text-xs text-ink-400">
              Imagem registrada antes da segmentação em escala de cinza. Novas análises exibem as máscaras separadas de fios e couro cabeludo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function LayerButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
        active
          ? 'bg-brand-500 text-white shadow-soft'
          : 'bg-ink-100/80 text-ink-600 hover:bg-ink-200/70 hover:text-ink-900'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function CompareTile({ title, url }: { title: string; url: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-900">
      <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-ink-200">{title}</div>
      {url ? (
        <img src={url} alt={title} className="aspect-[4/3] w-full object-contain bg-ink-950" />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center text-xs text-ink-400">Indisponível</div>
      )}
    </div>
  );
}

function MetricPill({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone: 'rose' | 'teal' | 'brand' | 'neutral';
}) {
  const toneClass = {
    rose: 'text-rose-600',
    teal: 'text-teal-700',
    brand: 'text-brand-700',
    neutral: 'text-ink-800',
  }[tone];

  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3.5 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className={`font-display text-base font-bold mt-0.5 ${toneClass}`}>{value}</p>
    </div>
  );
}
