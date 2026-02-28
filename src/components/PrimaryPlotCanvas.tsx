import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { analysisClient } from '../workers/analysisClient';
import {
  buildGateMaskKey,
  computeDomain,
  computePercentileDomain,
  fromAxisSpace,
  isLogAxisChannel,
  mapValuesToAxisSpace,
  paletteColor,
  toAxisSpace,
  toData,
  toPixel,
  type Domain
} from '../lib/plot';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import type { AxisScaleMode, GateDefinition, LogicleSettings } from '../store/types';

interface Point {
  x: number;
  y: number;
}

const AXIS_TICK_COUNT = 6;
const DENSITY_Q_LOW = 0.001;
const DENSITY_Q_HIGH = 0.999;
const DENSITY_DOMAIN_PADDING = 0.03;
const PSEUDOCOLOR_MIN_VISIBLE_RATIO = 0.02;
const axisFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const axisCompactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function buildLinearTicks(domain: Domain, count = AXIS_TICK_COUNT): number[] {
  const tickCount = Math.max(2, count);
  const range = domain.max - domain.min;
  const step = range / (tickCount - 1);
  const ticks: number[] = [];

  for (let i = 0; i < tickCount; i += 1) {
    ticks.push(domain.min + step * i);
  }

  return ticks;
}

function formatAxisTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return axisCompactFormatter.format(value);
  }
  if (abs >= 10) {
    return Math.round(value).toString();
  }
  return axisFormatter.format(value);
}

function formatAxisTickForChannel(
  value: number,
  channelName: string,
  scaleMode: AxisScaleMode,
  logicle: LogicleSettings
): string {
  if (!isLogAxisChannel(channelName) && scaleMode !== 'logicle') {
    return formatAxisTick(value);
  }

  const intensity = fromAxisSpace(value, channelName, { scaleMode, logicle });
  if (!Number.isFinite(intensity)) {
    return '-';
  }

  const abs = Math.abs(intensity);
  if (abs >= 100000 || (abs > 0 && abs < 0.1)) {
    return intensity.toExponential(1);
  }

  return formatAxisTick(intensity);
}

function drawAxisTicks(
  ctx: CanvasRenderingContext2D,
  xDomain: Domain,
  yDomain: Domain,
  width: number,
  height: number,
  xAxisChannel: string,
  yAxisChannel: string,
  xScaleMode: AxisScaleMode,
  yScaleMode: AxisScaleMode,
  logicle: LogicleSettings
): void {
  const xTicks = buildLinearTicks(xDomain);
  const yTicks = buildLinearTicks(yDomain);

  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.7)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(226, 232, 240, 0.95)';
  ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';

  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, height);
  ctx.moveTo(0, height - 0.5);
  ctx.lineTo(width, height - 0.5);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tick of xTicks) {
    const pixelX = toPixel(tick, xDomain, width);
    const label = formatAxisTickForChannel(tick, xAxisChannel, xScaleMode, logicle);
    const textWidth = ctx.measureText(label).width;
    const safeX = Math.max(textWidth / 2 + 4, Math.min(width - textWidth / 2 - 4, pixelX));
    const labelY = height - 14;

    ctx.beginPath();
    ctx.moveTo(pixelX, height - 0.5);
    ctx.lineTo(pixelX, height - 6.5);
    ctx.stroke();

    ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.fillRect(safeX - textWidth / 2 - 2, labelY - 1, textWidth + 4, 12);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.95)';
    ctx.fillText(label, safeX, labelY);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const tick of yTicks) {
    const pixelY = height - 1 - toPixel(tick, yDomain, height);
    const label = formatAxisTickForChannel(tick, yAxisChannel, yScaleMode, logicle);
    const safeY = Math.max(7, Math.min(height - 7, pixelY));
    const textWidth = ctx.measureText(label).width;

    ctx.beginPath();
    ctx.moveTo(0.5, pixelY);
    ctx.lineTo(6.5, pixelY);
    ctx.stroke();

    ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.fillRect(8, safeY - 6, textWidth + 4, 12);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.95)';
    ctx.fillText(label, 10, safeY);
  }

  ctx.restore();
}

