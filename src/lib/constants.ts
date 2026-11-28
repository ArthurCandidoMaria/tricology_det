import type { ScalpArea } from './types';

export const SCALP_AREAS: { value: ScalpArea; label: string; description: string }[] = [
  { value: 'frontal', label: 'Frontal', description: 'Linha frontal' },
  { value: 'temporal-left', label: 'Temporal (E)', description: 'Região temporal esquerda' },
  { value: 'temporal-right', label: 'Temporal (D)', description: 'Região temporal direita' },
  { value: 'vertex', label: 'Vértice', description: 'Topo do couro cabeludo' },
  { value: 'crown', label: 'Coroa', description: 'Parte posterior do topo' },
  { value: 'parietal-left', label: 'Parietal (E)', description: 'Lateral esquerda' },
  { value: 'parietal-right', label: 'Parietal (D)', description: 'Lateral direita' },
  { value: 'occipital-donor', label: 'Occipital', description: 'Região occipital / área doadora' },
];

const AREA_LABELS = new Map<string, string>(SCALP_AREAS.map((a) => [a.value as string, a.label]));

export function areaLabel(area: string): string {
  return AREA_LABELS.get(area) ?? area;
}
