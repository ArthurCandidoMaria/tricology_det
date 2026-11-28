import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Layers,
  Ruler,
  ScanEye,
  Sparkles,
  X,
} from 'lucide-react';
import { formatDate, formatDateLong, formatNumber, formatThickness } from '@/lib/formatters';
import { spreadLabel, type AreaSessionPoint, type AreaSummary } from '@/lib/areaStats';
import type { Patient, SessionPhoto } from '@/lib/types';
import { ProgressChart, type ChartPoint } from '@/components/ProgressChart';
import { TrendBadge } from '@/components/TrendBadge';
import { PhotoAnalysisModal, type InspectablePhoto } from '@/components/PhotoAnalysisModal';

interface Props {
  patient: Patient;
  area: AreaSummary;
  onBack: () => void;
}

type AreaChartMetric = 'bulbs' | 'strands' | 'thickness';

export function AreaDashboard({ patient, area, onBack }: Props) {
  const [metric, setMetric] = useState<AreaChartMetric>('bulbs');
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [inspected, setInspected] = useState<InspectablePhoto | null>(null);

  const bulbPoints: ChartPoint[] = area.points.map((p) => ({
    date: p.date,
    label: p.label,
    value: p.avg,
  }));

  const strandPoints: ChartPoint[] = area.points
    .filter((p) => p.avgStrands != null)
    .map((p) => ({ date: p.date, label: p.label, value: p.avgStrands! }));

  const thicknessPoints: ChartPoint[] = area.points
    .filter((p) => p.avgThicknessPx != null)
    .map((p) => ({ date: p.date, label: p.label, value: p.avgThicknessPx! }));

  const chartConfig =
    metric === 'strands'
      ? { points: strandPoints, unit: 'fios', decimals: 1, accent: 'teal' as const }
      : metric === 'thickness'
        ? { points: thicknessPoints, unit: 'px', decimals: 2, accent: 'sky' as const }
        : { points: bulbPoints, unit: 'bulbos', decimals: 0, accent: 'brand' as const };

  const lastPoint = area.points.length > 0 ? area.points[area.points.length - 1] : null;
  const openSession = area.points.find((p) => p.sessionId === openSessionId) ?? null;
  const sessionWord = area.sessionCount === 1 ? 'sessão' : 'sessões';

  function openInspector(photo: SessionPhoto, date: string) {
    setInspected({
      title: `${area.label} · ${formatDateLong(date)}`,
      subtitle: patient.name,
      originalUrl: photo.photo_url,
      annotatedUrl: photo.annotated_photo_url || photo.photo_url,
      hairMaskUrl: photo.hair_mask_url,
      scalpMaskUrl: photo.scalp_mask_url,
      bulbCount: photo.hair_count,
      strandCount: photo.strand_count,
      avgThicknessPx: photo.avg_thickness_px,
      hairCoveragePct: photo.hair_coverage_pct,
      grayThreshold: photo.gray_threshold,
    });
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <button onClick={onBack} className="btn-ghost mb-6 -ml-2">
        <ArrowLeft size={18} /> Voltar às regiões
      </button>

      <div className="card p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-50 to-teal-100 flex items-center justify-center flex-shrink-0">
            <Layers size={28} className="text-brand-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-ink-500">{patient.name}</p>
            <h1 className="font-display text-2xl font-bold text-ink-900 mt-0.5">Região {area.label}</h1>
            <p className="text-sm text-ink-500 mt-1">
              Evolução ao longo de {area.sessionCount} {sessionWord} · {area.photoCount}{' '}
              {area.photoCount === 1 ? 'imagem' : 'imagens'}.
            </p>
          </div>
          <div className="self-start">
            <TrendBadge
              delta={area.delta}
              deltaPct={area.deltaPct}
              hasComparison={area.hasComparison}
              size={16}
              showAbsolute
            />
          </div>
        </div>
      </div>

      {/* Indicadores desta área */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<Calendar size={16} />}
          label="Última sessão"
          value={lastPoint ? formatDate(lastPoint.date) : '—'}
          sublabel={lastPoint ? formatDateLong(lastPoint.date) : 'Sem sessões'}
        />
        <StatCard
          icon={<ScanEye size={16} className="text-rose-500" />}
          label="Bulbos (recente)"
          value={area.latest != null ? formatNumber(area.latest) : '—'}
          sublabel={
            lastPoint && lastPoint.countedPhotos > 1
              ? `média de ${lastPoint.countedPhotos} fotos`
              : 'origem/tracking de fios'
          }
        />
        <StatCard
          icon={<Sparkles size={16} className="text-teal-600" />}
          label="Fios detectados"
          value={area.latestStrands != null ? formatNumber(area.latestStrands, 1) : '—'}
          sublabel="segmentação grayscale"
        />
        <StatCard
          icon={<Ruler size={16} className="text-sky-600" />}
          label="Espessura média"
          value={formatThickness(area.latestThicknessPx)}
          sublabel="calibre médio em pixels"
        />
      </div>

      {/* Evolução ao longo das sessões */}
      <div className="card p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-bold text-ink-900">Evolução da região {area.label}</h2>
            <p className="text-sm text-ink-400">Alterne entre bulbos, fios detectados e espessura em pixels</p>
          </div>

          <div className="inline-flex rounded-xl bg-ink-100 p-1 self-start">
            <MetricTab active={metric === 'bulbs'} onClick={() => setMetric('bulbs')} label="Bulbos" />
            <MetricTab active={metric === 'strands'} onClick={() => setMetric('strands')} label="Fios" />
            <MetricTab active={metric === 'thickness'} onClick={() => setMetric('thickness')} label="Espessura (px)" />
          </div>
        </div>

        <ProgressChart
          points={chartConfig.points}
          unit={chartConfig.unit}
          decimals={chartConfig.decimals}
          accent={chartConfig.accent}
          emptyMessage="Registre sessões nesta região para visualizar a evolução."
        />
      </div>

      {/* Sessões desta área */}
      <div className="card p-6">
        <div className="mb-4">
          <h2 className="font-display text-lg font-bold text-ink-900">Sessões desta região</h2>
          <p className="text-sm text-ink-400">Clique numa sessão para inspecionar as imagens e máscaras</p>
        </div>

        {area.points.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-500">Nenhuma medição registrada nesta região.</p>
        ) : (
          <div className="grid gap-3">
            {[...area.points].reverse().map((point) => (
              <SessionRow
                key={point.sessionId}
                point={point}
                onOpen={() => {
                  if (point.photos.length === 1) {
                    openInspector(point.photos[0], point.date);
                  } else {
                    setOpenSessionId(point.sessionId);
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {openSession && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpenSessionId(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpenSessionId(null)}
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              aria-label="Fechar galeria"
            >
              <X size={18} />
            </button>
            <div className="border-b border-ink-100 px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ink-900">
                {area.label} · {formatDateLong(openSession.date)}
              </h2>
              <p className="text-sm text-ink-500">
                {openSession.photos.length} {openSession.photos.length === 1 ? 'imagem' : 'imagens'} — clique para abrir o visualizador de máscaras
              </p>
            </div>
            <div className="grid max-h-[75vh] grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3 lg:grid-cols-4">
              {openSession.photos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => openInspector(photo, openSession.date)}
                  className="overflow-hidden rounded-xl border border-ink-100 bg-ink-50 text-left hover:border-brand-300 transition-colors"
                >
                  <img
                    src={photo.annotated_photo_url || photo.photo_url}
                    alt={`${area.label} em ${formatDate(openSession.date)}`}
                    className="aspect-square w-full object-cover"
                  />
                  <div className="px-2.5 py-2 space-y-0.5">
                    <p className="text-xs font-semibold text-ink-700">
                      {photo.hair_count != null ? `${formatNumber(photo.hair_count)} bulbos` : '—'}
                    </p>
                    {photo.strand_count != null && (
                      <p className="text-[11px] text-teal-700 font-medium">
                        {formatNumber(photo.strand_count)} fios · {formatThickness(photo.avg_thickness_px)}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {inspected && <PhotoAnalysisModal photo={inspected} onClose={() => setInspected(null)} />}
    </div>
  );
}

function MetricTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
        active ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
      }`}
    >
      {label}
    </button>
  );
}

function SessionRow({ point, onOpen }: { point: AreaSessionPoint; onOpen: () => void }) {
  const spread = spreadLabel(point);
  const wideSpread = spread != null && point.min > 0 && (point.max - point.min) / point.min > 0.3;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-ink-100 p-4 text-left hover:border-brand-300 hover:shadow-card transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      <div className="flex items-center gap-4">
        <div className="grid grid-cols-3 gap-1.5 w-28 flex-shrink-0">
          {point.photos.slice(0, 3).map((photo) => (
            <img
              key={photo.id}
              src={photo.annotated_photo_url || photo.photo_url}
              alt=""
              className="aspect-square w-full rounded-lg object-cover bg-ink-100"
            />
          ))}
          {Array.from({ length: Math.max(0, 3 - point.photos.length) }).map((_, index) => (
            <div key={`empty-${index}`} className="aspect-square rounded-lg bg-ink-100" />
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{formatDateLong(point.date)}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className="font-display text-base font-bold text-ink-900">
              {formatNumber(point.avg)} bulbos
            </span>
            {point.avgStrands != null && (
              <span className="rounded-lg bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
                {formatNumber(point.avgStrands, 1)} fios
              </span>
            )}
            {point.avgThicknessPx != null && (
              <span className="rounded-lg bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                {formatThickness(point.avgThicknessPx)}
              </span>
            )}
          </div>
          <p className="text-xs text-ink-500 mt-1">
            {point.countedPhotos === 1
              ? '1 imagem analisada'
              : `média de ${point.countedPhotos} imagens${spread ? ` · variação ${spread} bulbos` : ''}`}
          </p>
          {wideSpread && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle size={13} />
              Dispersão alta entre as fotos — verifique o enquadramento
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function StatCard({
  icon,
  label,
  value,
  sublabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-ink-400 mb-1.5">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="font-display text-xl font-bold text-ink-900">{value}</p>
      <p className="text-xs text-ink-400 mt-0.5">{sublabel}</p>
    </div>
  );
}
