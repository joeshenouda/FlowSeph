import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import type { AxisScaleMode, GraphSettings } from '../store/types';

const PALETTES: GraphSettings['palette'][] = ['orange', 'cyan', 'heat', 'viridis'];
const SCALE_OPTIONS: AxisScaleMode[] = ['auto', 'logicle', 'linear'];

export default function GraphPropertiesPanel() {
  const graphSettings = useWorkspaceStore((state) => state.graphSettings);
  const setGraphSettings = useWorkspaceStore((state) => state.setGraphSettings);
  const compensationEnabled = useWorkspaceStore((state) => state.compensationEnabled);
  const setCompensationEnabled = useWorkspaceStore((state) => state.setCompensationEnabled);
  const transformEnabled = useWorkspaceStore((state) => state.transformEnabled);
  const setTransformEnabled = useWorkspaceStore((state) => state.setTransformEnabled);
  const cofactor = useWorkspaceStore((state) => state.cofactor);
  const setCofactor = useWorkspaceStore((state) => state.setCofactor);
  const xAxisScaleMode = useWorkspaceStore((state) => state.xAxisScaleMode);
  const yAxisScaleMode = useWorkspaceStore((state) => state.yAxisScaleMode);
  const axisRange = useWorkspaceStore((state) => state.axisRange);
  const logicle = useWorkspaceStore((state) => state.logicle);
  const setAxisScaleMode = useWorkspaceStore((state) => state.setAxisScaleMode);
  const setAxisRange = useWorkspaceStore((state) => state.setAxisRange);
  const setLogicleSettings = useWorkspaceStore((state) => state.setLogicleSettings);

  const [axisDraft, setAxisDraft] = useState({
    xMin: axisRange.xMin.toString(),
    xMax: axisRange.xMax.toString(),
    yMin: axisRange.yMin.toString(),
    yMax: axisRange.yMax.toString()
  });
  const [logicleDraft, setLogicleDraft] = useState({
    T: logicle.T.toString(),
    M: logicle.M.toString(),
    W: logicle.W.toString(),
    A: logicle.A.toString()
  });

  useEffect(() => {
    setAxisDraft({
      xMin: axisRange.xMin.toString(),
      xMax: axisRange.xMax.toString(),
      yMin: axisRange.yMin.toString(),
      yMax: axisRange.yMax.toString()
    });
  }, [axisRange.xMin, axisRange.xMax, axisRange.yMin, axisRange.yMax]);

  useEffect(() => {
    setLogicleDraft({
      T: logicle.T.toString(),
      M: logicle.M.toString(),
      W: logicle.W.toString(),
      A: logicle.A.toString()
    });
  }, [logicle.T, logicle.M, logicle.W, logicle.A]);

  const parseNumber = (value: string): number | null => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const commitAxisField = (key: keyof typeof axisDraft): void => {
    const next = parseNumber(axisDraft[key]);
    if (next === null) {
      setAxisDraft((current) => ({
        ...current,
        [key]: axisRange[key].toString()
      }));
      return;
    }
    setAxisRange({ [key]: next });
  };

  const commitLogicleField = (key: keyof typeof logicleDraft): void => {
    const next = parseNumber(logicleDraft[key]);
    if (next === null) {
      setLogicleDraft((current) => ({
        ...current,
        [key]: logicle[key].toString()
      }));
      return;
    }
    setLogicleSettings({ [key]: next });
  };

  return (
    <aside className="flex h-full min-w-[210px] flex-col bg-panel">
      <header className="border-b border-slate-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Graph Properties</h2>
      </header>

      <div className="scrollbar-thin flex-1 space-y-3 overflow-auto p-3">
        <label className="block space-y-1 text-xs text-muted">
          <span>Plot Type</span>
          <select
            value={graphSettings.plotType}
            onChange={(event) => setGraphSettings({ plotType: event.target.value as GraphSettings['plotType'] })}
            className="w-full rounded border border-slate-700 bg-panelSoft px-2 py-1 text-sm text-ink"
          >
            <option value="scatter">Scatter</option>
            <option value="density">Density</option>
            <option value="pseudocolor">Pseudocolor</option>
          </select>
        </label>

        <label className="block space-y-1 text-xs text-muted">
          <span>Color Palette</span>
          <select
            value={graphSettings.palette}
            onChange={(event) => setGraphSettings({ palette: event.target.value as GraphSettings['palette'] })}
            className="w-full rounded border border-slate-700 bg-panelSoft px-2 py-1 text-sm text-ink"
          >
            {PALETTES.map((palette) => (
              <option key={palette} value={palette}>
                {palette}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-xs text-muted">
          <span>Background</span>
          <input
            type="color"
            value={graphSettings.backgroundColor}
            onChange={(event) => setGraphSettings({ backgroundColor: event.target.value })}
            className="h-9 w-full rounded border border-slate-700 bg-panelSoft px-1"
          />
        </label>

        <label className="flex items-center justify-between rounded border border-slate-700 bg-panelSoft px-2 py-2 text-xs text-muted">
          <span>Smooth Density</span>
          <input
            type="checkbox"
            checked={graphSettings.smooth}
            onChange={(event) => setGraphSettings({ smooth: event.target.checked })}
          />
        </label>

        <hr className="border-slate-800" />

        <label className="flex items-center justify-between rounded border border-slate-700 bg-panelSoft px-2 py-2 text-xs text-muted">
          <span>Compensation</span>
          <input
            type="checkbox"
            checked={compensationEnabled}
            onChange={(event) => setCompensationEnabled(event.target.checked)}
          />
        </label>

        <label className="flex items-center justify-between rounded border border-slate-700 bg-panelSoft px-2 py-2 text-xs text-muted">
          <span>Arcsinh Transform</span>
          <input type="checkbox" checked={transformEnabled} onChange={(event) => setTransformEnabled(event.target.checked)} />
        </label>

        <label className="block space-y-1 text-xs text-muted">
          <span>Cofactor</span>
          <input
            type="number"
            min={1}
            value={cofactor}
            onChange={(event) => setCofactor(Number.parseFloat(event.target.value) || 1)}
            className="w-full rounded border border-slate-700 bg-panelSoft px-2 py-1 text-sm text-ink"
          />
        </label>

        <hr className="border-slate-800" />

        <div className="space-y-2 rounded border border-slate-700 bg-panelSoft p-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Axis Scaling</div>

          <label className="block space-y-1 text-xs text-muted">
            <span>X Scale</span>
            <select
              value={xAxisScaleMode}
              onChange={(event) => setAxisScaleMode('x', event.target.value as AxisScaleMode)}
              className="w-full rounded border border-slate-700 bg-panel px-2 py-1 text-sm text-ink"
            >
              {SCALE_OPTIONS.map((mode) => (
                <option key={`x-${mode}`} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1 text-xs text-muted">
            <span>Y Scale</span>
            <select
              value={yAxisScaleMode}
              onChange={(event) => setAxisScaleMode('y', event.target.value as AxisScaleMode)}
              className="w-full rounded border border-slate-700 bg-panel px-2 py-1 text-sm text-ink"
            >
              {SCALE_OPTIONS.map((mode) => (
                <option key={`y-${mode}`} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1 text-xs text-muted">
              <span>X Min</span>
              <input
                type="number"
                value={axisDraft.xMin}
                onChange={(event) => {
                  setAxisDraft((current) => ({ ...current, xMin: event.target.value }));
                }}
                onBlur={() => commitAxisField('xMin')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitAxisField('xMin');
                  }
                }}
                className="w-full rounded border border-slate-700 bg-panel px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="block space-y-1 text-xs text-muted">
              <span>X Max</span>
              <input
                type="number"
                value={axisDraft.xMax}
                onChange={(event) => {
                  setAxisDraft((current) => ({ ...current, xMax: event.target.value }));
                }}
                onBlur={() => commitAxisField('xMax')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitAxisField('xMax');
                  }
                }}
                className="w-full rounded border border-slate-700 bg-panel px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="block space-y-1 text-xs text-muted">
              <span>Y Min</span>
              <input
                type="number"
                value={axisDraft.yMin}
                onChange={(event) => {
                  setAxisDraft((current) => ({ ...current, yMin: event.target.value }));
                }}
                onBlur={() => commitAxisField('yMin')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitAxisField('yMin');
                  }
                }}
                className="w-full rounded border border-slate-700 bg-panel px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="block space-y-1 text-xs text-muted">
              <span>Y Max</span>
              <input
                type="number"
                value={axisDraft.yMax}
                onChange={(event) => {
                  setAxisDraft((current) => ({ ...current, yMax: event.target.value }));
                }}
                onBlur={() => commitAxisField('yMax')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitAxisField('yMax');
                  }
                }}
                className="w-full rounded border border-slate-700 bg-panel px-2 py-1 text-sm text-ink"
              />
            </label>
          </div>
        </div>

        <div className="space-y-2 rounded border border-slate-700 bg-panelSoft p-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Logicle Params</div>
          <div className="grid grid-cols-4 gap-2">
            <label className="block space-y-1 text-xs text-muted">
              <span>T</span>
              <input
                type="number"
                step={1}
                value={logicleDraft.T}
                onChange={(event) => {
                  setLogicleDraft((current) => ({ ...current, T: event.target.value }));
                }}
                onBlur={() => commitLogicleField('T')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitLogicleField('T');
                  }
                }}
                className="w-full rounded border border-slate-700 bg-panel px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="block space-y-1 text-xs text-muted">
              <span>M</span>
              <input
                type="number"
                step={0.1}
                value={logicleDraft.M}
                onChange={(event) => {
                  setLogicleDraft((current) => ({ ...current, M: event.target.value }));
                }}
                onBlur={() => commitLogicleField('M')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitLogicleField('M');
                  }
                }}
                className="w-full rounded border border-slate-700 bg-panel px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="block space-y-1 text-xs text-muted">
              <span>W</span>
              <input
                type="number"
                step={0.1}
                value={logicleDraft.W}
                onChange={(event) => {
                  setLogicleDraft((current) => ({ ...current, W: event.target.value }));
                }}
                onBlur={() => commitLogicleField('W')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitLogicleField('W');
                  }
                }}
                className="w-full rounded border border-slate-700 bg-panel px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="block space-y-1 text-xs text-muted">
              <span>A</span>
              <input
                type="number"
                step={0.1}
                value={logicleDraft.A}
                onChange={(event) => {
                  setLogicleDraft((current) => ({ ...current, A: event.target.value }));
                }}
                onBlur={() => commitLogicleField('A')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitLogicleField('A');
                  }
                }}
                className="w-full rounded border border-slate-700 bg-panel px-2 py-1 text-sm text-ink"
              />
            </label>
          </div>
        </div>
      </div>
    </aside>
  );
}
