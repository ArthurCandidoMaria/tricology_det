export interface Patient {
  id: string;
  name: string;
  date_of_birth: string | null;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  patient_id: string;
  session_date: string;
  total_hairs: number | null;
  notes: string | null;
  created_at: string;
}

export interface SessionPhoto {
  id: string;
  session_id: string;
  scalp_area: string;
  photo_url: string;
  annotated_photo_url?: string | null;
  hair_count: number | null;
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

export interface PendingPhoto {
  id: string;
  file: File;
  previewUrl: string;
  annotatedPreviewUrl?: string | null;
  annotatedPhotoUrl?: string | null;
  scalpArea: ScalpArea | '';
  hairCount: number | null;
  status: 'pending' | 'processing' | 'done';
}
