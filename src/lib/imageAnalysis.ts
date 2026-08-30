export interface YOLOAnalysisResponse {
  count: number;
  detections: Array<{
    class: string;
    confidence: number;
    bbox: [number, number, number, number];
  }>;
  annotated_image_data_url?: string;
  annotated_photo_url?: string | null;
  storage_url?: string | null;
}

export async function analyzeImageWithAnnotations(file: File): Promise<YOLOAnalysisResponse> {
  const apiUrl = import.meta.env.VITE_ANALYSIS_API_URL || 'http://localhost:8000';
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${apiUrl}/api/analyze`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Não foi possível analisar a imagem.');
  }

  return response.json() as Promise<YOLOAnalysisResponse>;
}

export async function analyzeImage(file: File): Promise<number> {
  const result = await analyzeImageWithAnnotations(file);
  return Number(result.count ?? 0);
}
