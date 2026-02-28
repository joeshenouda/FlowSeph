import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
  ComputeDensity2DResult,
  ComputeGateMaskResult,
  DownsamplePointsResult
} from './analysis.types';

const CHUNK_SIZE = 50000;
const cancelledJobs = new Set<string>();

function send(message: AnalysisWorkerResponse): void {
  postMessage(message);
}

function shouldCancel(jobId: string): boolean {
  return cancelledJobs.has(jobId);
}

function seedFromString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRng(seed: string): () => number {
  let state = seedFromString(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function computeGateMask(request: Extract<AnalysisWorkerRequest, { type: 'computeGateMask' }>): ComputeGateMaskResult | null {
  const { jobId, payload } = request;
  const count = Math.min(payload.xValues.length, payload.yValues.length);
  const mask = new Uint8Array(count);

  for (let start = 0; start < count; start += CHUNK_SIZE) {
    if (shouldCancel(jobId)) {
      return null;
    }

    const end = Math.min(count, start + CHUNK_SIZE);

    for (let i = start; i < end; i += 1) {
      if (payload.parentMask && payload.parentMask[i] !== 1) {
        continue;
      }

      const x = payload.xValues[i];
      const y = payload.yValues[i];
      let inside = false;

      switch (payload.gate.kind) {
        case 'rectangle':
          inside = x >= payload.gate.xMin && x <= payload.gate.xMax && y >= payload.gate.yMin && y <= payload.gate.yMax;
          break;
        case 'polygon':
          inside = pointInPolygon(x, y, payload.gate.points);
          break;
        case 'quadrant': {
          const q = payload.gate.quadrant;
          const xHigh = x >= payload.gate.xThreshold;
          const yHigh = y >= payload.gate.yThreshold;
          inside =
            (q === 'Q1' && xHigh && yHigh) ||
            (q === 'Q2' && !xHigh && yHigh) ||
            (q === 'Q3' && !xHigh && !yHigh) ||
            (q === 'Q4' && xHigh && !yHigh);
          break;
        }
        case 'ellipse': {
          const dx = x - payload.gate.cx;
          const dy = y - payload.gate.cy;
          const cos = Math.cos(-payload.gate.rotation);
          const sin = Math.sin(-payload.gate.rotation);
          const xr = dx * cos - dy * sin;
          const yr = dx * sin + dy * cos;
          const norm = (xr * xr) / (payload.gate.rx * payload.gate.rx) + (yr * yr) / (payload.gate.ry * payload.gate.ry);
          inside = norm <= 1;
          break;
        }
      }

      if (inside) {
        mask[i] = 1;
      }
    }

    send({
      type: 'progress',
      jobId,
      progress: end / count
    });
  }

  return { mask };
}

function computeMinMaxDomain(values: Float32Array, mask?: Uint8Array | null): [number, number] {
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
    return [0, 1];
  }

  if (min === max) {
    return [min - 1, max + 1];
  }

  return [min, max];
}

function computePercentileDomain(
  values: Float32Array,
  mask?: Uint8Array | null,
  qLow = 0.001,
  qHigh = 0.999,
  paddingFraction = 0.03
): [number, number] {
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
    return [0, 1];
  }

  selected.sort((a, b) => a - b);

  const lowQ = Math.max(0, Math.min(1, qLow));
  const highQ = Math.max(lowQ, Math.min(1, qHigh));
  const lowIndex = Math.floor((selected.length - 1) * lowQ);
  const highIndex = Math.ceil((selected.length - 1) * highQ);

  let min = selected[Math.max(0, Math.min(selected.length - 1, lowIndex))];
  let max = selected[Math.max(0, Math.min(selected.length - 1, highIndex))];

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }

  if (min === max) {
    const spread = Math.max(1, Math.abs(min) * 0.01);
    return [min - spread, max + spread];
  }

  const span = max - min;
  const pad = span * Math.max(0, paddingFraction);
  min -= pad;
  max += pad;

  return [min, max];
}

function smoothDensity(grid: Float32Array<ArrayBuffer>, width: number, height: number): Float32Array<ArrayBuffer> {
  const output = new Float32Array(grid.length) as Float32Array<ArrayBuffer>;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;

      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          sum += grid[ny * width + nx];
          count += 1;
        }
      }

      output[y * width + x] = count > 0 ? sum / count : 0;
    }
  }

  return output;
}

