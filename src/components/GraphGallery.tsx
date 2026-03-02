import { useEffect, useMemo, useState } from 'react';
import { analysisClient } from '../workers/analysisClient';
import {
  buildGateMaskKey,
  buildThumbnailCacheKey,
  computeDomain,
  computePercentileDomain,
  isLogAxisChannel,
  mapValuesToAxisSpace,
  paletteColor,
  toPixel
} from '../lib/plot';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

const DENSITY_Q_LOW = 0.001;
const DENSITY_Q_HIGH = 0.999;
const DENSITY_DOMAIN_PADDING = 0.03;
const PSEUDOCOLOR_MIN_VISIBLE_RATIO = 0;

interface ThumbnailCardProps {
  sampleId: string;
  selected: boolean;
  onSelect: () => void;
}

function ThumbnailCard({ sampleId, selected, onSelect }: ThumbnailCardProps) {
  const sample = useWorkspaceStore((state) => state.samples[sampleId]);
  const sampleData = useWorkspaceStore((state) => state.sampleData[sampleId]);
  const populations = useWorkspaceStore((state) => state.populations);
  const selectedPopulationId = useWorkspaceStore((state) => state.selectedPopulationId);
  const xChannel = useWorkspaceStore((state) => state.xChannel);
  const yChannel = useWorkspaceStore((state) => state.yChannel);
  const graphSettings = useWorkspaceStore((state) => state.graphSettings);
  const xAxisScaleMode = useWorkspaceStore((state) => state.xAxisScaleMode);
  const yAxisScaleMode = useWorkspaceStore((state) => state.yAxisScaleMode);
  const logicle = useWorkspaceStore((state) => state.logicle);
  const getCurrentProcessingSignature = useWorkspaceStore((state) => state.getCurrentProcessingSignature);
  const getProcessedChannels = useWorkspaceStore((state) => state.getProcessedChannels);
  const ensureProcessedChannels = useWorkspaceStore((state) => state.ensureProcessedChannels);
  const getGateMask = useWorkspaceStore((state) => state.getGateMask);
  const cacheGateMask = useWorkspaceStore((state) => state.cacheGateMask);
  const getThumbnail = useWorkspaceStore((state) => state.getThumbnail);
  const cacheThumbnail = useWorkspaceStore((state) => state.cacheThumbnail);

  const selectedPopulation = selectedPopulationId !== 'ungated' ? populations[selectedPopulationId] : null;

  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);

  const cacheKey = useMemo(() => {
    if (!sample || !sampleData || !xChannel || !yChannel) {
      return null;
    }
    const currentSignature = getCurrentProcessingSignature(sampleId);
    const useLogicleXDomain =
      xAxisScaleMode === 'logicle' || (xAxisScaleMode === 'auto' && xChannel && isLogAxisChannel(xChannel));
    const useLogicleYDomain =
      yAxisScaleMode === 'logicle' || (yAxisScaleMode === 'auto' && yChannel && isLogAxisChannel(yChannel));
    const displaySignature =
      useLogicleXDomain || useLogicleYDomain ? currentSignature.replace(/tx:[^|]+/, 'tx:off') : currentSignature;

    return buildThumbnailCacheKey({
      sampleId,
      populationId: selectedPopulationId,
      xChannel,
      yChannel,
      plotType: graphSettings.plotType,
      palette: graphSettings.palette,
      backgroundColor: graphSettings.backgroundColor,
      smooth: graphSettings.smooth,
      processingSignature: displaySignature
    });
  }, [
    sample,
    sampleData,
    sampleId,
    selectedPopulationId,
    xChannel,
    yChannel,
    graphSettings.plotType,
    graphSettings.palette,
    graphSettings.backgroundColor,
    graphSettings.smooth,
    getCurrentProcessingSignature,
    xAxisScaleMode,
    yAxisScaleMode,
    logicle
  ]);

  useEffect(() => {
    if (!cacheKey || !xChannel || !yChannel) {
      setThumbnailDataUrl(null);
      return;
    }

    const cached = getThumbnail(sampleId, cacheKey);
    if (cached) {
      setThumbnailDataUrl(cached);
      return;
    }

    let cancelled = false;
    const cancelFns: Array<() => void> = [];

    const run = async () => {
      const currentSignature = getCurrentProcessingSignature(sampleId);
      const useLogicleXDomain =
        xAxisScaleMode === 'logicle' || (xAxisScaleMode === 'auto' && xChannel && isLogAxisChannel(xChannel));
      const useLogicleYDomain =
        yAxisScaleMode === 'logicle' || (yAxisScaleMode === 'auto' && yChannel && isLogAxisChannel(yChannel));
      const displaySignature =
        useLogicleXDomain || useLogicleYDomain ? currentSignature.replace(/tx:[^|]+/, 'tx:off') : currentSignature;

      const processed = getProcessedChannels(sampleId, displaySignature);
      const xRaw = processed?.[xChannel];
      const yRaw = processed?.[yChannel];
      const xValues = xRaw ? mapValuesToAxisSpace(xRaw, xChannel, { scaleMode: xAxisScaleMode, logicle }) : null;
      const yValues = yRaw ? mapValuesToAxisSpace(yRaw, yChannel, { scaleMode: yAxisScaleMode, logicle }) : null;

      if (!xValues || !yValues) {
        setThumbnailDataUrl(null);
        return;
      }
      const useFullLogicleXDomain = useLogicleXDomain;
      const useFullLogicleYDomain = useLogicleYDomain;

      let mask: Uint8Array | null = null;

      if (selectedPopulation) {
        const popSignature = ensureProcessedChannels(sampleId, selectedPopulation.transformSignature);
        if (!popSignature) {
          return;
        }

        const gateChannels = getProcessedChannels(sampleId, popSignature);
        const gxRaw = gateChannels?.[selectedPopulation.xChannel];
        const gyRaw = gateChannels?.[selectedPopulation.yChannel];
        const gxScaleMode = selectedPopulation.xChannel === xChannel ? xAxisScaleMode : 'auto';
        const gyScaleMode = selectedPopulation.yChannel === yChannel ? yAxisScaleMode : 'auto';
        const gx = gxRaw
          ? mapValuesToAxisSpace(gxRaw, selectedPopulation.xChannel, { scaleMode: gxScaleMode, logicle })
          : null;
        const gy = gyRaw
          ? mapValuesToAxisSpace(gyRaw, selectedPopulation.yChannel, { scaleMode: gyScaleMode, logicle })
          : null;

        if (gx && gy) {
          const maskKey = buildGateMaskKey({
            sampleId,
            populationId: selectedPopulation.id,
            version: selectedPopulation.version,
            processingSignature: selectedPopulation.transformSignature
          });

          const existingMask = getGateMask(sampleId, maskKey);
          if (existingMask) {
            mask = existingMask;
          } else {
            const gateJob = analysisClient.computeGateMask({
              xValues: gx,
              yValues: gy,
              gate: selectedPopulation.definition
            });
            cancelFns.push(gateJob.cancel);
            const gateResult = await gateJob.promise;
            cacheGateMask(sampleId, maskKey, gateResult.mask);
            mask = gateResult.mask;
          }
        }
      }

      const canvas = document.createElement('canvas');
      const width = 220;
      const height = 130;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }

      ctx.fillStyle = graphSettings.backgroundColor;
      ctx.fillRect(0, 0, width, height);

      if (graphSettings.plotType === 'scatter') {
        const dsJob = analysisClient.downsamplePoints({
          xValues,
          yValues,
          mask,
          maxPoints: 2400,
          seed: `${sampleId}|${xChannel}|${yChannel}|${selectedPopulationId}`
        });

        cancelFns.push(dsJob.cancel);
        const sampled = await dsJob.promise;

        if (cancelled) {
          return;
        }

        const xDomain = useFullLogicleXDomain ? { min: 0, max: 1 } : computeDomain(sampled.xValues);
        const yDomain = useFullLogicleYDomain ? { min: 0, max: 1 } : computeDomain(sampled.yValues);

        ctx.fillStyle = paletteColor(graphSettings.palette, 0.8, 0.84);
        for (let i = 0; i < sampled.xValues.length; i += 1) {
          const px = toPixel(sampled.xValues[i], xDomain, width);
          const py = height - 1 - toPixel(sampled.yValues[i], yDomain, height);
          ctx.fillRect(px, py, 1.2, 1.2);
        }
      } else {
        const xDomain = useFullLogicleXDomain
          ? { min: 0, max: 1 }
          : computePercentileDomain(xValues, mask, DENSITY_Q_LOW, DENSITY_Q_HIGH, DENSITY_DOMAIN_PADDING);
        const yDomain = useFullLogicleYDomain
          ? { min: 0, max: 1 }
          : computePercentileDomain(yValues, mask, DENSITY_Q_LOW, DENSITY_Q_HIGH, DENSITY_DOMAIN_PADDING);
        const densityJob = analysisClient.computeDensity2D({
          xValues,
          yValues,
          mask,
          width: 110,
          height: 70,
          smooth: graphSettings.smooth,
          xDomain: [xDomain.min, xDomain.max],
          yDomain: [yDomain.min, yDomain.max],
          qLow: DENSITY_Q_LOW,
          qHigh: DENSITY_Q_HIGH,
          domainPadding: DENSITY_DOMAIN_PADDING
        });

        cancelFns.push(densityJob.cancel);
        const density = await densityJob.promise;

        if (cancelled) {
          return;
        }

        const cellW = width / density.width;
        const cellH = height / density.height;

        for (let row = 0; row < density.height; row += 1) {
          for (let col = 0; col < density.width; col += 1) {
            const value = density.grid[row * density.width + col];
            if (value <= 0) {
              continue;
            }

            const ratio = density.maxDensity > 0 ? value / density.maxDensity : 0;
            if (graphSettings.plotType === 'pseudocolor' && ratio < PSEUDOCOLOR_MIN_VISIBLE_RATIO) {
              continue;
            }
            const alpha = graphSettings.plotType === 'pseudocolor' ? 0.95 : 0.2 + ratio * 0.8;
            ctx.fillStyle = paletteColor(graphSettings.palette, ratio, alpha);
            ctx.fillRect(col * cellW, height - (row + 1) * cellH, cellW + 1, cellH + 1);
          }
        }
      }

      const dataUrl = canvas.toDataURL('image/png');
      cacheThumbnail(sampleId, cacheKey, dataUrl);
      setThumbnailDataUrl(dataUrl);
    };

    run().catch(() => {
      if (!cancelled) {
        setThumbnailDataUrl(null);
      }
    });

    return () => {
      cancelled = true;
      for (const cancel of cancelFns) {
        cancel();
      }
    };
  }, [
    cacheKey,
    getThumbnail,
    sampleId,
    getProcessedChannels,
    ensureProcessedChannels,
    getGateMask,
    cacheGateMask,
    xChannel,
    yChannel,
    xAxisScaleMode,
    yAxisScaleMode,
    logicle,
    graphSettings,
    selectedPopulation,
    selectedPopulationId,
    cacheThumbnail
  ]);

  if (!sample) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-64 shrink-0 rounded border p-2 text-left transition',
        selected ? 'border-accent bg-accent/10' : 'border-slate-700 bg-panel hover:border-slate-500'
      ].join(' ')}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-ink">{sample.name}</span>
        <span className="text-muted">{sample.eventCount.toLocaleString()}</span>
      </div>
      <div className="h-[116px] w-full overflow-hidden rounded border border-slate-800 bg-slate-900">
        {thumbnailDataUrl ? (
          <img src={thumbnailDataUrl} alt={sample.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full w-full place-items-center text-[11px] text-muted">Rendering…</div>
        )}
      </div>
    </button>
  );
}

