import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatNumber } from '@/lib/formatters';

interface Props {
  delta: number | null;
  deltaPct: number | null;
  /** Falso quando há um único ponto: sem base de comparação, nada de cor nem seta. */
  hasComparison: boolean;
  size?: number;
  showAbsolute?: boolean;
}

/**
 * Tendência entre a primeira e a última sessão.
 * Sem duas sessões não existe tendência — nesse caso o badge fica neutro,
 * em vez de pintar de verde um "+0,0%" que não significa nada.
 */
export function TrendBadge({ delta, deltaPct, hasComparison, size = 16, showAbsolute = false }: Props) {
  if (!hasComparison || delta == null) {
    return (
      <span
        className="inline-flex items-center gap-1 text-sm font-semibold text-ink-400"
        title="É preciso ao menos duas sessões para comparar"
      >
        <Minus size={size} /> sem comparação
      </span>
    );
  }

  const tone = delta > 0 ? 'text-brand-600' : delta < 0 ? 'text-red-500' : 'text-ink-400';
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const sign = delta > 0 ? '+' : '';

  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${tone}`}>
      <Icon size={size} />
      {deltaPct != null ? `${sign}${deltaPct.toFixed(1)}%` : `${sign}${formatNumber(delta)}`}
      {showAbsolute && <span className="text-ink-400 font-medium">({sign}{formatNumber(delta)})</span>}
    </span>
  );
}