function defaultViewDomain(
  channelName: string,
  dataDomain: Domain,
  scaleMode: AxisScaleMode,
  minIntensity: number,
  maxIntensity: number,
  logicle: LogicleSettings
): Domain {
  const useLogicle = scaleMode === 'logicle' || (scaleMode === 'auto' && channelName && isLogAxisChannel(channelName));
  if (useLogicle) {
    const lower = Math.min(minIntensity, maxIntensity);
    const upper = Math.max(minIntensity, maxIntensity);
    const min = toAxisSpace(lower, channelName, { scaleMode, logicle });
    const max = toAxisSpace(upper, channelName, { scaleMode, logicle });
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }

  return dataDomain;
}

function drawGateOutline(
  ctx: CanvasRenderingContext2D,
  gate: GateDefinition,
  xDomain: Domain,
  yDomain: Domain,
  width: number,
  height: number,
  color: string,
  lineWidth = 1.3
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  if (gate.kind === 'rectangle') {
    const x1 = toPixel(gate.xMin, xDomain, width);
    const x2 = toPixel(gate.xMax, xDomain, width);
    const y1 = height - 1 - toPixel(gate.yMin, yDomain, height);
    const y2 = height - 1 - toPixel(gate.yMax, yDomain, height);
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  }

  if (gate.kind === 'polygon') {
    if (gate.points.length >= 2) {
      ctx.beginPath();
      const start = gate.points[0];
      ctx.moveTo(toPixel(start.x, xDomain, width), height - 1 - toPixel(start.y, yDomain, height));

      for (let i = 1; i < gate.points.length; i += 1) {
        const point = gate.points[i];
        ctx.lineTo(toPixel(point.x, xDomain, width), height - 1 - toPixel(point.y, yDomain, height));
      }

      ctx.closePath();
      ctx.stroke();
    }
  }

  if (gate.kind === 'quadrant') {
    const x = toPixel(gate.xThreshold, xDomain, width);
    const y = height - 1 - toPixel(gate.yThreshold, yDomain, height);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (gate.kind === 'ellipse') {
    const cx = toPixel(gate.cx, xDomain, width);
    const cy = height - 1 - toPixel(gate.cy, yDomain, height);
    const rx = Math.abs(toPixel(gate.cx + gate.rx, xDomain, width) - toPixel(gate.cx, xDomain, width));
    const ry = Math.abs(toPixel(gate.cy + gate.ry, yDomain, height) - toPixel(gate.cy, yDomain, height));

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, -gate.rotation, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

export default function PrimaryPlotCanvas() {
  const selectedSampleId = useWorkspaceStore((state) => state.selectedSampleId);
  const sampleData = useWorkspaceStore((state) => (state.selectedSampleId ? state.sampleData[state.selectedSampleId] : undefined));
  const populations = useWorkspaceStore((state) => state.populations);
  const populationOrder = useWorkspaceStore((state) => state.populationOrder);
  const selectedPopulationId = useWorkspaceStore((state) => state.selectedPopulationId);
  const xChannel = useWorkspaceStore((state) => state.xChannel);
  const yChannel = useWorkspaceStore((state) => state.yChannel);
  const xAxisScaleMode = useWorkspaceStore((state) => state.xAxisScaleMode);
  const yAxisScaleMode = useWorkspaceStore((state) => state.yAxisScaleMode);
  const axisRange = useWorkspaceStore((state) => state.axisRange);
  const logicle = useWorkspaceStore((state) => state.logicle);
  const toolMode = useWorkspaceStore((state) => state.toolMode);
  const graphSettings = useWorkspaceStore((state) => state.graphSettings);
  const setAxes = useWorkspaceStore((state) => state.setAxes);
  const addPopulation = useWorkspaceStore((state) => state.addPopulation);
  const setToolMode = useWorkspaceStore((state) => state.setToolMode);
  const setWorkerProgress = useWorkspaceStore((state) => state.setWorkerProgress);
  const setWorkerStatus = useWorkspaceStore((state) => state.setWorkerStatus);
  const selectPopulation = useWorkspaceStore((state) => state.selectPopulation);
  const getCurrentProcessingSignature = useWorkspaceStore((state) => state.getCurrentProcessingSignature);
  const ensureProcessedChannels = useWorkspaceStore((state) => state.ensureProcessedChannels);
  const getProcessedChannels = useWorkspaceStore((state) => state.getProcessedChannels);
  const cacheGateMask = useWorkspaceStore((state) => state.cacheGateMask);
  const getGateMask = useWorkspaceStore((state) => state.getGateMask);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [size, setSize] = useState({ width: 900, height: 520 });
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const [polygonDraft, setPolygonDraft] = useState<Point[]>([]);
  const [polygonHover, setPolygonHover] = useState<Point | null>(null);
  const [densityGrid, setDensityGrid] = useState<{
    grid: Float32Array;
    width: number;
    height: number;
    maxDensity: number;
  } | null>(null);
  const [drawPoints, setDrawPoints] = useState<{ xValues: Float32Array; yValues: Float32Array } | null>(null);
  const [axisPicker, setAxisPicker] = useState<'x' | 'y' | null>(null);
  const densityDebugEnabled = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem('flow.debugDensity') === '1';
  }, []);

  const currentSignature = useMemo(() => {
    if (!selectedSampleId) {
      return null;
    }
    return getCurrentProcessingSignature(selectedSampleId);
  }, [selectedSampleId, getCurrentProcessingSignature]);

  useEffect(() => {
    if (!selectedSampleId || !currentSignature) {
      return;
    }

    ensureProcessedChannels(selectedSampleId, currentSignature);
  }, [selectedSampleId, currentSignature, ensureProcessedChannels]);

  const processedChannels = useMemo(() => {
    if (!selectedSampleId || !currentSignature) {
      return null;
    }

    return sampleData?.derivedCache.processedBySignature[currentSignature] ?? null;
  }, [selectedSampleId, currentSignature, sampleData]);

  const xValues = xChannel && processedChannels ? processedChannels[xChannel] ?? null : null;
  const yValues = yChannel && processedChannels ? processedChannels[yChannel] ?? null : null;
  const xPlotValues = useMemo(
    () => (xValues && xChannel ? mapValuesToAxisSpace(xValues, xChannel, { scaleMode: xAxisScaleMode, logicle }) : null),
    [xValues, xChannel, xAxisScaleMode, logicle]
  );
  const yPlotValues = useMemo(
    () => (yValues && yChannel ? mapValuesToAxisSpace(yValues, yChannel, { scaleMode: yAxisScaleMode, logicle }) : null),
    [yValues, yChannel, yAxisScaleMode, logicle]
  );

  const selectedPopulation = selectedPopulationId !== 'ungated' ? populations[selectedPopulationId] : null;

  const selectedMaskKey = useMemo(() => {
    if (!selectedSampleId || !selectedPopulation) {
      return null;
    }

    return buildGateMaskKey({
      sampleId: selectedSampleId,
      populationId: selectedPopulation.id,
      version: selectedPopulation.version,
      processingSignature: selectedPopulation.transformSignature
    });
  }, [selectedSampleId, selectedPopulation]);

  const selectedPopulationMask = useMemo(() => {
    if (!selectedSampleId || !selectedMaskKey) {
      return null;
    }

    return getGateMask(selectedSampleId, selectedMaskKey);
  }, [selectedSampleId, selectedMaskKey, getGateMask, sampleData]);

  const activeMask = selectedPopulationId === 'ungated' ? null : selectedPopulationMask;

  const minMaxXDomain = useMemo(() => (xPlotValues ? computeDomain(xPlotValues) : { min: 0, max: 1 }), [xPlotValues]);
  const minMaxYDomain = useMemo(() => (yPlotValues ? computeDomain(yPlotValues) : { min: 0, max: 1 }), [yPlotValues]);
  const densityXDomain = useMemo(
    () =>
      xPlotValues
        ? computePercentileDomain(xPlotValues, activeMask, DENSITY_Q_LOW, DENSITY_Q_HIGH, DENSITY_DOMAIN_PADDING)
        : { min: 0, max: 1 },
    [xPlotValues, activeMask]
  );
  const densityYDomain = useMemo(
    () =>
      yPlotValues
        ? computePercentileDomain(yPlotValues, activeMask, DENSITY_Q_LOW, DENSITY_Q_HIGH, DENSITY_DOMAIN_PADDING)
        : { min: 0, max: 1 },
    [yPlotValues, activeMask]
  );
  const baseXDomain = graphSettings.plotType === 'scatter' ? minMaxXDomain : densityXDomain;
  const baseYDomain = graphSettings.plotType === 'scatter' ? minMaxYDomain : densityYDomain;
  const defaultXDomain = useMemo(
    () =>
      graphSettings.plotType === 'scatter'
        ? defaultViewDomain(xChannel, baseXDomain, xAxisScaleMode, axisRange.xMin, axisRange.xMax, logicle)
        : baseXDomain,
    [graphSettings.plotType, xChannel, baseXDomain.min, baseXDomain.max, xAxisScaleMode, axisRange.xMin, axisRange.xMax, logicle]
  );
  const defaultYDomain = useMemo(
    () =>
      graphSettings.plotType === 'scatter'
        ? defaultViewDomain(yChannel, baseYDomain, yAxisScaleMode, axisRange.yMin, axisRange.yMax, logicle)
        : baseYDomain,
    [graphSettings.plotType, yChannel, baseYDomain.min, baseYDomain.max, yAxisScaleMode, axisRange.yMin, axisRange.yMax, logicle]
  );
  const xDomain = defaultXDomain;
  const yDomain = defaultYDomain;

  const axisMismatch = Boolean(
    selectedPopulation &&
      currentSignature &&
      (selectedPopulation.xChannel !== xChannel ||
        selectedPopulation.yChannel !== yChannel ||
        selectedPopulation.transformSignature !== currentSignature)
  );

  useEffect(() => {
    setAxisPicker(null);
  }, [selectedSampleId]);

  useEffect(() => {
    if (!selectedPopulation || !selectedSampleId) {
      return;
    }

    const signature = ensureProcessedChannels(selectedSampleId, selectedPopulation.transformSignature);
    if (!signature) {
      return;
    }

    const gateChannels = getProcessedChannels(selectedSampleId, signature);
    const gxRaw = gateChannels?.[selectedPopulation.xChannel];
    const gyRaw = gateChannels?.[selectedPopulation.yChannel];
    const gxScaleMode = selectedPopulation.xChannel === xChannel ? xAxisScaleMode : 'auto';
    const gyScaleMode = selectedPopulation.yChannel === yChannel ? yAxisScaleMode : 'auto';
    const gx = gxRaw ? mapValuesToAxisSpace(gxRaw, selectedPopulation.xChannel, { scaleMode: gxScaleMode, logicle }) : null;
    const gy = gyRaw ? mapValuesToAxisSpace(gyRaw, selectedPopulation.yChannel, { scaleMode: gyScaleMode, logicle }) : null;

    if (!gx || !gy || !selectedMaskKey) {
      return;
    }

    const existing = getGateMask(selectedSampleId, selectedMaskKey);
    if (existing) {
      return;
    }

    setWorkerStatus('running');

    const { promise, cancel } = analysisClient.computeGateMask(
      {
        xValues: gx,
        yValues: gy,
        gate: selectedPopulation.definition
      },
      (progress) => setWorkerProgress(progress)
    );

    promise
      .then((result) => {
        cacheGateMask(selectedSampleId, selectedMaskKey, result.mask);
      })
      .catch(() => {
        // no-op; handled by stale cancellation
      })
      .finally(() => {
        setWorkerProgress(null);
        setWorkerStatus('idle');
      });

    return () => {
      cancel();
    };
  }, [
    selectedPopulation,
    selectedSampleId,
    selectedMaskKey,
    xChannel,
    yChannel,
    xAxisScaleMode,
    yAxisScaleMode,
    logicle,
    ensureProcessedChannels,
    getProcessedChannels,
    getGateMask,
    cacheGateMask,
    setWorkerProgress,
    setWorkerStatus
  ]);

  useEffect(() => {
    if (!xPlotValues || !yPlotValues) {
      setDrawPoints(null);
      return;
    }

    if (graphSettings.plotType !== 'scatter') {
      return;
    }

    const pointCount = Math.min(xPlotValues.length, yPlotValues.length);

    if (pointCount <= 120000) {
      setDrawPoints({ xValues: xPlotValues, yValues: yPlotValues });
      return;
    }

    const { promise, cancel } = analysisClient.downsamplePoints(
      {
        xValues: xPlotValues,
        yValues: yPlotValues,
        mask: activeMask,
        maxPoints: 120000,
        seed: `${selectedSampleId ?? 'none'}|${xChannel}|${yChannel}|${selectedPopulationId}`
      },
      (progress) => setWorkerProgress(progress)
    );

    setWorkerStatus('running');

    promise
      .then((result) => {
        setDrawPoints(result);
      })
      .finally(() => {
        setWorkerProgress(null);
        setWorkerStatus('idle');
      });

    return () => {
      cancel();
    };
  }, [
    xPlotValues,
    yPlotValues,
    activeMask,
    graphSettings.plotType,
    selectedSampleId,
    xChannel,
    yChannel,
    selectedPopulationId,
    setWorkerProgress,
    setWorkerStatus
  ]);

  useEffect(() => {
    if (!xPlotValues || !yPlotValues) {
      setDensityGrid(null);
      return;
    }

    if (graphSettings.plotType === 'scatter') {
      setDensityGrid(null);
      return;
    }

    const densityWidth = Math.max(80, Math.floor(size.width / 3));
    const densityHeight = Math.max(60, Math.floor(size.height / 3));

    setWorkerStatus('running');

    const { promise, cancel } = analysisClient.computeDensity2D(
      {
        xValues: xPlotValues,
        yValues: yPlotValues,
        mask: activeMask,
        width: densityWidth,
        height: densityHeight,
        smooth: graphSettings.smooth,
        xDomain: [xDomain.min, xDomain.max],
        yDomain: [yDomain.min, yDomain.max],
        qLow: DENSITY_Q_LOW,
        qHigh: DENSITY_Q_HIGH,
        domainPadding: DENSITY_DOMAIN_PADDING,
        debug: densityDebugEnabled
      },
      (progress) => setWorkerProgress(progress)
    );

    if (densityDebugEnabled) {
      // eslint-disable-next-line no-console
      console.log('[density-debug:main]', {
        xValuesMinMax: minMaxXDomain,
        yValuesMinMax: minMaxYDomain,
        xPercentileDomain: densityXDomain,
        yPercentileDomain: densityYDomain,
        xDomainSent: [xDomain.min, xDomain.max],
        yDomainSent: [yDomain.min, yDomain.max]
      });
    }

    promise
      .then((result) => {
        setDensityGrid({
          grid: result.grid,
          width: result.width,
          height: result.height,
          maxDensity: result.maxDensity
        });
      })
      .finally(() => {
        setWorkerProgress(null);
        setWorkerStatus('idle');
      });

    return () => {
      cancel();
    };
  }, [
    xPlotValues,
    yPlotValues,
    activeMask,
    graphSettings.plotType,
    graphSettings.smooth,
    densityDebugEnabled,
    minMaxXDomain.min,
    minMaxXDomain.max,
    minMaxYDomain.min,
    minMaxYDomain.max,
    densityXDomain.min,
    densityXDomain.max,
    densityYDomain.min,
    densityYDomain.max,
    xDomain.min,
    xDomain.max,
    yDomain.min,
    yDomain.max,
    size.width,
    size.height,
    setWorkerProgress,
    setWorkerStatus
  ]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setSize({
        width: Math.max(360, Math.floor(entry.contentRect.width)),
        height: Math.max(300, Math.floor(entry.contentRect.height))
      });
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = graphSettings.backgroundColor;
    ctx.fillRect(0, 0, size.width, size.height);

    if (xPlotValues && yPlotValues) {
      if (graphSettings.plotType === 'scatter') {
        const source = drawPoints ?? { xValues: xPlotValues, yValues: yPlotValues };
        const count = Math.min(source.xValues.length, source.yValues.length);

        ctx.fillStyle = paletteColor(graphSettings.palette, 0.8, 0.72);

        if (source === drawPoints || !activeMask) {
          for (let i = 0; i < count; i += 1) {
            const px = toPixel(source.xValues[i], xDomain, size.width);
            const py = size.height - 1 - toPixel(source.yValues[i], yDomain, size.height);
            ctx.fillRect(px, py, 1.3, 1.3);
          }
        } else {
          for (let i = 0; i < count; i += 1) {
            if (activeMask[i] !== 1) {
              continue;
            }
            const px = toPixel(source.xValues[i], xDomain, size.width);
            const py = size.height - 1 - toPixel(source.yValues[i], yDomain, size.height);
            ctx.fillRect(px, py, 1.3, 1.3);
          }
        }
      } else if (densityGrid) {
        const cellW = size.width / densityGrid.width;
        const cellH = size.height / densityGrid.height;

        for (let row = 0; row < densityGrid.height; row += 1) {
          for (let col = 0; col < densityGrid.width; col += 1) {
            const density = densityGrid.grid[row * densityGrid.width + col];
            if (density <= 0) {
              continue;
            }

            const ratio = densityGrid.maxDensity > 0 ? density / densityGrid.maxDensity : 0;
            if (graphSettings.plotType === 'pseudocolor' && ratio < PSEUDOCOLOR_MIN_VISIBLE_RATIO) {
              continue;
            }
            const alpha = graphSettings.plotType === 'pseudocolor' ? 0.95 : 0.14 + ratio * 0.86;
            ctx.fillStyle = paletteColor(graphSettings.palette, ratio, alpha);
            ctx.fillRect(col * cellW, size.height - (row + 1) * cellH, cellW + 1, cellH + 1);
          }
        }
      }

      for (const gateId of populationOrder) {
        const gateNode = populations[gateId];
        if (!gateNode || !gateNode.visible) {
          continue;
        }

        if (gateNode.xChannel !== xChannel || gateNode.yChannel !== yChannel || gateNode.transformSignature !== currentSignature) {
          continue;
        }

        const color = selectedPopulationId === gateId ? 'rgba(255, 153, 72, 0.95)' : 'rgba(255, 138, 43, 0.68)';
        const lineWidth = selectedPopulationId === gateId ? 1.8 : 1.1;
        drawGateOutline(ctx, gateNode.definition, xDomain, yDomain, size.width, size.height, color, lineWidth);
      }
    }

    if (toolMode === 'polygon' && polygonDraft.length > 0) {
      ctx.strokeStyle = 'rgba(255, 153, 72, 0.95)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();

      const first = polygonDraft[0];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < polygonDraft.length; i += 1) {
        const point = polygonDraft[i];
        ctx.lineTo(point.x, point.y);
      }
      if (polygonHover) {
        ctx.lineTo(polygonHover.x, polygonHover.y);
      }
      ctx.stroke();

      for (const point of polygonDraft) {
        ctx.fillStyle = 'rgba(255, 153, 72, 0.95)';
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (dragStart && dragCurrent && (toolMode === 'rectangle' || toolMode === 'ellipse')) {
      const minX = Math.min(dragStart.x, dragCurrent.x);
      const maxX = Math.max(dragStart.x, dragCurrent.x);
      const minY = Math.min(dragStart.y, dragCurrent.y);
      const maxY = Math.max(dragStart.y, dragCurrent.y);

      ctx.strokeStyle = 'rgba(255, 153, 72, 0.95)';
      ctx.lineWidth = 1.2;
      ctx.fillStyle = 'rgba(255, 153, 72, 0.12)';

      if (toolMode === 'rectangle') {
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      }

      if (toolMode === 'ellipse') {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const rx = (maxX - minX) / 2;
        const ry = (maxY - minY) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (xPlotValues && yPlotValues && xChannel && yChannel) {
      drawAxisTicks(
        ctx,
        xDomain,
        yDomain,
        size.width,
        size.height,
        xChannel,
        yChannel,
        xAxisScaleMode,
        yAxisScaleMode,
        logicle
      );
    }
  }, [
    size,
    graphSettings,
    xPlotValues,
    yPlotValues,
    xDomain,
    yDomain,
    drawPoints,
    activeMask,
    densityGrid,
    populations,
    populationOrder,
    selectedPopulationId,
    xChannel,
    yChannel,
    xAxisScaleMode,
    yAxisScaleMode,
    logicle,
    currentSignature,
    toolMode,
    polygonDraft,
    polygonHover,
    dragStart,
    dragCurrent
  ]);

  function getCanvasPoint(event: MouseEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(size.width - 1, event.clientX - rect.left)),
      y: Math.max(0, Math.min(size.height - 1, event.clientY - rect.top))
    };
  }

  function createGate(definition: GateDefinition, name: string): void {
    if (!xChannel || !yChannel || !currentSignature) {
      return;
    }

    addPopulation({
      name,
      parentId: 'ungated',
      type: definition.kind,
      visible: true,
      xChannel,
      yChannel,
      transformSignature: currentSignature,
      definition
    });
  }

  function finalizePolygon(): void {
    if (polygonDraft.length < 3) {
      return;
    }

    const points = polygonDraft.map((point) => ({
      x: toData(point.x, xDomain, size.width),
      y: toData(size.height - 1 - point.y, yDomain, size.height)
    }));

    createGate({ kind: 'polygon', points }, `Polygon ${populationOrder.length + 1}`);
    setPolygonDraft([]);
    setPolygonHover(null);
    setToolMode('pointer');
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (toolMode === 'polygon' && event.key === 'Enter') {
        event.preventDefault();
        finalizePolygon();
      }

      if (toolMode === 'polygon' && event.key === 'Escape') {
        setPolygonDraft([]);
        setPolygonHover(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [toolMode, polygonDraft]);

  const populationLabel = selectedPopulation?.name ?? 'Ungated';
  const channels = sampleData?.channelNames ?? [];

  return (
    <section className="flex h-full min-h-0 flex-col bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="text-xs text-muted">Graph Window</div>
        <div className="text-xs text-muted">Click axis labels to change channels</div>
      </header>

      {axisMismatch && selectedPopulation ? (
        <div className="border-b border-amber-700/50 bg-amber-900/20 px-3 py-1 text-xs text-amber-200">
          Selected gate was created on different axes/transform.
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              setAxes(selectedPopulation.xChannel, selectedPopulation.yChannel);
            }}
          >
            Jump to gate axes
          </button>
        </div>
      ) : null}

      <div ref={wrapperRef} className="relative min-h-[320px] flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseDown={(event) => {
            setAxisPicker(null);
            const point = getCanvasPoint(event);
            if (toolMode === 'rectangle' || toolMode === 'ellipse') {
              setDragStart(point);
              setDragCurrent(point);
            }

            if (toolMode === 'quadrant') {
              const xThreshold = toData(point.x, xDomain, size.width);
              const yThreshold = toData(size.height - 1 - point.y, yDomain, size.height);

              createGate({ kind: 'quadrant', xThreshold, yThreshold, quadrant: 'Q1' }, `Q1 ${populationOrder.length + 1}`);
              createGate({ kind: 'quadrant', xThreshold, yThreshold, quadrant: 'Q2' }, `Q2 ${populationOrder.length + 2}`);
              createGate({ kind: 'quadrant', xThreshold, yThreshold, quadrant: 'Q3' }, `Q3 ${populationOrder.length + 3}`);
              createGate({ kind: 'quadrant', xThreshold, yThreshold, quadrant: 'Q4' }, `Q4 ${populationOrder.length + 4}`);
              setToolMode('pointer');
            }
          }}
          onMouseMove={(event) => {
            const point = getCanvasPoint(event);
            if (dragStart) {
              setDragCurrent(point);
            }
            if (toolMode === 'polygon') {
              setPolygonHover(point);
            }
          }}
          onMouseUp={(event) => {
            if (!dragStart || !dragCurrent) {
              return;
            }

            const point = getCanvasPoint(event);
            const minX = Math.min(dragStart.x, point.x);
            const maxX = Math.max(dragStart.x, point.x);
            const minY = Math.min(dragStart.y, point.y);
            const maxY = Math.max(dragStart.y, point.y);
            const width = maxX - minX;
            const height = maxY - minY;

            setDragStart(null);
            setDragCurrent(null);

            if (width < 4 || height < 4) {
              return;
            }

            if (toolMode === 'rectangle') {
              createGate(
                {
                  kind: 'rectangle',
                  xMin: toData(minX, xDomain, size.width),
                  xMax: toData(maxX, xDomain, size.width),
                  yMin: toData(size.height - 1 - maxY, yDomain, size.height),
                  yMax: toData(size.height - 1 - minY, yDomain, size.height)
                },
                `Rectangle ${populationOrder.length + 1}`
              );
              setToolMode('pointer');
            }

            if (toolMode === 'ellipse') {
              const cx = toData((minX + maxX) / 2, xDomain, size.width);
              const cy = toData(size.height - 1 - (minY + maxY) / 2, yDomain, size.height);
              const rx = Math.abs(toData(maxX, xDomain, size.width) - toData(minX, xDomain, size.width)) / 2;
              const ry = Math.abs(toData(size.height - 1 - minY, yDomain, size.height) - toData(size.height - 1 - maxY, yDomain, size.height)) / 2;

              createGate(
                {
                  kind: 'ellipse',
                  cx,
                  cy,
                  rx,
                  ry,
                  rotation: 0
                },
                `Ellipse ${populationOrder.length + 1}`
              );
              setToolMode('pointer');
            }
          }}
          onClick={(event) => {
            if (toolMode !== 'polygon') {
              return;
            }

            const point = getCanvasPoint(event);
            setPolygonDraft((current) => [...current, point]);
          }}
          onDoubleClick={() => {
            if (toolMode === 'polygon') {
              finalizePolygon();
            }
          }}
          onContextMenu={(event) => {
            if (toolMode === 'polygon') {
              event.preventDefault();
              finalizePolygon();
            }
          }}
          className="h-full w-full"
        />

        <button
          type="button"
          className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded border border-slate-700/90 bg-panel/90 px-2 py-0.5 text-xs text-ink hover:border-accent/70"
          onClick={() => setAxisPicker((current) => (current === 'x' ? null : 'x'))}
          title="Change X channel"
        >
          X: {xChannel || 'Select channel'}
        </button>

        <button
          type="button"
          className="absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 rounded border border-slate-700/90 bg-panel/90 px-2 py-0.5 text-xs text-ink hover:border-accent/70"
          onClick={() => setAxisPicker((current) => (current === 'y' ? null : 'y'))}
          title="Change Y channel"
        >
          Y: {yChannel || 'Select channel'}
        </button>

        {axisPicker === 'x' ? (
          <div className="scrollbar-thin absolute bottom-8 left-1/2 z-20 max-h-52 w-64 -translate-x-1/2 overflow-auto rounded border border-slate-700 bg-panel shadow-panel">
            {channels.map((name) => (
              <button
                key={`xp-${name}`}
                type="button"
                className={[
                  'block w-full truncate px-2 py-1 text-left text-xs transition',
                  name === xChannel ? 'bg-accent/20 text-accent' : 'text-ink hover:bg-slate-800'
                ].join(' ')}
                onClick={() => {
                  setAxes(name, yChannel || name);
                  setAxisPicker(null);
                }}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}

        {axisPicker === 'y' ? (
          <div className="scrollbar-thin absolute left-10 top-1/2 z-20 max-h-52 w-64 -translate-y-1/2 overflow-auto rounded border border-slate-700 bg-panel shadow-panel">
            {channels.map((name) => (
              <button
                key={`yp-${name}`}
                type="button"
                className={[
                  'block w-full truncate px-2 py-1 text-left text-xs transition',
                  name === yChannel ? 'bg-accent/20 text-accent' : 'text-ink hover:bg-slate-800'
                ].join(' ')}
                onClick={() => {
                  setAxes(xChannel || name, name);
                  setAxisPicker(null);
                }}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="plot-status-chip">{populationLabel}</div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-3 py-1 text-[11px] text-muted">
        <span>{selectedSampleId ? 'Sample loaded' : 'No sample selected'}</span>
        <span>
          {xChannel || '-'} vs {yChannel || '-'}
        </span>
        <span>
          X[{formatAxisTickForChannel(xDomain.min, xChannel || '', xAxisScaleMode, logicle)},{' '}
          {formatAxisTickForChannel(xDomain.max, xChannel || '', xAxisScaleMode, logicle)}] Y[
          {formatAxisTickForChannel(yDomain.min, yChannel || '', yAxisScaleMode, logicle)},{' '}
          {formatAxisTickForChannel(yDomain.max, yChannel || '', yAxisScaleMode, logicle)}]
        </span>
        <span
          className={selectedPopulationId === 'ungated' ? 'cursor-default' : 'cursor-pointer text-accent'}
          onClick={() => {
            if (selectedPopulationId !== 'ungated') {
              selectPopulation('ungated');
            }
          }}
        >
          {selectedPopulationId === 'ungated' ? 'Ungated' : 'Show ungated'}
        </span>
      </footer>
    </section>
  );
}
