import { useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, ChevronRight, Loader2 } from 'lucide-react';
import { listSessionsByPatient } from '@/lib/api';
import { areaLabel } from '@/lib/constants';
import { formatDateLong, formatNumber, formatThickness } from '@/lib/formatters';
import type { Patient, SessionPhoto, SessionWithPhotos } from '@/lib/types';
import { PhotoAnalysisModal, type InspectablePhoto } from '@/components/PhotoAnalysisModal';

interface Props {
  patient: Patient;
  onBack: () => void;
  onSelectSession: (session: SessionWithPhotos) => void;
}

export function AnalyzeBySession({ patient, onBack, onSelectSession }: Props) {
  const [sessions, setSessions] = useState<SessionWithPhotos[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspected, setInspected] = useState<InspectablePhoto | null>(null);

  useEffect(() => {
    let active = true;
    listSessionsByPatient(patient.id)
      .then((data) => {
        if (active) setSessions(data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [patient.id]);

  function openPhoto(photo: SessionPhoto, sessionDate: string) {
    setInspected({
      title: `${areaLabel(photo.scalp_area)} · ${formatDateLong(sessionDate)}`,
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
        <ArrowLeft size={18} /> Voltar ao painel
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-xl bg-teal-50 flex items-center justify-center">
            <BarChart3 size={22} className="text-teal-600" />
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Histórico de sessões</h1>
        </div>
        <p className="text-sm text-ink-500">
          Escolha uma consulta de <strong>{patient.name}</strong> para inspecionar máscaras, bulbos, fios e calibre.
        </p>
      </div>

      {loading ? (
        <div className="card flex items-center justify-center py-16 text-ink-400">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-ink-500 font-medium">Nenhuma sessão registrada ainda.</p>
          <p className="text-sm text-ink-400 mt-1">Crie uma nova sessão para começar o acompanhamento.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {[...sessions].reverse().map((session) => {
            const previewPhotos = Array.from(
              new Map(session.session_photos.map((photo) => [photo.id, photo])).values(),
            )
              .slice(-4)
              .reverse();

            return (
              <div
                key={session.id}
                className="card w-full p-4 hover:border-brand-300 hover:shadow-card transition-all"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="grid grid-cols-4 gap-2 w-full sm:w-60 flex-shrink-0">
                    {previewPhotos.map((photo) => (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => openPhoto(photo, session.session_date)}
                        className="aspect-square w-full overflow-hidden rounded-lg bg-ink-100 hover:ring-2 hover:ring-brand-400 transition-all"
                        title={`Ampliar ${areaLabel(photo.scalp_area)}`}
                      >
                        <img
                          src={photo.annotated_photo_url || photo.photo_url}
                          alt={areaLabel(photo.scalp_area)}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                    {Array.from({ length: Math.max(0, 4 - previewPhotos.length) }).map((_, index) => (
                      <div key={`empty-${index}`} className="aspect-square rounded-lg bg-ink-100" />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectSession(session)}
                    className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-lg"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                      {formatDateLong(session.session_date)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">
                        {formatNumber(session.total_hairs ?? 0)} bulbos
                      </span>
                      {session.avg_strands != null && (
                        <span className="rounded-lg bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700">
                          {formatNumber(session.avg_strands, 1)} fios
                        </span>
                      )}
                      {session.avg_thickness_px != null && (
                        <span className="rounded-lg bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700">
                          {formatThickness(session.avg_thickness_px)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-500 mt-2">
                      {session.session_photos.length}{' '}
                      {session.session_photos.length === 1 ? 'imagem registrada' : 'imagens registradas'}
                      {session.notes ? ` · ${session.notes}` : ''}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectSession(session)}
                    className="hidden sm:inline-flex text-ink-300 hover:text-brand-600 flex-shrink-0"
                    aria-label="Abrir análise da sessão"
                  >
                    <ChevronRight size={22} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {inspected && <PhotoAnalysisModal photo={inspected} onClose={() => setInspected(null)} />}
    </div>
  );
}