export default function GraphGallery() {
  const selectedGroupId = useWorkspaceStore((state) => state.selectedGroupId);
  const selectedSampleId = useWorkspaceStore((state) => state.selectedSampleId);
  const groups = useWorkspaceStore((state) => state.groups);
  const selectSample = useWorkspaceStore((state) => state.selectSample);

  const sampleIds = useMemo(() => {
    const group = groups.find((item) => item.id === selectedGroupId);
    return group?.sampleIds ?? [];
  }, [groups, selectedGroupId]);

  return (
    <section className="flex h-full flex-col border-t border-slate-800 bg-panel">
      <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Graph Gallery</h3>
        <label className="text-[11px] text-muted">
          View
          <select className="ml-1 rounded border border-slate-700 bg-panelSoft px-1 py-0.5 text-[11px] text-ink" defaultValue="sample">
            <option value="sample">By Sample</option>
            <option value="population" disabled>
              By Population
            </option>
          </select>
        </label>
      </header>

      <div className="scrollbar-thin flex flex-1 gap-3 overflow-x-auto overflow-y-hidden p-3">
        {sampleIds.length === 0 ? (
          <div className="grid w-full place-items-center rounded border border-dashed border-slate-700 bg-panelSoft/60 text-xs text-muted">
            No samples in selected group.
          </div>
        ) : null}

        {sampleIds.map((sampleId) => (
          <ThumbnailCard
            key={sampleId}
            sampleId={sampleId}
            selected={selectedSampleId === sampleId}
            onSelect={() => selectSample(sampleId)}
          />
        ))}
      </div>
    </section>
  );
}
