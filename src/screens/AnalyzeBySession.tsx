import { useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, ChevronRight, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Patient, SessionPhoto, SessionWithPhotos } from '@/lib/types';
import { formatDateLong, formatNumber } from '@/lib/formatters';

interface Props {
  patient: Patient;
  onBack: () => void;
  onSelectSession: (session: SessionWithPhotos) => void;
}

export function AnalyzeBySession({ patient, onBack, onSelectSession }: Props) {
  const [sessions, setSessions] = useState<SessionWithPhotos[]>([]);
  const [loading, setLoading] = useState(true);
  const [gallerySession, setGallerySession] = useState<SessionWithPhotos | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{ photo: SessionPhoto; sessionDate: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*, session_photos(*)')
        .eq('patient_id', patient.id)
        .order('session_date', { ascending: true });

      setLoading(false);
      if (!error && data) setSessions(data as SessionWithPhotos[]);
    })();
  }, [patient.id]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <button onClick={onBack} className="btn-ghost mb-6 -ml-2">
        <ArrowLeft size={18} /> Voltar ao painel
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-xl bg-accent-50 flex items-center justify-center">
            <BarChart3 size={22} className="text-accent-600" />
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Analisar por sessão</h1>
        </div>
        <p className="text-sm text-ink-500">Escolha uma sessão de {patient.name} para revisar suas imagens e resultados.</p>
      </div>

      {loading ? (
        <div className="card flex items-center justify-center py-16 text-ink-400">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-ink-500 font-medium">Nenhuma sessão registrada ainda.</p>
          <p className="text-sm text-ink-400 mt-1">Crie uma nova sessão para começar a acompanhar as imagens.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {[...sessions].reverse().map((session) => {
            const previewPhotos = Array.from(new Map(session.session_photos.map((photo) => [photo.id, photo])).values()).slice(-4).reverse();
            return (
            <div
              key={session.id}
              className="card w-full p-4 text-left hover:border-brand-300 hover:shadow-card transition-all"
            >
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setGallerySession(session)}
                  className="grid grid-cols-4 gap-2 w-48 sm:w-64 flex-shrink-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  aria-label={`Exibir todas as imagens da sessão de ${formatDateLong(session.session_date)}`}
                >
                  {previewPhotos.map((photo) => (
                    <img
                      key={photo.id}
                      src={photo.annotated_photo_url || photo.photo_url}
                      alt=""
                      className="aspect-square w-full rounded-lg object-cover bg-ink-100"
                    />
                  ))}
                  {Array.from({ length: Math.max(0, 4 - previewPhotos.length) }).map((_, index) => (
                    <div key={`empty-${index}`} className="aspect-square rounded-lg bg-ink-100" />
                  ))}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectSession(session)}
                  className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-lg"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{formatDateLong(session.session_date)}</p>
                  <p className="font-display text-lg font-bold text-ink-900 mt-1">{formatNumber(session.total_hairs ?? 0)} fios/folículos</p>
                  <p className="text-sm text-ink-500 mt-1">{session.session_photos.length} imagem{session.session_photos.length === 1 ? '' : 'ns'} registrada{session.session_photos.length === 1 ? '' : 's'}</p>
                </button>
                <button type="button" onClick={() => onSelectSession(session)} className="text-ink-300 flex-shrink-0" aria-label="Abrir análise da sessão">
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {gallerySession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setGallerySession(null)}>
          <div className="relative max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setGallerySession(null)}
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              aria-label="Fechar galeria"
            >
              <X size={18} />
            </button>
            <div className="border-b border-ink-100 px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ink-900">Imagens da sessão</h2>
              <p className="text-sm text-ink-500">{formatDateLong(gallerySession.session_date)} · {gallerySession.session_photos.length} imagens</p>
            </div>
            <div className="grid max-h-[75vh] grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3 lg:grid-cols-4">
              {[...gallerySession.session_photos].reverse().map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setSelectedPhoto({ photo, sessionDate: gallerySession.session_date })}
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setSelectedPhoto(null)}>
          <div className="relative max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setSelectedPhoto(null)}
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              aria-label="Fechar imagem ampliada"
            >
              <X size={18} />
            </button>
            <img src={selectedPhoto.photo.annotated_photo_url || selectedPhoto.photo.photo_url} alt={`Imagem ampliada da área ${selectedPhoto.photo.scalp_area}`} className="max-h-[78vh] w-full object-contain bg-ink-950" />
            <div className="border-t border-ink-100 px-5 py-3">
              <p className="text-sm font-semibold text-ink-700">{selectedPhoto.photo.scalp_area} · {formatDateLong(selectedPhoto.sessionDate)}</p>
              <p className="text-sm text-ink-500 mt-1">{selectedPhoto.photo.hair_count != null ? `${formatNumber(selectedPhoto.photo.hair_count)} fios/folículos` : 'Contagem não disponível'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
