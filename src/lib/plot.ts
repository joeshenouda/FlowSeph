import type { AxisScaleMode, LogicleSettings, PlotType } from '../store/types';

export interface Domain {
  min: number;
  max: number;
}

const LN10 = Math.log(10);

const LOGICLE_T = 1_000_000;
const DEFAULT_LOGICLE_SETTINGS: LogicleSettings = {
  m: 4.5,
  w: 1,
  a: 0
};

interface AxisTransformOptions {
  scaleMode?: AxisScaleMode;
  logicle?: LogicleSettings;
}

function shouldUseLogicle(channelName: string, scaleMode?: AxisScaleMode): boolean {
  if (scaleMode === 'linear') {
    return false;
  }
  if (scaleMode === 'logicle') {
    return true;
  }
  return isLogAxisChannel(channelName);
}

function resolveLogicle(logicle?: LogicleSettings): LogicleSettings {
  if (!logicle) {
    return DEFAULT_LOGICLE_SETTINGS;
  }

  return {
    m: Math.max(0.5, logicle.m),
    w: Math.max(0, logicle.w),
    a: Math.max(0, logicle.a)
  };
}

function logicleCoefficients(settings?: LogicleSettings): {
  base: number;
  posScale: number;
  negScale: number;
} {
  const logicle = resolveLogicle(settings);
  const posDecades = Math.max(0.1, logicle.m - logicle.w);
  const base = LOGICLE_T / Math.sinh(posDecades * LN10);
  const posScale = logicle.m / posDecades;
  const negScale = Math.max(0.1, logicle.m + logicle.a) / posDecades;

  return { base, posScale, negScale };
}

export function isLogAxisChannel(channelName: string): boolean {
  const normalized = channelName.trim().toLowerCase();
  return !normalized.includes('fsc') && !normalized.includes('fcs') && !normalized.includes('ssc');
}

export function toAxisSpace(value: number, channelName: string, options?: AxisTransformOptions): number {
  if (!shouldUseLogicle(channelName, options?.scaleMode)) {
    return value;
  }

  const coeff = logicleCoefficients(options?.logicle);

  // Logicle-like mapping: near-linear around 0 and log-like in tails.
  if (value >= 0) {
    return (coeff.posScale * Math.asinh(value / coeff.base)) / LN10;
  }

  return (-coeff.negScale * Math.asinh(Math.abs(value) / coeff.base)) / LN10;
}

export function fromAxisSpace(value: number, channelName: string, options?: AxisTransformOptions): number {
  if (!shouldUseLogicle(channelName, options?.scaleMode)) {
    return value;
  }

  const coeff = logicleCoefficients(options?.logicle);

  if (value >= 0) {
    return coeff.base * Math.sinh((value / coeff.posScale) * LN10);
  }

  return -coeff.base * Math.sinh((Math.abs(value) / coeff.negScale) * LN10);
}

export function mapValuesToAxisSpace(values: Float32Array, channelName: string, options?: AxisTransformOptions): Float32Array {
  if (!shouldUseLogicle(channelName, options?.scaleMode)) {
    return values;
  }

  const mapped = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    mapped[i] = toAxisSpace(values[i], channelName, options);
  }
  return mapped;
}

export function computeDomain(values: Float32Array, mask?: Uint8Array | null): Domain {
  const length = mask ? Math.min(values.length, mask.length) : values.length;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < length; i += 1) {
    if (mask && mask[i] !== 1) {
      continue;
    }

    const value = values[i];
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }

  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }

  return { min, max };
}

export function computePercentileDomain(
  values: Float32Array,
  mask: Uint8Array | null | undefined,
  qLow = 0.001,
  qHigh = 0.999,
  paddingFraction = 0.03
): Domain {
  const length = mask ? Math.min(values.length, mask.length) : values.length;
  const selected: number[] = [];

  for (let i = 0; i < length; i += 1) {
    if (mask && mask[i] !== 1) {
      continue;
    }
    const value = values[i];
    if (Number.isFinite(value)) {
      selected.push(value);
    }
  }

  if (selected.length === 0) {
    return { min: 0, max: 1 };
  }

  selected.sort((a, b) => a - b);

  const lowQ = Math.max(0, Math.min(qLow, 1));
  const highQ = Math.max(lowQ, Math.min(qHigh, 1));
  const lowIndex = Math.floor((selected.length - 1) * lowQ);
  const highIndex = Math.ceil((selected.length - 1) * highQ);

  let min = selected[Math.max(0, Math.min(selected.length - 1, lowIndex))];
  let max = selected[Math.max(0, Math.min(selected.length - 1, highIndex))];

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }

  if (min === max) {
    const spread = Math.max(1, Math.abs(min) * 0.01);
    return { min: min - spread, max: max + spread };
  }

  const span = max - min;
  const pad = span * Math.max(0, paddingFraction);
  min -= pad;
  max += pad;

  return { min, max };
}

export function toPixel(value: number, domain: Domain, size: number): number {
  return ((value - domain.min) / (domain.max - domain.min)) * (size - 1);
}

export function toData(pixel: number, domain: Domain, size: number): number {
  return domain.min + (pixel / (size - 1)) * (domain.max - domain.min);
}

export function paletteColor(
  palette: 'cyan' | 'heat' | 'viridis' | 'orange',
  ratio: number,
  alpha = 1
): string {
  const clamped = Math.max(0, Math.min(1, ratio));

  const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

  if (palette === 'cyan') {
    const g = Math.floor(120 + 120 * clamped);
    const b = Math.floor(180 + 70 * clamped);
    return `rgba(80, ${g}, ${b}, ${alpha})`;
  }

  if (palette === 'heat') {
    // Blue -> cyan -> green -> yellow -> red
    const stops: Array<[number, number, number, number]> = [
      [0, 24, 36, 255],
      [0.25, 0, 180, 255],
      [0.5, 0, 255, 100],
      [0.75, 255, 255, 0],
      [1, 255, 40, 0]
    ];

    let from = stops[0];
    let to = stops[stops.length - 1];

    for (let i = 0; i < stops.length - 1; i += 1) {
      if (clamped >= stops[i][0] && clamped <= stops[i + 1][0]) {
        from = stops[i];
        to = stops[i + 1];
        break;
      }
    }

    const span = to[0] - from[0] || 1;
    const t = (clamped - from[0]) / span;
    const r = lerp(from[1], to[1], t);
    const g = lerp(from[2], to[2], t);
    const b = lerp(from[3], to[3], t);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  if (palette === 'viridis') {
    const r = Math.floor(60 + 180 * clamped);
    const g = Math.floor(10 + 240 * clamped);
    const b = Math.floor(80 + 110 * (1 - clamped));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const r = Math.floor(190 + 65 * clamped);
  const g = Math.floor(70 + 100 * clamped);
  const b = Math.floor(20 + 30 * clamped);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildThumbnailCacheKey(params: {
  sampleId: string;
  populationId: string;
  xChannel: string;
  yChannel: string;
  plotType: PlotType;
  palette: string;
  backgroundColor: string;
  smooth: boolean;
  processingSignature: string;
}): string {
  return [
    params.sampleId,
    params.populationId,
    params.xChannel,
    params.yChannel,
    params.plotType,
    params.palette,
    params.backgroundColor,
    params.smooth ? 'smooth:1' : 'smooth:0',
    params.processingSignature
  ].join('|');
}

export function buildGateMaskKey(params: {
  sampleId: string;
  populationId: string;
  version: number;
  processingSignature: string;
}): string {
  return `${params.sampleId}|${params.populationId}|v${params.version}|${params.processingSignature}`;
}
