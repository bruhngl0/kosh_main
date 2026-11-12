"use client";

import { useState } from "react";
import { inr, signedInr, type FinanceView } from "./types";

/**
 * Two small SVG charts. Hand-drawn rather than a charting library: they are
 * the only charts in the app and a dependency would outweigh them.
 */

const W = 960;
const H = 250;
const PAD = { top: 14, right: 12, bottom: 24, left: 64 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

/** Round, readable gridline values spanning [min, max] — always including zero. */
function ticks(min: number, max: number, count = 4) {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max, lo + 1);
  const raw = (hi - lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const values: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) values.push(Math.round(v));
  return { values, min: start, max: end };
}

const compact = (value: number) => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(abs % 100_000 ? 1 : 0)}L`;
  if (abs >= 1_000) return `${sign}₹${Math.round(abs / 1_000)}k`;
  return `${sign}₹${abs}`;
};

function Axis({ values, y }: { values: number[]; y: (v: number) => number }) {
  return (
    <g>
      {values.map((value) => (
        <g key={value}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(value)}
            y2={y(value)}
            className={value === 0 ? "chart-zero" : "chart-grid"}
          />
          <text x={PAD.left - 8} y={y(value)} className="chart-label" textAnchor="end" dominantBaseline="middle">
            {compact(value)}
          </text>
        </g>
      ))}
    </g>
  );
}

export function BalanceChart({ daily }: { daily: FinanceView["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const balances = daily.map((d) => d.balance);
  const scale = ticks(Math.min(...balances), Math.max(...balances));
  const x = (i: number) => PAD.left + (daily.length > 1 ? (i / (daily.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;

  const line = daily.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`).join("");
  const area = `${line}L${x(daily.length - 1)},${y(Math.max(scale.min, 0))}L${x(0)},${y(Math.max(scale.min, 0))}Z`;
  const point = hover === null ? null : daily[hover];

  return (
    <div className="finance-chart">
      <div className="finance-chart-readout">
        {point ? (
          <>
            Day {point.day} · <b className={point.balance < 0 ? "money-out" : ""}>{signedInr(point.balance)}</b>
          </>
        ) : (
          "Hover the line for a day's balance"
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Daily running balance for the month"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - box.left) / box.width) * W;
          const i = Math.round(((px - PAD.left) / plotW) * (daily.length - 1));
          setHover(Math.max(0, Math.min(daily.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id="balance-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--copper)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--copper)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <Axis values={scale.values} y={y} />
        <path d={area} fill="url(#balance-fill)" />
        <path d={line} className="chart-line" />
        {daily.map((d, i) =>
          i % 5 === 0 || i === daily.length - 1 ? (
            <text key={d.day} x={x(i)} y={H - 6} className="chart-label" textAnchor="middle">
              {d.day}
            </text>
          ) : null,
        )}
        {point && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="chart-cursor" />
            <circle cx={x(hover)} cy={y(point.balance)} r={4} className={point.balance < 0 ? "chart-dot-neg" : "chart-dot"} />
          </g>
        )}
      </svg>
    </div>
  );
}

export function WeeklyChart({ weeks }: { weeks: FinanceView["weeks"] }) {
  const scale = ticks(0, Math.max(...weeks.flatMap((w) => [w.income, w.expenses])));
  const y = (v: number) => PAD.top + plotH - (v / scale.max) * plotH;
  const band = plotW / weeks.length;
  const bar = Math.min(28, band / 3);

  return (
    <div className="finance-chart">
      <div className="finance-chart-readout finance-legend">
        <span><i className="legend-in" /> Income</span>
        <span><i className="legend-out" /> Expenses</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Income and expenses by week">
        <Axis values={scale.values} y={y} />
        {weeks.map((week, i) => {
          const cx = PAD.left + band * i + band / 2;
          return (
            <g key={week.start}>
              <rect x={cx - bar - 1} y={y(week.income)} width={bar} height={y(0) - y(week.income)} rx={3} className="bar-in">
                <title>{`${week.start}–${week.end}: income ${inr(week.income)}`}</title>
              </rect>
              <rect x={cx + 1} y={y(week.expenses)} width={bar} height={y(0) - y(week.expenses)} rx={3} className="bar-out">
                <title>{`${week.start}–${week.end}: expenses ${inr(week.expenses)}`}</title>
              </rect>
              <text x={cx} y={H - 6} className="chart-label" textAnchor="middle">
                {week.start}–{week.end}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
