import { useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Camera,
  Layers,
  Plus,
  Ruler,
  ScanEye,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { deleteSession } from '@/lib/api';
import { areaLabel } from '@/lib/constants';
import { formatDateLong, formatNumber, formatThickness } from '@/lib/formatters';
import type { Patient, SessionPhoto, SessionWithPhotos } from '@/lib/types';
import { PhotoAnalysisModal, type InspectablePhoto } from '@/components/PhotoAnalysisModal';

interface Props {
  patient: Patient;
  session: SessionWithPhotos;
  onBack: () => void;
  onUpdate: () => void;
  onDeleted: () => void;
}

type ThumbLayer = 'combined' | 'hair-mask' | 'scalp-mask' | 'original';

export function SessionDashboard({ patient, session, onBack, onUpdate, onDeleted }: Props) {
  const allPhotos = Array.from(new Map(session.session_photos.map((photo) => [photo.id, photo])).values()).reverse();
  const [layer, setLayer] = useState<ThumbLayer>('combined');
  const [inspected, setInspected] = useState<InspectablePhoto | null>(null);
  const [deleting, setDeleting] = useState(false);

  const hasMasks = allPhotos.some((p) => Boolean(p.hair_mask_url || p.scalp_mask_url));

  function thumbUrl(photo: SessionPhoto): string {
    if (layer === 'hair-mask' && photo.hair_mask_url) return photo.hair_mask_url;
    if (layer === 'scalp-mask' && photo.scalp_mask_url) return photo.scalp_mask_url;
    if (layer === 'original' && photo.photo_url) return photo.photo_url;
    return photo.annotated_photo_url || photo.photo_url;
  }

  function openPhoto(photo: SessionPhoto) {
    setInspected({
      title: `${areaLabel(photo.scalp_area)} · ${formatDateLong(session.session_date)}`,
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

  async function handleDeleteSession() {
    if (!window.confirm('Deseja realmente excluir esta sessão e todas as suas imagens?')) return;
    setDeleting(true);
    try {
      await deleteSession(session.id);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <button onClick={onBack} className="btn-ghost -ml-2">
          <ArrowLeft size={18} /> Voltar
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDeleteSession}
            disabled={deleting}
            className="btn-ghost text-red-600 hover:bg-red-50 px-3 py-2 text-xs"
          >
            <Trash2 size={15} /> Excluir sessão
          </button>
          <button type="button" onClick={onUpdate} className="btn-primary py-2.5 px-4 text-xs sm:text-sm">
            <Plus size={16} /> Adicionar imagens
          </button>
        </div>
      </div>

      {/* Cabeçalho da sessão */}
      <div className="mb-6">
        <p className="text-sm text-ink-500">{patient.name}</p>
        <h1 className="font-display text-2xl font-bold text-ink-900 mt-0.5">Análise da sessão</h1>
        <div className="flex flex-wrap gap-4 mt-2 text-sm text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <Calendar size={15} /> {formatDateLong(session.session_date)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Camera size={15} /> {allPhotos.length} {allPhotos.length === 1 ? 'imagem' : 'imagens'}
          </span>
        </div>
        {session.notes && (
          <p className="mt-2 text-sm text-ink-600 bg-white border border-ink-100 rounded-xl px-4 py-2.5 inline-block">
            {session.notes}
          </p>
        )}
      </div>

      {/* KPIs da sessão: Bulbos, Fios, Espessura em px, Cobertura */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 flex items-center gap-1.5">
            <ScanEye size={14} className="text-rose-500" /> Bulbos (média)
          </p>
          <p className="font-display text-2xl font-bold text-ink-900 mt-1">
            {session.total_hairs != null ? formatNumber(session.total_hairs) : '—'}
          </p>
          <p className="text-xs text-ink-400 mt-0.5">Origem/tracking de fios</p>
        </div>

        <div className="card p-4 border-teal-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 flex items-center gap-1.5">
            <Sparkles size={14} className="text-teal-600" /> Fios detectados
          </p>
          <p className="font-display text-2xl font-bold text-teal-700 mt-1">
            {session.avg_strands != null ? formatNumber(session.avg_strands, 1) : '—'}
          </p>
          <p className="text-xs text-ink-400 mt-0.5">Média por imagem (grayscale)</p>
        </div>

        <div className="card p-4 border-sky-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 flex items-center gap-1.5">
            <Ruler size={14} className="text-sky-600" /> Espessura média
          </p>
          <p className="font-display text-2xl font-bold text-sky-700 mt-1">
            {formatThickness(session.avg_thickness_px)}
          </p>
          <p className="text-xs text-ink-400 mt-0.5">Calibre médio em pixels</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 flex items-center gap-1.5">
            <Layers size={14} className="text-brand-600" /> Cobertura capilar
          </p>
          <p className="font-display text-2xl font-bold text-ink-900 mt-1">
            {session.avg_coverage_pct != null ? `${formatNumber(session.avg_coverage_pct, 1)}%` : '—'}
          </p>
          <p className="text-xs text-ink-400 mt-0.5">Fios sobre couro cabeludo</p>
        </div>
      </div>

      {/* Galeria da sessão com seletor de camada/máscara */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-bold text-ink-900">Imagens e máscaras da sessão</h2>
            <p className="text-xs text-ink-500">
              Clique em qualquer imagem para comparar as máscaras separadas lado a lado.
            </p>
          </div>

          {hasMasks && (
            <div className="inline-flex flex-wrap rounded-xl bg-ink-100 p-1 self-start">
              <LayerTab active={layer === 'combined'} onClick={() => setLayer('combined')} label="Bulbos + Fios" />
              <LayerTab active={layer === 'hair-mask'} onClick={() => setLayer('hair-mask')} label="Máscara Fios" />
              <LayerTab active={layer === 'scalp-mask'} onClick={() => setLayer('scalp-mask')} label="Couro Cabeludo" />
              <LayerTab active={layer === 'original'} onClick={() => setLayer('original')} label="Original" />
            </div>
          )}
        </div>

        {allPhotos.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-500">Nenhuma imagem registrada nesta sessão.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allPhotos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => openPhoto(photo)}
                className="group overflow-hidden rounded-2xl border border-ink-100 bg-white text-left hover:border-brand-300 hover:shadow-card transition-all"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-ink-950">
                  <img
                    src={thumbUrl(photo)}
                    alt={`Área ${areaLabel(photo.scalp_area)}`}
                    className="h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                  />
                </div>
                <div className="p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-sm font-bold text-ink-900">{areaLabel(photo.scalp_area)}</span>
                    {photo.hair_mask_url && (
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700">
                        Máscaras prontas
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-lg bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">
                      {photo.hair_count != null ? `${formatNumber(photo.hair_count)} bulbos` : '— bulbos'}
                    </span>
                    {photo.strand_count != null && (
                      <span className="rounded-lg bg-teal-50 px-2 py-0.5 font-semibold text-teal-700">
                        {formatNumber(photo.strand_count)} fios
                      </span>
                    )}
                    {photo.avg_thickness_px != null && (
                      <span className="rounded-lg bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">
                        {formatThickness(photo.avg_thickness_px)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {inspected && <PhotoAnalysisModal photo={inspected} onClose={() => setInspected(null)} />}
    </div>
  );
}

function LayerTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
        active ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
      }`}
    >
      {label}
    </button>
  );
}
