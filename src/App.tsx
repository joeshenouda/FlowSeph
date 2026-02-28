import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import ScatterCanvas from './components/ScatterCanvas';
import { parseFcsFile } from './lib/fcs';
import { applyArcsinh, applyCompensation } from './lib/math';
import { calculateChannelStats, calculatePearsonCorrelation } from './lib/stats';
import type { ChannelStatistics, DataGate, ParsedFcs } from './types';

const DEFAULT_COFACTOR = 150;

export default function App() {
  const [parsed, setParsed] = useState<ParsedFcs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCompEnabled, setCompEnabled] = useState<boolean>(true);
  const [isArcsinhEnabled, setArcsinhEnabled] = useState<boolean>(true);
  const [cofactor, setCofactor] = useState<number>(DEFAULT_COFACTOR);
  const [xChannel, setXChannel] = useState<string>('');
  const [yChannel, setYChannel] = useState<string>('');
  const [statsChannel, setStatsChannel] = useState<string>('');
  const [gate, setGate] = useState<DataGate | null>(null);
  const [isWorkspacePaneVisible, setWorkspacePaneVisible] = useState<boolean>(true);
  const [isInspectorPaneVisible, setInspectorPaneVisible] = useState<boolean>(true);
  const [isWideCenterLayout, setWideCenterLayout] = useState<boolean>(true);
  const [actionMessage, setActionMessage] = useState<string>('Ready');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError(null);
    setGate(null);

    try {
      const buffer = await file.arrayBuffer();
      const parsedFcs = parseFcsFile(buffer);
      setParsed(parsedFcs);

      const first = parsedFcs.channels[0]?.name ?? '';
      const second = parsedFcs.channels[1]?.name ?? first;
      setXChannel(first);
      setYChannel(second);
      setStatsChannel(first);
      setActionMessage(`Loaded ${file.name}`);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : 'Unknown parsing error';
      setParsed(null);
      setError(`Failed to parse FCS file: ${message}`);
      setActionMessage('Failed to load sample');
    } finally {
      event.target.value = '';
    }
  }

  const processedChannels = useMemo(() => {
    if (!parsed) {
      return [];
    }

    let channels = parsed.channels;

    if (isCompEnabled && parsed.spillover) {
      channels = applyCompensation(channels, parsed.spillover);
    } else {
      channels = channels.map((channel) => ({ name: channel.name, values: channel.values.slice() }));
    }

    if (isArcsinhEnabled) {
      channels = applyArcsinh(channels, cofactor);
    }

    return channels;
  }, [parsed, isCompEnabled, isArcsinhEnabled, cofactor]);

  const xValues = useMemo(() => {
    return processedChannels.find((channel) => channel.name === xChannel)?.values ?? null;
  }, [processedChannels, xChannel]);

  const yValues = useMemo(() => {
    return processedChannels.find((channel) => channel.name === yChannel)?.values ?? null;
  }, [processedChannels, yChannel]);

  const gateSummary = useMemo(() => {
    if (!xValues || !yValues) {
      return { total: 0, gated: 0, percent: 0, mask: null as Uint8Array | null };
    }

    const total = Math.min(xValues.length, yValues.length);
    const mask = new Uint8Array(total);
    if (!gate) {
      return { total, gated: 0, percent: 0, mask };
    }

    let gated = 0;
    for (let i = 0; i < total; i += 1) {
      const x = xValues[i];
      const y = yValues[i];
      if (x >= gate.minX && x <= gate.maxX && y >= gate.minY && y <= gate.maxY) {
        mask[i] = 1;
        gated += 1;
      }
    }

    return {
      total,
      gated,
      percent: total > 0 ? (gated / total) * 100 : 0,
      mask
    };
  }, [xValues, yValues, gate]);

  const channelNames = processedChannels.map((channel) => channel.name);
  const canPlot = Boolean(xValues && yValues);
  const activeFileText = parsed ? `${parsed.eventCount.toLocaleString()} events` : 'No sample loaded';
  const workspaceClassName = [
    'workspace',
    isWideCenterLayout ? 'wide-center' : '',
    isWorkspacePaneVisible ? '' : 'hide-left',
    isInspectorPaneVisible ? '' : 'hide-right'
  ]
    .join(' ')
    .trim();

  const selectedStatsValues = useMemo(() => {
    return processedChannels.find((channel) => channel.name === statsChannel)?.values ?? null;
  }, [processedChannels, statsChannel]);

  const selectedChannelStats = useMemo(() => {
    if (!selectedStatsValues) {
      return {
        all: null as ChannelStatistics | null,
        gated: null as ChannelStatistics | null
      };
    }

    return {
      all: calculateChannelStats(selectedStatsValues),
      gated: calculateChannelStats(selectedStatsValues, gateSummary.mask ?? undefined)
    };
  }, [selectedStatsValues, gateSummary.mask]);

  const xyCorrelationStats = useMemo(() => {
    if (!xValues || !yValues) {
      return {
        all: { count: 0, r: null as number | null },
        gated: { count: 0, r: null as number | null }
      };
    }

    return {
      all: calculatePearsonCorrelation(xValues, yValues),
      gated: calculatePearsonCorrelation(xValues, yValues, gateSummary.mask ?? undefined)
    };
  }, [xValues, yValues, gateSummary.mask]);

  function formatStatNumber(value: number | null, digits = 3): string {
    if (value === null || Number.isNaN(value)) {
      return '-';
    }
    return value.toFixed(digits);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
    setActionMessage('Select an FCS file to load');
  }

  function toggleCompMatrix() {
    if (!parsed?.spillover) {
      setActionMessage('No spillover matrix found in this file');
      return;
    }
    setCompEnabled((prev) => !prev);
    setActionMessage(isCompEnabled ? 'Compensation disabled' : 'Compensation enabled');
  }

  function toggleLayoutMode() {
    setWideCenterLayout((prev) => {
      const next = !prev;
      setActionMessage(next ? 'Center panel widened' : 'Center panel set to standard width');
      return next;
    });
  }

  function exportGateSummary() {
    if (!parsed) {
      setActionMessage('Load a sample before exporting');
      return;
    }

    const rows: Array<[string, string]> = [
      ['Metric', 'Value'],
      ['Events Total', String(gateSummary.total)],
      ['Events In Gate', String(gateSummary.gated)],
      ['Percent In Gate', gateSummary.percent.toFixed(2)],
      ['X Channel', xChannel || '-'],
      ['Y Channel', yChannel || '-'],
      ['Stats Channel', statsChannel || '-'],
      ['Compensation', isCompEnabled && parsed.spillover ? 'On' : 'Off'],
      ['Arcsinh', isArcsinhEnabled ? 'On' : 'Off'],
      ['Cofactor', String(cofactor)]
    ];

    if (selectedChannelStats.all) {
      rows.push(['Stats All Mean', formatStatNumber(selectedChannelStats.all.mean)]);
      rows.push(['Stats All Median', formatStatNumber(selectedChannelStats.all.median)]);
      rows.push(['Stats All StdDev', formatStatNumber(selectedChannelStats.all.stdDev)]);
      rows.push(['Stats All CV%', formatStatNumber(selectedChannelStats.all.cvPercent)]);
      rows.push(['Stats All P5', formatStatNumber(selectedChannelStats.all.p5)]);
      rows.push(['Stats All P95', formatStatNumber(selectedChannelStats.all.p95)]);
    }

    if (selectedChannelStats.gated) {
      rows.push(['Stats Gated Mean', formatStatNumber(selectedChannelStats.gated.mean)]);
      rows.push(['Stats Gated Median', formatStatNumber(selectedChannelStats.gated.median)]);
      rows.push(['Stats Gated StdDev', formatStatNumber(selectedChannelStats.gated.stdDev)]);
      rows.push(['Stats Gated CV%', formatStatNumber(selectedChannelStats.gated.cvPercent)]);
      rows.push(['Stats Gated P5', formatStatNumber(selectedChannelStats.gated.p5)]);
      rows.push(['Stats Gated P95', formatStatNumber(selectedChannelStats.gated.p95)]);
    }

    rows.push(['Pearson R (All)', formatStatNumber(xyCorrelationStats.all.r, 4)]);
    rows.push(['Pearson R (Gated)', formatStatNumber(xyCorrelationStats.gated.r, 4)]);

    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flow-gate-summary.csv';
    link.click();
    URL.revokeObjectURL(url);
    setActionMessage('Exported gate summary CSV');
  }

  function runBatchPreset() {
    if (!parsed) {
      setActionMessage('Load a sample before applying preset');
      return;
    }

    setCompEnabled(Boolean(parsed.spillover));
    setArcsinhEnabled(true);
    setCofactor(DEFAULT_COFACTOR);
    const first = parsed.channels[0]?.name ?? '';
    const second = parsed.channels[1]?.name ?? first;
    setXChannel(first);
    setYChannel(second);
    setStatsChannel(first);
    setActionMessage('Applied batch preset');
  }

  return (
    <main className="app-shell">
      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".fcs" onChange={handleFileChange} />
      <header className="top-menu">
        <div className="brand-block">
          <div className="app-title">Flow Cytometry Workspace</div>
          <div className="app-subtitle">Upload, compensate, transform, and gate events</div>
        </div>
        <div className="menu-group">
          <button type="button" onClick={openFilePicker}>
            File
          </button>
          <button
            type="button"
            onClick={() => {
              setWorkspacePaneVisible((prev) => !prev);
              setActionMessage(isWorkspacePaneVisible ? 'Workspace pane hidden' : 'Workspace pane visible');
            }}
          >
            Workspace
          </button>
          <button
            type="button"
            onClick={() => {
              setGate(null);
              setActionMessage(gate ? 'Gate cleared' : 'No gate to clear');
            }}
          >
            Edit
          </button>
          <button type="button" onClick={toggleLayoutMode}>
            Layout
          </button>
          <button
            type="button"
            onClick={() => {
              setInspectorPaneVisible((prev) => !prev);
              setActionMessage(isInspectorPaneVisible ? 'Inspector pane hidden' : 'Inspector pane visible');
            }}
          >
            Window
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="toolbar-actions">
          <button type="button" onClick={openFilePicker}>
            Open
          </button>
          <button type="button" onClick={toggleCompMatrix}>
            Comp Matrix
          </button>
          <button type="button" onClick={toggleLayoutMode}>
            Layout
          </button>
          <button type="button" onClick={exportGateSummary}>
            Table
          </button>
          <button type="button" onClick={runBatchPreset}>
            Batch
          </button>
        </div>
        <div className="toolbar-state">
          <span className={parsed ? 'state-chip active' : 'state-chip'}>{parsed ? 'Sample Loaded' : 'No Sample'}</span>
          <span className={isCompEnabled ? 'state-chip active' : 'state-chip'}>Compensation</span>
          <span className={isArcsinhEnabled ? 'state-chip active' : 'state-chip'}>Arcsinh</span>
        </div>
      </div>

      <section className={workspaceClassName}>
        <aside className={isWorkspacePaneVisible ? 'left-pane' : 'left-pane is-hidden'}>
          <div className="pane-title">Workspace</div>
          <div className="upload-field">
            <span>Load FCS sample</span>
            <button type="button" className="upload-button" onClick={openFilePicker}>
              Choose File
            </button>
            <div className="muted-text">Select a single .fcs file</div>
          </div>
          <div className="workspace-item">
            <div className="item-title">Sample</div>
            <div className="item-meta">{activeFileText}</div>
          </div>
          <div className="workspace-item">
            <div className="item-title">Channels</div>
            <div className="channel-list">
              {channelNames.length > 0 ? (
                channelNames.map((name) => (
                  <span key={name} className={name === xChannel || name === yChannel ? 'channel-pill active' : 'channel-pill'}>
                    {name}
                  </span>
                ))
              ) : (
                <span className="muted-text">No channels</span>
              )}
            </div>
          </div>
          {error && <div className="error-box">{error}</div>}
        </aside>

        <section className="center-pane">
          <div className="plot-header">
            <div>
              <div className="pane-title">Graph Window</div>
              <div className="plot-meta">Drag on the plot to create a rectangular gate</div>
            </div>
            <div className="axis-chip-row">
              <span className="axis-chip">X: {xChannel || '-'}</span>
              <span className="axis-chip">Y: {yChannel || '-'}</span>
            </div>
          </div>
          {canPlot ? (
            <>
              <div className="plot-frame">
                <ScatterCanvas xValues={xValues!} yValues={yValues!} gate={gate} onGateChange={setGate} />
              </div>
              <div className="plot-stats">
                <div>Total: {gateSummary.total.toLocaleString()}</div>
                <div>In Gate: {gateSummary.gated.toLocaleString()}</div>
                <div>% Gated: {gateSummary.percent.toFixed(2)}%</div>
                <button type="button" onClick={() => setGate(null)} disabled={!gate}>
                  Clear Gate
                </button>
              </div>
            </>
          ) : (
            <div className="empty-plot">Load an FCS file to open a graph window.</div>
          )}
        </section>

        <aside className={isInspectorPaneVisible ? 'right-pane' : 'right-pane is-hidden'}>
          <div className="pane-title">Inspector</div>
          <div className="control-group">
            <div className="group-title">Axes</div>
            <label>
              <span>X parameter</span>
              <select value={xChannel} onChange={(e) => setXChannel(e.target.value)} disabled={channelNames.length === 0}>
                {channelNames.map((name) => (
                  <option value={name} key={`x-${name}`}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Y parameter</span>
              <select value={yChannel} onChange={(e) => setYChannel(e.target.value)} disabled={channelNames.length === 0}>
                {channelNames.map((name) => (
                  <option value={name} key={`y-${name}`}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="control-group">
            <div className="group-title">Compensation</div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={isCompEnabled}
                onChange={(e) => setCompEnabled(e.target.checked)}
                disabled={!parsed?.spillover}
              />
              <span>Apply compensation</span>
            </label>
            <div className="muted-text">{parsed?.spillover ? 'Spillover matrix detected' : 'No spillover matrix in file'}</div>
          </div>

          <div className="control-group">
            <div className="group-title">Transform</div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={isArcsinhEnabled}
                onChange={(e) => setArcsinhEnabled(e.target.checked)}
              />
              <span>Apply arcsinh</span>
            </label>
            <label>
              <span>Cofactor</span>
              <input
                type="number"
                min={1}
                value={cofactor}
                onChange={(e) => setCofactor(Math.max(1, Number.parseFloat(e.target.value) || DEFAULT_COFACTOR))}
                disabled={!isArcsinhEnabled}
              />
            </label>
          </div>

          <div className="control-group">
            <div className="group-title">Gate</div>
            <div className="muted-text">Drag rectangle in the graph window to set a gate.</div>
          </div>

          <div className="control-group stats-group">
            <div className="group-title">Statistics</div>
            <label>
              <span>Stats channel</span>
              <select
                value={statsChannel}
                onChange={(e) => setStatsChannel(e.target.value)}
                disabled={channelNames.length === 0}
              >
                {channelNames.map((name) => (
                  <option value={name} key={`stats-${name}`}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <div className="stats-grid">
              <div className="stats-block">
                <div className="stats-title">All Events</div>
                <div>Count: {selectedChannelStats.all?.count ?? 0}</div>
                <div>Mean: {formatStatNumber(selectedChannelStats.all?.mean ?? null)}</div>
                <div>Median: {formatStatNumber(selectedChannelStats.all?.median ?? null)}</div>
                <div>Std Dev: {formatStatNumber(selectedChannelStats.all?.stdDev ?? null)}</div>
                <div>CV%: {formatStatNumber(selectedChannelStats.all?.cvPercent ?? null)}</div>
                <div>Min: {formatStatNumber(selectedChannelStats.all?.min ?? null)}</div>
                <div>Max: {formatStatNumber(selectedChannelStats.all?.max ?? null)}</div>
                <div>P5: {formatStatNumber(selectedChannelStats.all?.p5 ?? null)}</div>
                <div>P95: {formatStatNumber(selectedChannelStats.all?.p95 ?? null)}</div>
                <div>Geo Mean: {formatStatNumber(selectedChannelStats.all?.geometricMean ?? null)}</div>
              </div>

              <div className="stats-block">
                <div className="stats-title">Gated Events</div>
                <div>Count: {selectedChannelStats.gated?.count ?? 0}</div>
                <div>Mean: {formatStatNumber(selectedChannelStats.gated?.mean ?? null)}</div>
                <div>Median: {formatStatNumber(selectedChannelStats.gated?.median ?? null)}</div>
                <div>Std Dev: {formatStatNumber(selectedChannelStats.gated?.stdDev ?? null)}</div>
                <div>CV%: {formatStatNumber(selectedChannelStats.gated?.cvPercent ?? null)}</div>
                <div>Min: {formatStatNumber(selectedChannelStats.gated?.min ?? null)}</div>
                <div>Max: {formatStatNumber(selectedChannelStats.gated?.max ?? null)}</div>
                <div>P5: {formatStatNumber(selectedChannelStats.gated?.p5 ?? null)}</div>
                <div>P95: {formatStatNumber(selectedChannelStats.gated?.p95 ?? null)}</div>
                <div>Geo Mean: {formatStatNumber(selectedChannelStats.gated?.geometricMean ?? null)}</div>
              </div>
            </div>

            <div className="stats-block correlation-block">
              <div className="stats-title">X/Y Correlation (Pearson r)</div>
              <div>All Events: {formatStatNumber(xyCorrelationStats.all.r, 4)}</div>
              <div>Gated Events: {formatStatNumber(xyCorrelationStats.gated.r, 4)}</div>
            </div>
          </div>
        </aside>
      </section>

      <footer className="status-bar">
        <span>{parsed ? 'Ready' : 'Waiting for sample'}</span>
        <span>{gate ? 'Gate active' : 'No gate'}</span>
        <span>{activeFileText}</span>
        <span>{actionMessage}</span>
      </footer>
    </main>
  );
}
