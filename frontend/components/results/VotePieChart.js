'use client';

import { useState, useEffect, useId } from 'react';
import { resolveMediaUrl } from '@/lib/media';
import styles from './VotePieChart.module.css';

/**
 * VotePieChart — Premium animated SVG donut chart with candidate photo support.
 *
 * Props:
 *  - data: Array<{ label: string, value: number, color?: string, photo_ref?: string }>
 *  - size?: number (donut diameter in px, default 220)
 *  - showLegend?: boolean (render the ranked legend below the donut, default true)
 */

// Premium palette
const DEFAULT_PALETTE = [
  'var(--fa2i-green)',
  'var(--fa2i-orange)',
  '#2563eb', // blue
  '#9333ea', // purple
  '#0891b2', // cyan
  '#dc2626', // red
  '#ca8a04', // amber
  '#15803d', // deep green
  '#db2777', // pink
  '#475569', // slate
];

export default function VotePieChart({ data = [], size = 220, showLegend = true }) {
  const [mounted, setMounted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const titleId = useId();

  useEffect(() => {
    let reduce = false;
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      reduce = false;
    }
    setReducedMotion(reduce);
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const slices = (data || []).map((d, i) => ({
    label: d.label,
    value: Math.max(0, Number(d.value) || 0),
    color: d.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
    photo_ref: d.photo_ref,
  }));

  const total = slices.reduce((sum, s) => sum + s.value, 0);

  // Geometry
  const strokeWidth = Math.max(16, Math.round(size * 0.14));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const ariaLabel =
    total > 0
      ? `Répartition des votes : ${slices
          .map(
            (s) =>
              `${s.label} ${s.value} vote${s.value !== 1 ? 's' : ''} (${Math.round(
                (s.value / total) * 100
              )}%)`
          )
          .join(', ')}. Total ${total} vote${total !== 1 ? 's' : ''}.`
      : 'Aucun vote enregistré.';

  if (total === 0) {
    return (
      <div className={styles.wrap}>
        <div
          className={styles.emptyDonut}
          style={{ width: size, height: size }}
          role="img"
          aria-label="Aucun vote enregistré"
        >
          <span className={styles.emptyText}>Aucun vote</span>
        </div>
      </div>
    );
  }

  // Build slices with cumulative offsets.
  let cumulative = 0;
  const arcs = slices
    .filter((s) => s.value > 0)
    .map((s, idx) => {
      const fraction = s.value / total;
      const arcLength = fraction * circumference;
      const rotation = (cumulative / total) * 360 - 90;
      cumulative += s.value;
      return { ...s, fraction, arcLength, rotation, originalIndex: idx };
    });

  const showFull = mounted || reducedMotion;

  // Determine leader
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const leader = sorted[0];

  return (
    <div className={styles.wrap}>
      <div className={styles.chartArea}>
        <div className={styles.donutWrap} style={{ width: size, height: size }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-labelledby={titleId}
          >
            <title id={titleId}>{ariaLabel}</title>
            {/* Track */}
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="var(--border-subtle)"
              strokeWidth={strokeWidth}
            />
            {/* Slices */}
            {arcs.map((arc, i) => (
              <circle
                key={`${arc.label}-${i}`}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth={
                  hoveredIndex === arc.originalIndex ? strokeWidth + 4 : strokeWidth
                }
                strokeLinecap="butt"
                strokeDasharray={
                  showFull
                    ? `${arc.arcLength} ${circumference}`
                    : `0 ${circumference}`
                }
                transform={`rotate(${arc.rotation} ${center} ${center})`}
                className={reducedMotion ? '' : styles.slice}
                onMouseEnter={() => setHoveredIndex(arc.originalIndex)}
                onMouseLeave={() => setHoveredIndex(-1)}
                style={{ cursor: 'pointer', transition: reducedMotion ? 'none' : 'stroke-dasharray 0.9s cubic-bezier(0.22, 1, 0.36, 1), stroke-width 0.2s ease' }}
              />
            ))}
          </svg>
          <div className={styles.centerLabel}>
            <span className={styles.centerValue}>{total}</span>
            <span className={styles.centerCaption}>
              vote{total !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Legend with ranking */}
      {showLegend && (
        <div className={styles.legendWrap}>
          <ul className={styles.legend}>
            {sorted.map((s, i) => {
              const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
              const isLeader = i === 0 && s.value > 0;
              return (
                <li
                  key={`${s.label}-${i}`}
                  className={`${styles.legendItem} ${isLeader ? styles.legendLeader : ''}`}
                  onMouseEnter={() => setHoveredIndex(slices.findIndex((sl) => sl.label === s.label))}
                  onMouseLeave={() => setHoveredIndex(-1)}
                >
                  <span className={styles.rank}>{i + 1}</span>
                  <LegendPhoto candidate={s} color={s.color} />
                  <div className={styles.legendInfo}>
                    <span className={styles.legendLabel}>{s.label}</span>
                    <span className={styles.legendValue}>
                      {s.value} vote{s.value !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className={styles.legendPctWrap}>
                    <span className={styles.legendPct} style={{ color: s.color }}>
                      {pct}%
                    </span>
                    <div className={styles.legendBar}>
                      <div
                        className={styles.legendBarFill}
                        style={{ width: `${pct}%`, background: s.color }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function LegendPhoto({ candidate, color }) {
  const [failed, setFailed] = useState(false);
  const initial = (candidate.label || '?').trim().charAt(0).toUpperCase();
  const photoUrl = resolveMediaUrl(candidate.photo_ref);

  if (photoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={candidate.label}
        className={styles.legendPhoto}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className={styles.legendPhotoFallback} style={{ background: color }}>
      {initial}
    </span>
  );
}
