import { useState } from 'react';
import { ArrowLeft, AlertTriangle, Calendar, Camera, Layers, TrendingUp, X } from 'lucide-react';
import type { Patient, SessionPhoto } from '@/lib/types';
import { formatDate, formatDateLong, formatNumber } from '@/lib/formatters';
import { spreadLabel, type AreaSessionPoint, type AreaSummary } from '@/lib/areaStats';
import { ProgressChart, type ChartPoint } from '@/components/ProgressChart';
import { TrendBadge } from '@/components/TrendBadge';

interface Props {
  patient: Patient;
  area: AreaSummary;
  onBack: () => void;
}

export function AreaDashboard({ patient, area, onBack }: Props) {
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{ photo: SessionPhoto; date: string } | null>(null);

  const chartPoints: ChartPoint[] = area.points.map((p) => ({
    date: p.date,
    label: p.label,
    value: p.avg,
  }));

  const lastPoint = area.points.length > 0 ? area.points[area.points.length - 1] : null;
  const openSession = area.points.find((p) => p.sessionId === openSessionId) ?? null;
  const sessionWord = area.sessionCount === 1 ? 'sessão' : 'sessões';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <button onClick={onBack} className="btn-ghost mb-6 -ml-2">
        <ArrowLeft size={18} /> Voltar às áreas
      </button>

      <div className="card p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-accent-50 to-accent-100 flex items-center justify-center flex-shrink-0">
            <Layers size={28} className="text-accent-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-ink-500">{patient.name}</p>
            <h1 className="font-display text-2xl font-bold text-ink-900 mt-0.5">Área {area.label}</h1>
            <p className="text-sm text-ink-500 mt-1">
              Evolução desta região ao longo de {area.sessionCount} {sessionWord}.
            </p>
          </div>
        </div>
      </div>

      {/* Indicadores desta área */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<Calendar size={18} />}
          label="Última sessão"
          value={lastPoint ? formatDate(lastPoint.date) : '—'}
          sublabel={lastPoint ? formatDateLong(lastPoint.date) : 'Sem sessões'}
        />
        <StatCard
          icon={<Camera size={18} />}
          label="Sessões nesta área"
          value={String(area.sessionCount)}
          sublabel={`${area.photoCount} ${area.photoCount === 1 ? 'imagem' : 'imagens'} no total`}
        />
        <StatCard
          icon={<TrendingUp size={18} />}
          label="Contagem mais recente"
          value={area.latest != null ? formatNumber(area.latest) : '—'}
          sublabel={
            lastPoint && lastPoint.countedPhotos > 1
              ? `média de ${lastPoint.countedPhotos} fotos`
              : 'fios/folículos'
          }
        />
        <div className="card p-5">
          <div className="flex items-center gap-2 text-ink-400 mb-2">
            <TrendingUp size={18} />
            <span className="text-xs font-semibold uppercase tracking-wide">Variação na área</span>
          </div>
          <TrendBadge
            delta={area.delta}
            deltaPct={area.deltaPct}
            hasComparison={area.hasComparison}
            size={18}
            showAbsolute
          />
          <p className="text-xs text-ink-400 mt-1">
            {area.hasComparison ? 'da primeira à última sessão' : 'é preciso uma segunda sessão'}
          </p>
        </div>
      </div>

      {/* Evolução ao longo das sessões */}
      <div className="card p-6 mb-6">
        <div className="mb-4">
          <h2 className="font-display text-lg font-bold text-ink-900">Evolução da área {area.label}</h2>
          <p className="text-sm text-ink-400">Contagem média desta região em cada sessão</p>
        </div>
        {area.points.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-500">Nenhuma contagem registrada nesta área.</p>
        ) : area.points.length === 1 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-ink-500">
              {formatNumber(area.points[0].avg)} fios/folículos em {formatDateLong(area.points[0].date)}
            </p>
            <p className="text-sm text-ink-400 mt-1">
              Registre uma segunda sessão desta área para que a curva de evolução apareça.
            </p>
          </div>
        ) : (
          <ProgressChart points={chartPoints} />
        )}
      </div>

      {/* Sessões desta área */}
      <div className="card p-6">
        <div className="mb-4">
          <h2 className="font-display text-lg font-bold text-ink-900">Sessões desta área</h2>
          <p className="text-sm text-ink-400">Clique numa sessão para ver as imagens da região</p>
        </div>

        {area.points.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-500">Nenhuma contagem registrada nesta área.</p>
        ) : (
          <div className="grid gap-3">
            {[...area.points].reverse().map((point) => (
              <SessionRow key={point.sessionId} point={point} onOpen={() => setOpenSessionId(point.sessionId)} />
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
                {openSession.photos.length} {openSession.photos.length === 1 ? 'imagem' : 'imagens'} desta área nesta sessão
              </p>
            </div>
            <div className="grid max-h-[75vh] grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3 lg:grid-cols-4">
              {openSession.photos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setSelectedPhoto({ photo, date: openSession.date })}
                  className="overflow-hidden rounded-xl border border-ink-100 bg-ink-50 text-left hover:border-brand-300 transition-colors"
                >
                  <img
                    src={photo.annotated_photo_url || photo.photo_url}
                    alt={`${area.label} em ${formatDate(openSession.date)}`}
                    className="aspect-square w-full object-cover"
                  />
                  <div className="px-2.5 py-2">
                    <p className="text-xs font-semibold text-ink-700">
                      {photo.hair_count != null ? `${formatNumber(photo.hair_count)} fios` : 'Sem contagem'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedPhoto && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <div
            className="relative max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedPhoto(null)}
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              aria-label="Fechar imagem ampliada"
            >
              <X size={18} />
            </button>
            <img
              src={selectedPhoto.photo.annotated_photo_url || selectedPhoto.photo.photo_url}
              alt={`${area.label} ampliada`}
              className="max-h-[78vh] w-full object-contain bg-ink-950"
            />
            <div className="border-t border-ink-100 px-5 py-3">
              <p className="text-sm font-semibold text-ink-700">
                {area.label} · {formatDateLong(selectedPhoto.date)}
              </p>
              <p className="text-sm text-ink-500 mt-1">
                {selectedPhoto.photo.hair_count != null
                  ? `${formatNumber(selectedPhoto.photo.hair_count)} fios/folículos`
                  : 'Contagem não disponível'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionRow({ point, onOpen }: { point: AreaSessionPoint; onOpen: () => void }) {
  const spread = spreadLabel(point);
  // Dispersão alta entre fotos da mesma área e mesma sessão costuma indicar
  // enquadramento inconsistente — vale sinalizar em vez de esconder na média.
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
          <p className="font-display text-lg font-bold text-ink-900 mt-1">{formatNumber(point.avg)} fios/folículos</p>
          <p className="text-sm text-ink-500 mt-0.5">
            {point.countedPhotos === 1
              ? '1 foto contada'
              : `média de ${point.countedPhotos} fotos${spread ? ` · variação ${spread}` : ''}`}
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
  icon, label, value, sublabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-ink-400 mb-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="font-display text-xl font-bold text-ink-900">{value}</p>
      <p className="text-xs text-ink-400 mt-0.5">{sublabel}</p>
    </div>
  );
}
