import { useState } from 'react';
import { ArrowLeft, BarChart3, Calendar, Camera, RefreshCw, X } from 'lucide-react';
import type { Patient, SessionWithPhotos } from '@/lib/types';
import { formatDateLong, formatNumber } from '@/lib/formatters';

interface Props {
  patient: Patient;
  session: SessionWithPhotos;
  onBack: () => void;
  onUpdate: () => void;
  onAnalyzeByArea: () => void;
}

export function SessionDashboard({ patient, session, onBack, onUpdate, onAnalyzeByArea }: Props) {
  const allPhotos = Array.from(new Map(session.session_photos.map((photo) => [photo.id, photo])).values()).reverse();
  const photos = allPhotos.slice(0, 4);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const selectedPhoto = allPhotos.find((photo) => photo.id === selectedPhotoId) ?? null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <button onClick={onBack} className="btn-ghost mb-6 -ml-2">
        <ArrowLeft size={18} /> Voltar às sessões
      </button>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-sm text-ink-500">{patient.name}</p>
          <h1 className="font-display text-2xl font-bold text-ink-900 mt-1">Análise da sessão</h1>
          <div className="flex flex-wrap gap-4 mt-3 text-sm text-ink-500">
            <span className="inline-flex items-center gap-1.5"><Calendar size={15} /> {formatDateLong(session.session_date)}</span>
            <span className="inline-flex items-center gap-1.5"><Camera size={15} /> {photos.length} imagem{photos.length === 1 ? '' : 'ns'}</span>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Média da sessão</p>
          <p className="font-display text-3xl font-bold text-brand-600">{formatNumber(session.total_hairs ?? 0)}</p>
          <p className="text-xs text-ink-400">fios/folículos</p>
        </div>
      </div>

      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-lg font-bold text-ink-900">Imagens da sessão</h2>
            <p className="text-sm text-ink-500">As quatro imagens mais recentes aparecem nesta visão.</p>
          </div>
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">{allPhotos.length} registradas</span>
        </div>
        {photos.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-500">Nenhuma imagem registrada nesta sessão.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => setGalleryOpen(true)}
                className="overflow-hidden rounded-xl border border-ink-100 bg-ink-50 text-left hover:border-brand-300 transition-colors"
              >
                <img src={photo.annotated_photo_url || photo.photo_url} alt={`Imagem da área ${photo.scalp_area}`} className="aspect-square w-full object-cover" />
                <div className="p-2.5">
                  <p className="text-xs font-semibold text-ink-700">{photo.scalp_area}</p>
                  <p className="text-xs text-ink-400 mt-0.5">{photo.hair_count != null ? `${formatNumber(photo.hair_count)} fios` : 'Sem contagem'}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {galleryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setGalleryOpen(false)}>
          <div className="relative max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setGalleryOpen(false)}
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              aria-label="Fechar galeria"
            >
              <X size={18} />
            </button>
            <div className="border-b border-ink-100 px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ink-900">Imagens da sessão</h2>
              <p className="text-sm text-ink-500">{formatDateLong(session.session_date)} · {allPhotos.length} imagens</p>
            </div>
            <div className="grid max-h-[75vh] grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3 lg:grid-cols-4">
              {allPhotos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setSelectedPhotoId(photo.id)}
                  className="overflow-hidden rounded-xl border border-ink-100 bg-ink-50 text-left hover:border-brand-300 transition-colors"
                >
                  <img src={photo.annotated_photo_url || photo.photo_url} alt={`Imagem da área ${photo.scalp_area}`} className="aspect-square w-full object-cover" />
                  <div className="px-2.5 py-2">
                    <p className="text-xs font-semibold text-ink-700">{photo.scalp_area}</p>
                    <p className="text-xs text-ink-400 mt-0.5">{photo.hair_count != null ? `${formatNumber(photo.hair_count)} fios` : 'Sem contagem'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedPhoto && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setSelectedPhotoId(null)}>
          <div className="relative max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setSelectedPhotoId(null)}
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              aria-label="Fechar imagem ampliada"
            >
              <X size={18} />
            </button>
            <img src={selectedPhoto.annotated_photo_url || selectedPhoto.photo_url} alt={`Imagem ampliada da área ${selectedPhoto.scalp_area}`} className="max-h-[78vh] w-full object-contain bg-ink-950" />
            <div className="border-t border-ink-100 px-5 py-3">
              <p className="text-sm font-semibold text-ink-700">{selectedPhoto.scalp_area} · {formatDateLong(session.session_date)}</p>
              <p className="text-sm text-ink-500 mt-1">{selectedPhoto.hair_count != null ? `${formatNumber(selectedPhoto.hair_count)} fios/folículos` : 'Contagem não disponível'}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={onUpdate} className="btn-primary flex-1">
          <RefreshCw size={18} /> Atualizar registro da sessão
        </button>
        <button onClick={onAnalyzeByArea} className="btn-secondary flex-1">
          <BarChart3 size={18} /> Analisar por área
        </button>
      </div>
    </div>
  );
}
