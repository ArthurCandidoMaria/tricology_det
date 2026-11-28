import type { AnalysisResult, Patient, SessionPhoto, SessionWithPhotos } from './types';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.detail || body?.message || 'Erro ao comunicar com o servidor.');
  }
  return body as T;
}

export async function listPatients(): Promise<Patient[]> {
  return request<Patient[]>('/api/patients');
}

export async function createPatient(payload: {
  name: string;
  date_of_birth?: string | null;
  cpf?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}): Promise<Patient> {
  return request<Patient>('/api/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updatePatient(
  patientId: string,
  payload: Partial<Pick<Patient, 'name' | 'date_of_birth' | 'cpf' | 'phone' | 'email' | 'notes'>>,
): Promise<Patient> {
  return request<Patient>(`/api/patients/${encodeURIComponent(patientId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function listSessionsByPatient(patientId: string): Promise<SessionWithPhotos[]> {
  return request<SessionWithPhotos[]>(`/api/sessions?patient_id=${encodeURIComponent(patientId)}`);
}

export async function createSession(payload: {
  patient_id: string;
  session_date: string;
  total_hairs: number | null;
  avg_strands?: number | null;
  avg_thickness_px?: number | null;
  avg_coverage_pct?: number | null;
  notes?: string | null;
  photos?: Array<{
    scalp_area: string;
    photo_url: string;
    annotated_photo_url?: string | null;
    hair_mask_url?: string | null;
    scalp_mask_url?: string | null;
    hair_count: number | null;
    strand_count?: number | null;
    avg_thickness_px?: number | null;
    hair_coverage_pct?: number | null;
    gray_threshold?: number | null;
  }>;
}): Promise<SessionWithPhotos> {
  return request<SessionWithPhotos>('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function addSessionPhoto(payload: {
  session_id: string;
  scalp_area: string;
  photo_url: string;
  annotated_photo_url?: string | null;
  hair_mask_url?: string | null;
  scalp_mask_url?: string | null;
  hair_count: number | null;
  strand_count?: number | null;
  avg_thickness_px?: number | null;
  hair_coverage_pct?: number | null;
  gray_threshold?: number | null;
}): Promise<SessionPhoto> {
  return request<SessionPhoto>('/api/session_photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteSession(sessionId: string): Promise<{ deleted: boolean; id: string }> {
  return request<{ deleted: boolean; id: string }>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export async function deleteSessionPhoto(photoId: string): Promise<{ deleted: boolean; id: string }> {
  return request<{ deleted: boolean; id: string }>(`/api/session_photos/${encodeURIComponent(photoId)}`, {
    method: 'DELETE',
  });
}

export async function analyzeImage(
  file: File,
  options?: {
    sessionId?: string;
    scalpArea?: string;
    patientId?: string;
    hairGrayMax?: number | null;
  },
): Promise<AnalysisResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (options?.sessionId) formData.append('session_id', options.sessionId);
  if (options?.scalpArea) formData.append('scalp_area', options.scalpArea);
  if (options?.patientId) formData.append('patient_id', options.patientId);
  if (options?.hairGrayMax != null) formData.append('hair_gray_max', String(Math.round(options.hairGrayMax)));

  return request<AnalysisResult>('/api/analyze', {
    method: 'POST',
    body: formData,
  });
}