function computeDensity2D(request: Extract<AnalysisWorkerRequest, { type: 'computeDensity2D' }>): ComputeDensity2DResult | null {
  const { jobId, payload } = request;
  const count = Math.min(payload.xValues.length, payload.yValues.length);
  const qLow = payload.qLow ?? 0.001;
  const qHigh = payload.qHigh ?? 0.999;
  const domainPadding = payload.domainPadding ?? 0.03;

  const computedXMinMax = computeMinMaxDomain(payload.xValues, payload.mask);
  const computedYMinMax = computeMinMaxDomain(payload.yValues, payload.mask);
  const computedXDomain = computePercentileDomain(payload.xValues, payload.mask, qLow, qHigh, domainPadding);
  const computedYDomain = computePercentileDomain(payload.yValues, payload.mask, qLow, qHigh, domainPadding);

  let xDomain = payload.xDomain ?? computedXDomain;
  let yDomain = payload.yDomain ?? computedYDomain;

  const computedXSpan = Math.abs(computedXDomain[1] - computedXDomain[0]);
  const computedYSpan = Math.abs(computedYDomain[1] - computedYDomain[0]);
  const providedXSpan = Math.abs(xDomain[1] - xDomain[0]);
  const providedYSpan = Math.abs(yDomain[1] - yDomain[0]);

  const xOverlap = Math.max(0, Math.min(xDomain[1], computedXDomain[1]) - Math.max(xDomain[0], computedXDomain[0]));
  const yOverlap = Math.max(0, Math.min(yDomain[1], computedYDomain[1]) - Math.max(yDomain[0], computedYDomain[0]));
  const xOverlapRatio = computedXSpan > 0 ? xOverlap / computedXSpan : 0;
  const yOverlapRatio = computedYSpan > 0 ? yOverlap / computedYSpan : 0;

  const xSpanMismatch =
    payload.xDomain &&
    computedXSpan > 0 &&
    providedXSpan > 0 &&
    (providedXSpan / computedXSpan > 100 || computedXSpan / providedXSpan > 100) &&
    xOverlapRatio < 0.0001;
  const ySpanMismatch =
    payload.yDomain &&
    computedYSpan > 0 &&
    providedYSpan > 0 &&
    (providedYSpan / computedYSpan > 100 || computedYSpan / providedYSpan > 100) &&
    yOverlapRatio < 0.0001;

  if (!Number.isFinite(providedXSpan) || providedXSpan <= 0 || xSpanMismatch) {
    xDomain = computedXDomain;
  }
  if (!Number.isFinite(providedYSpan) || providedYSpan <= 0 || ySpanMismatch) {
    yDomain = computedYDomain;
  }

  const xSpan = xDomain[1] - xDomain[0];
  const ySpan = yDomain[1] - yDomain[0];
  const grid = new Float32Array(payload.width * payload.height) as Float32Array<ArrayBuffer>;
  let pointsIncluded = 0;
  let pointsSkippedByDomain = 0;
  let pointsSkippedByMask = 0;

  if (xSpan <= 0 || ySpan <= 0) {
    return {
      grid,
      width: payload.width,
      height: payload.height,
      xDomain,
      yDomain,
      maxDensity: 0
    };
  }

  for (let start = 0; start < count; start += CHUNK_SIZE) {
    if (shouldCancel(jobId)) {
      return null;
    }

    const end = Math.min(count, start + CHUNK_SIZE);

    for (let i = start; i < end; i += 1) {
      if (payload.mask && payload.mask[i] !== 1) {
        pointsSkippedByMask += 1;
        continue;
      }

      const x = payload.xValues[i];
      const y = payload.yValues[i];
      if (x < xDomain[0] || x > xDomain[1] || y < yDomain[0] || y > yDomain[1]) {
        pointsSkippedByDomain += 1;
        continue;
      }
      const px = Math.max(0, Math.min(payload.width - 1, Math.floor(((x - xDomain[0]) / xSpan) * (payload.width - 1))));
      const py = Math.max(0, Math.min(payload.height - 1, Math.floor(((y - yDomain[0]) / ySpan) * (payload.height - 1))));
      grid[py * payload.width + px] += 1;
      pointsIncluded += 1;
    }

    send({ type: 'progress', jobId, progress: end / count });
  }

  let resultGrid = grid;
  if (payload.smooth) {
    resultGrid = smoothDensity(resultGrid, payload.width, payload.height);
    resultGrid = smoothDensity(resultGrid, payload.width, payload.height);
  }

  let maxDensityRaw = 0;
  for (let i = 0; i < resultGrid.length; i += 1) {
    if (resultGrid[i] > maxDensityRaw) {
      maxDensityRaw = resultGrid[i];
    }
  }

  for (let i = 0; i < resultGrid.length; i += 1) {
    resultGrid[i] = Math.log1p(resultGrid[i]);
  }

  let maxDensity = 0;
  for (let i = 0; i < resultGrid.length; i += 1) {
    if (resultGrid[i] > maxDensity) {
      maxDensity = resultGrid[i];
    }
  }

  if (payload.debug) {
    // eslint-disable-next-line no-console
    console.log('[density-debug]', {
      xValuesMinMax: computedXMinMax,
      yValuesMinMax: computedYMinMax,
      xValuesPercentileDomain: computedXDomain,
      yValuesPercentileDomain: computedYDomain,
      xDomainUsed: xDomain,
      yDomainUsed: yDomain,
      xDomainFallback: Boolean(xSpanMismatch),
      yDomainFallback: Boolean(ySpanMismatch),
      pointsIncluded,
      pointsSkippedByDomain,
      pointsSkippedByMask,
      maxBinCountBeforeLog1p: maxDensityRaw,
      maxBinCountAfterLog1p: maxDensity
    });
  }

  return {
    grid: resultGrid,
    width: payload.width,
    height: payload.height,
    xDomain,
    yDomain,
    maxDensity
  };
}

