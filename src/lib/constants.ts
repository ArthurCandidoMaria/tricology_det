import type { ScalpArea } from './types';

export const SCALP_AREAS: { value: ScalpArea; label: string; description: string }[] = [
  { value: 'frontal', label: 'Frontal', description: 'Linha frontal' },
  { value: 'temporal-left', label: 'Temporal (E)', description: 'Templo esquerdo' },
  { value: 'temporal-right', label: 'Temporal (D)', description: 'Templo direito' },
  { value: 'vertex', label: 'Vértice', description: 'Topo do couro cabeludo' },
  { value: 'crown', label: 'Coroa', description: 'Parte posterior do topo' },
  { value: 'parietal-left', label: 'Parietal (E)', description: 'Lado esquerdo' },
  { value: 'parietal-right', label: 'Parietal (D)', description: 'Lado direito' },
  { value: 'occipital-donor', label: 'Occipital doador', description: 'Área doadora' },
];

export const SCALP_AREA_LABELS: Record<ScalpArea, string> = SCALP_AREAS.reduce(
  (acc, a) => ({ ...acc, [a.value]: a.label }),
  {} as Record<ScalpArea, string>,
);

export const STORAGE_BUCKET = 'session-photos';
