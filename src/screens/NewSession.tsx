import { useCallback, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Image as ImageIcon,
  Layers,
  Loader2,
  MapPin,
  RefreshCw,
  Ruler,
  ScanEye,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { addSessionPhoto, analyzeImage, createSession } from '@/lib/api';
import { SCALP_AREAS, areaLabel } from '@/lib/constants';
import { formatDate, formatNumber, formatThickness } from '@/lib/formatters';
import type { Patient, PendingPhoto, ScalpArea } from '@/lib/types';
import { PhotoAnalysisModal, type InspectablePhoto } from '@/components/PhotoAnalysisModal';

interface Props {
  patient: Patient;
  sessionId?: string;
  onBack: () => void;
  onSaved: () => void;
}

export function NewSession({ patient, sessionId, onBack, onSaved }: Props) {
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showGrayControls, setShowGrayControls] = useState<Record<string, boolean>>({});
  const [inspectedPhoto, setInspectedPhoto] = useState<InspectablePhoto | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const newPhotos: PendingPhoto[] = arr.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      originalPhotoUrl: null,
      annotatedPreviewUrl: null,
      annotatedPhotoUrl: null,
      hairMaskPreviewUrl: null,
      hairMaskUrl: null,
      scalpMaskPreviewUrl: null,
      scalpMaskUrl: null,
      scalpArea: '',
      bulbCount: null,
      strandCount: null,
      avgThicknessPx: null,
      hairCoveragePct: null,
      grayThreshold: null,
      scalpGrayMedian: null,
      hairGrayMedian: null,
      customGrayMax: null,
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

  function applyAreaToAll(area: ScalpArea) {
    setPhotos((prev) => prev.map((p) => ({ ...p, scalpArea: area })));
  }

  async function analyzeOne(photo: PendingPhoto, overrideGrayMax?: number | null): Promise<PendingPhoto | null> {
    setError(null);
    setPhotos((prev) => prev.map((x) => (x.id === photo.id ? { ...x, status: 'processing' } : x)));
    try {
      const grayMax = overrideGrayMax !== undefined ? overrideGrayMax : photo.customGrayMax;
      const result = await analyzeImage(photo.file, {
        sessionId,
        scalpArea: photo.scalpArea || 'frontal',
        patientId: patient.id,
        hairGrayMax: grayMax,
      });

      const updated: PendingPhoto = {
        ...photo,
        customGrayMax: grayMax,
        bulbCount: Number(result.bulb_count ?? result.count ?? 0),
        strandCount: Number(result.strand_count ?? 0),
        avgThicknessPx: Number(result.avg_thickness_px ?? 0),
        hairCoveragePct: Number(result.hair_coverage_pct ?? 0),
        grayThreshold: Number(result.gray_threshold ?? 0),
        scalpGrayMedian: Number(result.scalp_gray_median ?? 0),
        hairGrayMedian: Number(result.hair_gray_median ?? 0),
        originalPhotoUrl: result.original_photo_url || photo.originalPhotoUrl || null,
        annotatedPreviewUrl: result.annotated_image_data_url || result.annotated_photo_url || null,
        annotatedPhotoUrl: result.annotated_photo_url || null,
        hairMaskPreviewUrl: result.hair_mask_data_url || result.hair_mask_url || null,
        hairMaskUrl: result.hair_mask_url || null,
        scalpMaskPreviewUrl: result.scalp_mask_data_url || result.scalp_mask_url || null,
        scalpMaskUrl: result.scalp_mask_url || null,
        status: 'done',
      };

      setPhotos((prev) => prev.map((x) => (x.id === photo.id ? updated : x)));
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível analisar esta imagem.';
      setError(message);
      setPhotos((prev) => prev.map((x) => (x.id === photo.id ? { ...x, status: 'pending' } : x)));
      return null;
    }
  }

  async function analyzeAllPending(): Promise<PendingPhoto[] | null> {
    setError(null);
    setAnalyzing(true);
    let current = [...photos];

    try {
      for (let i = 0; i < current.length; i++) {
        const photo = current[i];
        if (photo.status === 'done') continue;
        const result = await analyzeOne(photo);
        if (!result) return null;
        current = current.map((x) => (x.id === result.id ? result : x));
      }
      return current;
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    setError(null);

    if (photos.length === 0) {
      setError('Envie pelo menos uma foto tricoscópica.');
      return;
    }

    if (photos.some((p) => !p.scalpArea)) {
      setError('Selecione a região do couro cabeludo para cada foto antes de salvar.');
      return;
    }

    setSaving(true);
    try {
      const photosToSave = allAnalyzed ? photos : await analyzeAllPending();
      if (!photosToSave) {
        setSaving(false);
        return;
      }

      const avgBulbs = Math.round(
        photosToSave.reduce((sum, p) => sum + (p.bulbCount ?? 0), 0) / photosToSave.length,
      );
      const avgStrands = Number(
        (photosToSave.reduce((sum, p) => sum + (p.strandCount ?? 0), 0) / photosToSave.length).toFixed(1),
      );
      const avgThicknessPx = Number(
        (photosToSave.reduce((sum, p) => sum + (p.avgThicknessPx ?? 0), 0) / photosToSave.length).toFixed(2),
      );
      const avgCoveragePct = Number(
        (photosToSave.reduce((sum, p) => sum + (p.hairCoveragePct ?? 0), 0) / photosToSave.length).toFixed(1),
      );

      const photoPayloads = photosToSave.map((p) => ({
        scalp_area: p.scalpArea as ScalpArea,
        photo_url: p.originalPhotoUrl || p.annotatedPhotoUrl || '',
        annotated_photo_url: p.annotatedPhotoUrl,
        hair_mask_url: p.hairMaskUrl,
        scalp_mask_url: p.scalpMaskUrl,
        hair_count: p.bulbCount,
        strand_count: p.strandCount,
        avg_thickness_px: p.avgThicknessPx,
        hair_coverage_pct: p.hairCoveragePct,
        gray_threshold: p.grayThreshold,
      }));

      if (sessionId) {
        for (const payload of photoPayloads) {
          await addSessionPhoto({ session_id: sessionId, ...payload });
        }
      } else {
        await createSession({
          patient_id: patient.id,
          session_date: sessionDate,
          total_hairs: avgBulbs,
          avg_strands: avgStrands,
          avg_thickness_px: avgThicknessPx,
          avg_coverage_pct: avgCoveragePct,
          notes: notes.trim() || null,
          photos: photoPayloads,
        });
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar a sessão.');
    } finally {
      setSaving(false);
    }
  }

  function openInspector(p: PendingPhoto, idx: number) {
    setInspectedPhoto({
      title: `${p.scalpArea ? areaLabel(p.scalpArea) : `Foto ${idx + 1}`} · ${p.file.name}`,
      subtitle:
        p.scalpGrayMedian != null && p.hairGrayMedian != null
          ? `Grayscale: fios ≈ ${Math.round(p.hairGrayMedian)} · couro cabeludo ≈ ${Math.round(p.scalpGrayMedian)} · limiar ≤ ${Math.round(p.grayThreshold ?? 0)}`
          : undefined,
      originalUrl: p.originalPhotoUrl || p.previewUrl,
      annotatedUrl: p.annotatedPreviewUrl || p.annotatedPhotoUrl,
      hairMaskUrl: p.hairMaskPreviewUrl || p.hairMaskUrl,
      scalpMaskUrl: p.scalpMaskPreviewUrl || p.scalpMaskUrl,
      bulbCount: p.bulbCount,
      strandCount: p.strandCount,
      avgThicknessPx: p.avgThicknessPx,
      hairCoveragePct: p.hairCoveragePct,
      grayThreshold: p.grayThreshold,
    });
  }

  const allAnalyzed = photos.length > 0 && photos.every((p) => p.status === 'done');
  const allAssigned = photos.length > 0 && photos.every((p) => Boolean(p.scalpArea));
  const isProcessing = analyzing || saving || photos.some((p) => p.status === 'processing');

  const avgBulbsPreview =
    allAnalyzed ? Math.round(photos.reduce((s, p) => s + (p.bulbCount ?? 0), 0) / photos.length) : 0;
  const avgStrandsPreview =
    allAnalyzed ? Number((photos.reduce((s, p) => s + (p.strandCount ?? 0), 0) / photos.length).toFixed(1)) : 0;
  const avgThicknessPreview =
    allAnalyzed ? Number((photos.reduce((s, p) => s + (p.avgThicknessPx ?? 0), 0) / photos.length).toFixed(2)) : 0;
  const avgCoveragePreview =
    allAnalyzed ? Number((photos.reduce((s, p) => s + (p.hairCoveragePct ?? 0), 0) / photos.length).toFixed(1)) : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <button onClick={onBack} className="btn-ghost mb-5 -ml-2">
        <ArrowLeft size={18} /> Voltar
      </button>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink-900">
          {sessionId ? 'Adicionar imagens à sessão' : 'Nova consulta / sessão'}
        </h1>
        <p className="text-sm text-ink-500 mt-1">
          Envie as imagens tricoscópicas de <strong>{patient.name}</strong>. O sistema separa automaticamente os fios do couro cabeludo em escala de cinza, rastreia cada fio até a origem na pele para contar os bulbos e calcula a quantidade de fios e a espessura média em pixels.
        </p>
      </div>

      {/* Passo 1: Data e observações */}
      {!sessionId && (
        <div className="card p-5 mb-5 grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Data da consulta</label>
            <input
              type="date"
              className="input"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Observações clínicas (opcional)</label>
            <input
              className="input"
              placeholder="Ex.: Retorno 90 dias, protocolo MMP..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Passo 2: Upload */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`card border-2 border-dashed p-8 mb-6 text-center cursor-pointer transition-all duration-200 ${
          dragging
            ? 'border-brand-400 bg-brand-50/50 scale-[1.01]'
            : 'border-ink-200 hover:border-brand-300 hover:bg-ink-50/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="inline-flex h-12 w-12 rounded-2xl bg-brand-50 items-center justify-center mb-3">
          <Upload size={24} className="text-brand-600" />
        </div>
        <p className="font-semibold text-ink-700">Arraste as fotos do dermatoscópio ou clique para selecionar</p>
        <p className="text-xs text-ink-400 mt-1">Aceita uma ou várias imagens em JPG, PNG ou WEBP</p>
      </div>

      {/* Lista de fotos + máscaras separadas */}
      {photos.length > 0 && (
        <div className="space-y-4 mb-6">
          {photos.map((p, idx) => {
            const controlsOpen = Boolean(showGrayControls[p.id]);
            const sliderValue = p.customGrayMax ?? Math.round(p.grayThreshold ?? 125);

            return (
              <div key={p.id} className="card p-5 animate-scale-in">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink-900 truncate">
                      Imagem {idx + 1} · <span className="font-normal text-ink-500">{p.file.name}</span>
                    </p>
                    {p.status === 'done' && p.grayThreshold != null && (
                      <p className="text-xs text-ink-400 mt-0.5">
                        Janela grayscale: fios ≤ {Math.round(p.grayThreshold)} · couro cabeludo ≈{' '}
                        {Math.round(p.scalpGrayMedian ?? 0)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {p.status === 'done' && (
                      <button
                        type="button"
                        onClick={() =>
                          setShowGrayControls((prev) => ({ ...prev, [p.id]: !prev[p.id] }))
                        }
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                          controlsOpen
                            ? 'bg-teal-100 text-teal-800'
                            : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                        }`}
                        title="Ajustar limiar grayscale manualmente"
                      >
                        <SlidersHorizontal size={13} /> Limiar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removePhoto(p.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                      aria-label="Remover imagem"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Área + status */}
                <div className="grid sm:grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-xs font-semibold text-ink-500 flex items-center justify-between mb-1">
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} /> Região do couro cabeludo
                      </span>
                      {photos.length > 1 && p.scalpArea && (
                        <button
                          type="button"
                          onClick={() => applyAreaToAll(p.scalpArea as ScalpArea)}
                          className="text-[11px] font-semibold text-brand-600 hover:underline"
                        >
                          Aplicar a todas
                        </button>
                      )}
                    </label>
                    <select
                      className="input py-2 text-sm"
                      value={p.scalpArea}
                      onChange={(e) => setArea(p.id, e.target.value as ScalpArea)}
                    >
                      <option value="">Selecione a região...</option>
                      {SCALP_AREAS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label} — {a.description}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-ink-500 mb-1 block">Status da análise</label>
                    <div className="rounded-xl border border-ink-200 px-3 py-2 text-sm min-h-[40px] flex items-center justify-between gap-2">
                      {p.status === 'processing' ? (
                        <span className="flex items-center gap-1.5 text-brand-600 font-medium">
                          <Loader2 size={14} className="animate-spin" /> Segmentando fios e detectando bulbos...
                        </span>
                      ) : p.status === 'done' ? (
                        <span className="flex items-center gap-1.5 font-semibold text-brand-600">
                          <Check size={14} /> Analisada
                        </span>
                      ) : (
                        <span className="text-ink-400">Aguardando análise</span>
                      )}

                      {p.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => analyzeOne(p)}
                          disabled={isProcessing}
                          className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                        >
                          Analisar
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Ajuste fino opcional da janela grayscale */}
                {controlsOpen && p.status === 'done' && (
                  <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50/50 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-semibold text-teal-900">
                        Janela de pixel grayscale para fios (0 – {sliderValue})
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => analyzeOne(p, null)}
                          disabled={isProcessing}
                          className="text-xs font-semibold text-ink-600 hover:text-ink-900"
                        >
                          Automático
                        </button>
                        <button
                          type="button"
                          onClick={() => analyzeOne(p, sliderValue)}
                          disabled={isProcessing}
                          className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-700"
                        >
                          <RefreshCw size={12} /> Reanalisar
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={30}
                      max={210}
                      value={sliderValue}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setPhotos((prev) =>
                          prev.map((x) => (x.id === p.id ? { ...x, customGrayMax: val } : x)),
                        );
                      }}
                      className="w-full accent-teal-600"
                    />
                    <div className="flex justify-between text-[11px] text-teal-700 mt-1">
                      <span>Mais restrito (apenas fios muito escuros)</span>
                      <span>Mais sensível (inclui fios claros/vellus)</span>
                    </div>
                  </div>
                )}

                {/* Visualização das máscaras separadas + métricas */}
                {p.status === 'done' ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2.5">
                      <MaskPreviewTile
                        label="Bulbos + Fios"
                        url={p.annotatedPreviewUrl || p.annotatedPhotoUrl || p.previewUrl}
                        onClick={() => openInspector(p, idx)}
                      />
                      <MaskPreviewTile
                        label="Máscara de Fios"
                        url={p.hairMaskPreviewUrl || p.hairMaskUrl || ''}
                        onClick={() => openInspector(p, idx)}
                      />
                      <MaskPreviewTile
                        label="Couro Cabeludo"
                        url={p.scalpMaskPreviewUrl || p.scalpMaskUrl || ''}
                        onClick={() => openInspector(p, idx)}
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <MiniMetric
                        icon={<ScanEye size={13} className="text-rose-500" />}
                        label="Bulbos"
                        value={formatNumber(p.bulbCount)}
                      />
                      <MiniMetric
                        icon={<Sparkles size={13} className="text-teal-600" />}
                        label="Fios detectados"
                        value={formatNumber(p.strandCount)}
                      />
                      <MiniMetric
                        icon={<Ruler size={13} className="text-sky-600" />}
                        label="Espessura média"
                        value={formatThickness(p.avgThicknessPx)}
                      />
                      <MiniMetric
                        icon={<Layers size={13} className="text-brand-600" />}
                        label="Cobertura"
                        value={p.hairCoveragePct != null ? `${formatNumber(p.hairCoveragePct, 1)}%` : '—'}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl bg-ink-50 p-2.5">
                    <div className="h-14 w-14 rounded-lg overflow-hidden bg-ink-100 flex-shrink-0 flex items-center justify-center">
                      {p.previewUrl ? (
                        <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon size={20} className="text-ink-300" />
                      )}
                    </div>
                    <p className="text-xs text-ink-500">
                      Clique em <strong>Analisar fotos</strong> para visualizar as máscaras separadas de fios e couro cabeludo junto com a contagem de bulbos e espessura em pixels.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Resumo consolidado da sessão antes de salvar */}
      {photos.length > 0 && allAnalyzed && (
        <div className="card p-5 mb-6 bg-gradient-to-r from-brand-50/60 to-teal-50/50 border-brand-200/80 animate-fade-in">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 mb-3">
            Resumo consolidado ({photos.length} {photos.length === 1 ? 'imagem analisada' : 'imagens analisadas'})
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-ink-500">Média de bulbos</p>
              <p className="font-display text-xl font-bold text-rose-600">{formatNumber(avgBulbsPreview)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Média de fios</p>
              <p className="font-display text-xl font-bold text-teal-700">{formatNumber(avgStrandsPreview, 1)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Espessura média</p>
              <p className="font-display text-xl font-bold text-sky-700">{formatThickness(avgThicknessPreview)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Cobertura média</p>
              <p className="font-display text-xl font-bold text-brand-700">
                {formatNumber(avgCoveragePreview, 1)}%
              </p>
            </div>
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
        {!allAnalyzed && photos.length > 0 && (
          <button
            type="button"
            onClick={analyzeAllPending}
            className="btn-secondary flex-1"
            disabled={isProcessing}
          >
            {analyzing ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {analyzing ? 'Analisando imagens...' : 'Analisar e pré-visualizar máscaras'}
          </button>
        )}

        <button
          type="button"
          onClick={handleSave}
          className="btn-primary flex-1"
          disabled={isProcessing || photos.length === 0 || !allAssigned}
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          {saving
            ? 'Salvando sessão...'
            : allAnalyzed
              ? 'Salvar sessão no prontuário'
              : 'Analisar e salvar sessão'}
        </button>
      </div>

      <p className="text-xs text-ink-400 mt-4 text-center">
        Data da consulta: {formatDate(sessionDate)} — bulbos, fios, espessura (px) e máscaras serão gravados no banco de dados.
      </p>

      {inspectedPhoto && (
        <PhotoAnalysisModal photo={inspectedPhoto} onClose={() => setInspectedPhoto(null)} />
      )}
    </div>
  );
}

function MaskPreviewTile({
  label,
  url,
  onClick,
}: {
  label: string;
  url: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group overflow-hidden rounded-xl border border-ink-200/80 bg-ink-950 text-left hover:border-brand-400 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        {url ? (
          <img
            src={url}
            alt={label}
            className="h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-ink-400">—</div>
        )}
      </div>
      <div className="bg-white px-2.5 py-1.5 text-[11px] font-semibold text-ink-700 flex items-center justify-between">
        <span>{label}</span>
        <span className="text-brand-600 opacity-0 group-hover:opacity-100 transition-opacity">Ampliar</span>
      </div>
    </button>
  );
}

function MiniMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-ink-50 border border-ink-100 px-3 py-2">
      <p className="text-[11px] text-ink-500 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="font-display text-sm font-bold text-ink-900 mt-0.5">{value}</p>
    </div>
  );
}