function downsamplePoints(request: Extract<AnalysisWorkerRequest, { type: 'downsamplePoints' }>): DownsamplePointsResult | null {
  const { jobId, payload } = request;
  const count = Math.min(payload.xValues.length, payload.yValues.length);
  const rng = makeRng(payload.seed);
  const resultIndices = new Int32Array(payload.maxPoints);
  let selected = 0;
  let eligibleCount = 0;

  for (let start = 0; start < count; start += CHUNK_SIZE) {
    if (shouldCancel(jobId)) {
      return null;
    }

    const end = Math.min(count, start + CHUNK_SIZE);

    for (let i = start; i < end; i += 1) {
      if (payload.mask && payload.mask[i] !== 1) {
        continue;
      }

      if (eligibleCount < payload.maxPoints) {
        resultIndices[selected] = i;
        selected += 1;
      } else {
        const replacement = Math.floor(rng() * (eligibleCount + 1));
        if (replacement < payload.maxPoints) {
          resultIndices[replacement] = i;
        }
      }

      eligibleCount += 1;
    }

    send({ type: 'progress', jobId, progress: end / count });
  }

  const finalCount = Math.min(selected, payload.maxPoints);
  const xValues = new Float32Array(finalCount);
  const yValues = new Float32Array(finalCount);

  for (let i = 0; i < finalCount; i += 1) {
    const idx = resultIndices[i];
    xValues[i] = payload.xValues[idx];
    yValues[i] = payload.yValues[idx];
  }

  return {
    xValues: xValues as Float32Array,
    yValues: yValues as Float32Array
  };
}

self.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  const message = event.data;

  if (message.type === 'cancelJob') {
    cancelledJobs.add(message.jobId);
    return;
  }

  try {
    switch (message.type) {
      case 'computeGateMask': {
        const payload = computeGateMask(message);
        if (!payload) {
          return;
        }
        send({ type: 'result', jobId: message.jobId, task: 'computeGateMask', payload });
        break;
      }
      case 'computeDensity2D': {
        const payload = computeDensity2D(message);
        if (!payload) {
          return;
        }
        send({ type: 'result', jobId: message.jobId, task: 'computeDensity2D', payload });
        break;
      }
      case 'downsamplePoints': {
        const payload = downsamplePoints(message);
        if (!payload) {
          return;
        }
        send({ type: 'result', jobId: message.jobId, task: 'downsamplePoints', payload });
        break;
      }
      default:
        break;
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Unknown worker error';
    send({ type: 'error', jobId: message.jobId, message: messageText });
  } finally {
    cancelledJobs.delete(message.jobId);
  }
};

export {};
