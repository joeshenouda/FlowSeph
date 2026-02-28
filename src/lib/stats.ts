import type { ChannelStatistics } from '../types';

function percentile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) {
    return Number.NaN;
  }

  const clampedQ = Math.max(0, Math.min(1, q));
  const idx = (sortedValues.length - 1) * clampedQ;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = idx - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function calculateChannelStats(values: Float32Array, gateMask?: Uint8Array): ChannelStatistics {
  const selected: number[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  let count = 0;
  let mean = 0;
  let m2 = 0;
  let geoLogSum = 0;
  let geoCount = 0;

  const length = gateMask ? Math.min(values.length, gateMask.length) : values.length;

  for (let i = 0; i < length; i += 1) {
    if (gateMask && gateMask[i] !== 1) {
      continue;
    }

    const value = values[i];
    selected.push(value);

    if (value < min) {
      min = value;
    }

    if (value > max) {
      max = value;
    }

    count += 1;
    const delta = value - mean;
    mean += delta / count;
    const delta2 = value - mean;
    m2 += delta * delta2;

    if (value > 0) {
      geoLogSum += Math.log(value);
      geoCount += 1;
    }
  }

  if (count === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      stdDev: null,
      cvPercent: null,
      p5: null,
      p95: null,
      geometricMean: null
    };
  }

  selected.sort((a, b) => a - b);

  const variance = count > 1 ? m2 / (count - 1) : 0;
  const stdDev = Math.sqrt(Math.max(variance, 0));
  const cvPercent = mean !== 0 ? (stdDev / Math.abs(mean)) * 100 : null;

  return {
    count,
    min,
    max,
    mean,
    median: percentile(selected, 0.5),
    stdDev,
    cvPercent,
    p5: percentile(selected, 0.05),
    p95: percentile(selected, 0.95),
    geometricMean: geoCount > 0 ? Math.exp(geoLogSum / geoCount) : null
  };
}

export function calculatePearsonCorrelation(
  xValues: Float32Array,
  yValues: Float32Array,
  gateMask?: Uint8Array
): { count: number; r: number | null } {
  const countMax = Math.min(xValues.length, yValues.length);

  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < countMax; i += 1) {
    if (gateMask && gateMask[i] !== 1) {
      continue;
    }

    const x = xValues[i];
    const y = yValues[i];
    count += 1;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }

  if (count < 2) {
    return { count, r: null };
  }

  const numerator = count * sumXY - sumX * sumY;
  const termX = count * sumX2 - sumX * sumX;
  const termY = count * sumY2 - sumY * sumY;
  const denominator = Math.sqrt(Math.max(termX, 0) * Math.max(termY, 0));

  if (denominator === 0) {
    return { count, r: null };
  }

  return { count, r: numerator / denominator };
}
