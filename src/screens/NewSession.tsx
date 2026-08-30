import { useCallback, useRef, useState } from 'react';
import {
  ArrowLeft, Upload, X, Loader2, Check, AlertCircle, Image as ImageIcon, MapPin,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Patient, PendingPhoto, ScalpArea } from '@/lib/types';
import { SCALP_AREAS, STORAGE_BUCKET } from '@/lib/constants';
import { analyzeImageWithAnnotations } from '@/lib/imageAnalysis';
import { formatDate } from '@/lib/formatters';

interface Props {
  patient: Patient;
  onBack: () => void;
  onSaved: () => void;
}

export function NewSession({ patient, onBack, onSaved }: Props) {
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const newPhotos: PendingPhoto[] = arr.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      annotatedPreviewUrl: null,
      annotatedPhotoUrl: null,
      scalpArea: '',
      hairCount: null,
      status: 'pending',
    }));
    setPhotos((prev) => [...prev, ...newPhotos]);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }

  function setArea(id: string, area: ScalpArea) {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, scalpArea: area } : p)));
  }

  async function analyzeAll() {
    setError(null);
    for (const p of photos) {
      if (p.status === 'done') continue;
      setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: 'processing' } : x)));
      try {
        const result = await analyzeImageWithAnnotations(p.file);
        setPhotos((prev) => prev.map((x) => (x.id === p.id
          ? {
              ...x,
              hairCount: Number(result.count ?? 0),
              annotatedPreviewUrl: result.annotated_image_data_url || x.annotatedPreviewUrl || null,
              annotatedPhotoUrl: result.annotated_photo_url || x.annotatedPhotoUrl || null,
              status: 'done',
            }
          : x)));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Não foi possível analisar esta imagem.';
        setError(message);
        setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: 'pending' } : x)));
      }
    }
  }

  async function handleSave() {
    setError(null);

    if (photos.length === 0) {
      setError('Envie pelo menos uma foto.');
      return;
    }

    const unassigned = photos.some((p) => !p.scalpArea);
    if (unassigned) {
      setError('Atribua uma área do couro cabeludo a cada foto antes de salvar.');
      return;
    }

    const unanalyzed = photos.some((p) => p.status !== 'done' || p.hairCount == null);
    if (unanalyzed) {
      setError('Analise todas as fotos antes de salvar.');
      return;
    }

    setSaving(true);

    const totalHairs = Math.round(
      photos.reduce((sum, p) => sum + (p.hairCount ?? 0), 0) / photos.length,
    );

    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        patient_id: patient.id,
        session_date: sessionDate,
        total_hairs: totalHairs,
        notes: notes || null,
      })
      .select()
      .maybeSingle();

    if (sessionError || !sessionData) {
      setSaving(false);
      setError(sessionError?.message || 'Não foi possível criar a sessão.');
      return;
    }

    for (const p of photos) {
      let annotatedPhotoUrl: string | null = p.annotatedPhotoUrl ?? null;

      if (!annotatedPhotoUrl && p.annotatedPreviewUrl?.startsWith('data:image/')) {
        const response = await fetch(p.annotatedPreviewUrl);
        const blob = await response.blob();
        const annotatedFileName = `${sessionData.id}/${p.id}-annotated.png`;

        const { error: annotatedUploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(annotatedFileName, blob, { contentType: 'image/png' });

        if (annotatedUploadError) {
          setError(`Falha ao enviar a imagem anotada: ${annotatedUploadError.message}`);
          setSaving(false);
          return;
        }

        const { data: annotatedUrlData } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(annotatedFileName);

        annotatedPhotoUrl = annotatedUrlData.publicUrl;
      }

      const photoRecord: {
        session_id: string;
        scalp_area: ScalpArea;
        photo_url: string;
        hair_count: number | null;
        annotated_photo_url?: string;
      } = {
        session_id: sessionData.id,
        scalp_area: p.scalpArea as ScalpArea,
        photo_url: annotatedPhotoUrl ?? '',
        hair_count: p.hairCount,
      };

      if (annotatedPhotoUrl) {
        photoRecord.annotated_photo_url = annotatedPhotoUrl;
      }

      const { error: photoInsertError } = await supabase.from('session_photos').insert(photoRecord);

      if (photoInsertError) {
        const isMissingColumn = /annotated_photo_url|column .* does not exist/i.test(photoInsertError.message || '');

        if (isMissingColumn && annotatedPhotoUrl) {
          const { error: fallbackError } = await supabase.from('session_photos').insert({
            session_id: sessionData.id,
            scalp_area: p.scalpArea as ScalpArea,
            photo_url: annotatedPhotoUrl,
            hair_count: p.hairCount,
          });

          if (fallbackError) {
            setError(`Falha ao salvar a foto anotada na sessão: ${fallbackError.message}`);
            setSaving(false);
            return;
          }
        } else {
          setError(`Falha ao salvar a foto anotada na sessão: ${photoInsertError.message}`);
          setSaving(false);
          return;
        }
      }
    }

    setSaving(false);
    onSaved();
  }

  const allAnalyzed = photos.length > 0 && photos.every((p) => p.status === 'done');
  const allAssigned = photos.length > 0 && photos.every((p) => p.scalpArea);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <button onClick={onBack} className="btn-ghost mb-6 -ml-2">
        <ArrowLeft size={18} /> Voltar ao painel
      </button>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink-900">Nova sessão</h1>
        <p className="text-sm text-ink-500 mt-1">
          Envie fotos do couro cabeludo, atribua cada uma a uma área e analise para registrar o progresso de {patient.name}.
        </p>
      </div>

      <div className="card p-5 mb-6 grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Data da sessão</label>
          <input
            type="date"
            className="input"
            value={sessionDate}
            onChange={(e) => setSessionDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Observações (opcional)</label>
          <input
            className="input"
            placeholder="Observações da sessão..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`card border-2 border-dashed p-10 mb-6 text-center cursor-pointer transition-all duration-200 ${
          dragging ? 'border-brand-400 bg-brand-50/50 scale-[1.01]' : 'border-ink-200 hover:border-brand-300 hover:bg-ink-50/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
        />
        <div className="inline-flex h-14 w-14 rounded-2xl bg-brand-50 items-center justify-center mb-4">
          <Upload size={28} className="text-brand-600" />
        </div>
        <p className="font-semibold text-ink-700">Arraste fotos aqui ou clique para enviar</p>
        <p className="text-sm text-ink-400 mt-1">Envie uma ou várias fotos do couro cabeludo (JPG, PNG)</p>
      </div>

      {photos.length > 0 && (
        <div className="space-y-3 mb-6">
          {photos.map((p, idx) => (
            <div key={p.id} className="card p-4 animate-scale-in">
              <div className="flex gap-4">
                <div className="h-20 w-20 rounded-xl overflow-hidden bg-ink-100 flex-shrink-0 flex items-center justify-center">
                  {p.annotatedPreviewUrl || p.previewUrl ? (
                    <img src={p.annotatedPreviewUrl || p.previewUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon size={24} className="text-ink-300" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-700 truncate">Foto {idx + 1}</p>
                      <p className="text-xs text-ink-400 truncate">{p.file.name}</p>
                    </div>
                    <button onClick={() => removePhoto(p.id)} className="text-ink-400 hover:text-red-500 transition-colors flex-shrink-0">
                      <X size={18} />
                    </button>
                  </div>

                  <div className="mt-3 flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-ink-500 flex items-center gap-1 mb-1">
                        <MapPin size={12} /> Área do couro cabeludo
                      </label>
                      <select
                        className="input py-2 text-sm"
                        value={p.scalpArea}
                        onChange={(e) => setArea(p.id, e.target.value as ScalpArea)}
                      >
                        <option value="">Selecione a área...</option>
                        {SCALP_AREAS.map((a) => (
                          <option key={a.value} value={a.value}>{a.label} — {a.description}</option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:w-40">
                      <label className="text-xs font-semibold text-ink-500 mb-1 block">Resultado</label>
                      <div className="rounded-xl border border-ink-200 px-3 py-2 text-sm min-h-[42px] flex items-center">
                        {p.status === 'processing' ? (
                          <span className="flex items-center gap-1.5 text-ink-400">
                            <Loader2 size={14} className="animate-spin" /> Analisando...
                          </span>
                        ) : p.status === 'done' && p.hairCount != null ? (
                          <span className="flex items-center gap-1.5 font-semibold text-brand-600">
                            <Check size={14} /> {p.hairCount.toLocaleString()} fios
                          </span>
                        ) : (
                          <span className="text-ink-400">Ainda não analisada</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {photos.length > 0 && allAnalyzed && (
        <div className="card p-5 mb-6 bg-brand-50/40 border-brand-200 animate-fade-in">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-ink-700">Média de fios</p>
              <p className="text-xs text-ink-400">Em {photos.length} foto{photos.length > 1 ? 's' : ''}</p>
            </div>
            <p className="font-display text-2xl font-bold text-brand-600">
              {Math.round(photos.reduce((s, p) => s + (p.hairCount ?? 0), 0) / photos.length).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4 flex items-start gap-2">
          <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={analyzeAll}
          className="btn-secondary flex-1"
          disabled={photos.length === 0 || saving || allAnalyzed}
        >
          {allAnalyzed ? <Check size={18} /> : <Loader2 size={18} className={photos.some((p) => p.status === 'processing') ? 'animate-spin' : ''} />}
          {allAnalyzed ? 'Todas as fotos analisadas' : 'Analisar fotos'}
        </button>
        <button
          onClick={handleSave}
          className="btn-primary flex-1"
          disabled={saving || !allAnalyzed || !allAssigned}
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          {saving ? 'Salvando sessão...' : 'Salvar sessão'}
        </button>
      </div>

      <p className="text-xs text-ink-400 mt-4 text-center">
        Data da sessão: {formatDate(sessionDate)} — os resultados serão adicionados ao histórico e ao gráfico de progresso de {patient.name}.
      </p>
    </div>
  );
}
