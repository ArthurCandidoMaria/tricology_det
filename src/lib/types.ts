export interface Patient {
  id: string;
  name: string;
  date_of_birth: string | null;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  session_count?: number;
  last_session_date?: string | null;
}

export interface Session {
  id: string;
  patient_id: string;
  session_date: string;
  /** Média de bulbos/unidades foliculares detectados via origem/tracking de fios na sessão */
  total_hairs: number | null;
  /** Média de fios capilares detectados pela segmentação em grayscale */
  avg_strands: number | null;
  /** Espessura média dos fios em pixels */
  avg_thickness_px: number | null;
  /** Percentual médio de cobertura capilar na imagem */
  avg_coverage_pct: number | null;
  notes: string | null;
  created_at: string;
}

export interface SessionPhoto {
  id: string;
  session_id: string;
  scalp_area: string;
  photo_url: string;
  annotated_photo_url?: string | null;
  hair_mask_url?: string | null;
  scalp_mask_url?: string | null;
  /** Contagem de bulbos detectados via origem/tracking de fios */
  hair_count: number | null;
  /** Contagem de fios detectados na segmentação em escala de cinza */
  strand_count?: number | null;
  /** Espessura média dos fios em pixels */
  avg_thickness_px?: number | null;
  /** Cobertura capilar em % */
  hair_coverage_pct?: number | null;
  /** Limiar de intensidade grayscale aplicado para separar fios do couro cabeludo */
  gray_threshold?: number | null;
  created_at: string;
}

export interface SessionWithPhotos extends Session {
  session_photos: SessionPhoto[];
}

export type ScalpArea =
  | 'frontal'
  | 'temporal-left'
  | 'temporal-right'
  | 'vertex'
  | 'crown'
  | 'parietal-left'
  | 'parietal-right'
  | 'occipital-donor';

export interface DetectionBox {
  class: string;
  confidence: number;
  bbox: [number, number, number, number];
}

export interface AnalysisResult {
  count: number;
  bulb_count: number;
  detections: DetectionBox[];
  strand_count: number;
  avg_thickness_px: number;
  median_thickness_px: number;
  hair_coverage_pct: number;
  gray_threshold: number;
  scalp_gray_median: number;
  hair_gray_median: number;
  image_width: number;
  image_height: number;
  original_photo_url: string;
  annotated_photo_url: string;
  annotated_image_data_url?: string;
  hair_mask_url: string;
  hair_mask_data_url?: string;
  scalp_mask_url: string;
  scalp_mask_data_url?: string;
  model_used?: string;
}

export interface PendingPhoto {
  id: string;
  file: File;
  previewUrl: string;
  originalPhotoUrl?: string | null;
  annotatedPreviewUrl?: string | null;
  annotatedPhotoUrl?: string | null;
  hairMaskPreviewUrl?: string | null;
  hairMaskUrl?: string | null;
  scalpMaskPreviewUrl?: string | null;
  scalpMaskUrl?: string | null;
  scalpArea: ScalpArea | '';
  /** Contagem de bulbos (origem/tracking de fios) */
  bulbCount: number | null;
  /** Contagem de fios detectados (grayscale) */
  strandCount: number | null;
  /** Espessura média dos fios em pixels */
  avgThicknessPx: number | null;
  /** Percentual de cobertura capilar */
  hairCoveragePct: number | null;
  /** Limiar grayscale aplicado */
  grayThreshold: number | null;
  /** Mediana grayscale do couro cabeludo */
  scalpGrayMedian: number | null;
  /** Mediana grayscale dos fios */
  hairGrayMedian: number | null;
  /** Override manual opcional da janela grayscale (0..255) */
  customGrayMax: number | null;
  status: 'pending' | 'processing' | 'done';
}
