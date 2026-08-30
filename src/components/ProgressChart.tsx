import { useMemo, useState } from 'react';

export interface ChartPoint {
  date: string;
  label: string;
  value: number;
}

interface Props {
  points: ChartPoint[];
}

const W = 760;
const H = 280;
const PAD = { top: 30, right: 30, bottom: 44, left: 56 };

export function ProgressChart({ points }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const { pathD, areaD, coords, yTicks, xLabels } = useMemo(() => {
    if (points.length === 0) {
      return { pathD: '', areaD: '', coords: [] as { x: number; y: number; point: ChartPoint }[], yTicks: [] as number[], xLabels: [] as { x: number; label: string }[] };
    }

    const values = points.map((p) => p.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1;
    const padV = range * 0.15;
    const lo = Math.max(0, minV - padV);
    const hi = maxV + padV;

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const coords = points.map((p, i) => {
      const x = PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
      const y = PAD.top + plotH - ((p.value - lo) / (hi - lo)) * plotH;
      return { x, y, point: p };
    });

    const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
    const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`;

    const tickCount = 5;
    const yTicks = Array.from({ length: tickCount }, (_, i) => Math.round(lo + ((hi - lo) / (tickCount - 1)) * i));

    const xLabels = coords.map((c) => ({ x: c.x, label: c.point.label }));

    return { pathD, areaD, coords, yTicks, xLabels };
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-ink-400">
        <p className="font-medium">No session data yet</p>
        <p className="text-sm mt-1">Start a new session to see progress on the chart.</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto scrollbar-thin">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" style={{ height: 'auto' }}>
        <defs>
          <linearGradient id="chartArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22a163" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#22a163" stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id="chartLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#48bd80" />
            <stop offset="100%" stopColor="#15824f" />
          </linearGradient>
        </defs>

        {/* Y-axis grid lines and labels */}
        {yTicks.map((t, i) => {
          const plotH = H - PAD.top - PAD.bottom;
          const y = PAD.top + plotH - (i / (yTicks.length - 1)) * plotH;
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#eceef2" strokeWidth={1} />
              <text x={PAD.left - 10} y={y + 4} textAnchor="end" className="fill-ink-400" style={{ fontSize: 11, fontWeight: 500 }}>
                {t.toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={H - PAD.bottom + 22} textAnchor="middle" className="fill-ink-400" style={{ fontSize: 11, fontWeight: 500 }}>
            {l.label}
          </text>
        ))}

        {/* Area fill */}
        <path d={areaD} fill="url(#chartArea)" />

        {/* Line */}
        <path d={pathD} fill="none" stroke="url(#chartLine)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* Points */}
        {coords.map((c, i) => (
          <g key={i}>
            <circle
              cx={c.x}
              cy={c.y}
              r={hover === i ? 7 : 5}
              fill="white"
              stroke="#15824f"
              strokeWidth={2.5}
              className="transition-all"
            />
            <rect
              x={c.x - 20}
              y={c.y - 20}
              width={40}
              height={40}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'pointer' }}
            />
          </g>
        ))}

        {/* Tooltip */}
        {hover !== null && coords[hover] && (
          <g style={{ pointerEvents: 'none' }}>
            {(() => {
              const c = coords[hover];
              const tw = 90;
              const th = 36;
              const tx = Math.min(Math.max(c.x - tw / 2, PAD.left), W - PAD.right - tw);
              const ty = Math.max(c.y - th - 12, PAD.top);
              return (
                <>
                  <rect x={tx} y={ty} width={tw} height={th} rx={8} fill="#1f2433" opacity={0.95} />
                  <text x={tx + tw / 2} y={ty + 15} textAnchor="middle" className="fill-white" style={{ fontSize: 11, fontWeight: 600 }}>
                    {c.point.value.toLocaleString()} hairs
                  </text>
                  <text x={tx + tw / 2} y={ty + 28} textAnchor="middle" className="fill-ink-300" style={{ fontSize: 10 }}>
                    {c.point.label}
                  </text>
                </>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
}
