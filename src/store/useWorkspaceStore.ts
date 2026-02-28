import { create } from 'zustand';
import { parseFcsFile } from '../lib/fcs';
import { applyArcsinh, applyCompensation } from '../lib/math';
import type { ChannelData } from '../types';
import type {
  AxisRangeSettings,
  AxisScaleMode,
  GateDefinition,
  GraphSettings,
  HistorySnapshot,
  LogicleSettings,
  PopulationNode,
  RailMode,
  SampleDataPayload,
  ToolMode,
  WorkspaceGroup,
  WorkspaceSample
} from './types';

const MAX_HISTORY = 100;
const DEFAULT_COFACTOR = 150;
const DEFAULT_AXIS_RANGE: AxisRangeSettings = {
  xMin: -5155,
  xMax: 1_000_000,
  yMin: -5155,
  yMax: 1_000_000
};
const DEFAULT_LOGICLE: LogicleSettings = {
  m: 4.5,
  w: 1,
  a: 0
};

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

function cloneGateDefinition(definition: GateDefinition): GateDefinition {
  if (definition.kind === 'polygon') {
    return {
      ...definition,
      points: definition.points.map((point) => ({ ...point }))
    };
  }

  return { ...definition };
}

function clonePopulations(populations: Record<string, PopulationNode>): Record<string, PopulationNode> {
  const clone: Record<string, PopulationNode> = {};

  for (const [id, population] of Object.entries(populations)) {
    clone[id] = {
      ...population,
      definition: cloneGateDefinition(population.definition)
    };
  }

  return clone;
}

function buildProcessingSignature(compensate: boolean, transform: boolean, cofactor: number): string {
  const txPart = transform ? `asinh:${cofactor}` : 'off';
  return `comp:${compensate ? '1' : '0'}|tx:${txPart}`;
}

function parseProcessingSignature(signature: string): { compensate: boolean; transform: boolean; cofactor: number } {
  const chunks = signature.split('|');
  const compChunk = chunks.find((chunk) => chunk.startsWith('comp:')) ?? 'comp:0';
  const txChunk = chunks.find((chunk) => chunk.startsWith('tx:')) ?? 'tx:off';

  const compensate = compChunk.endsWith('1');
  const txValue = txChunk.slice(3);

  if (txValue.startsWith('asinh:')) {
    const parsed = Number.parseFloat(txValue.slice(6));
    return {
      compensate,
      transform: true,
      cofactor: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COFACTOR
    };
  }

  return { compensate, transform: false, cofactor: DEFAULT_COFACTOR };
}

interface WorkspaceStoreState {
  railMode: RailMode;
  groups: WorkspaceGroup[];
  samples: Record<string, WorkspaceSample>;
  sampleData: Record<string, SampleDataPayload>;
  selectedGroupId: string | null;
  selectedSampleId: string | null;
  selectedPopulationId: string;
  populations: Record<string, PopulationNode>;
  populationOrder: string[];
  graphSettings: GraphSettings;
  toolMode: ToolMode;
  compensationEnabled: boolean;
  transformEnabled: boolean;
  cofactor: number;
  xAxisScaleMode: AxisScaleMode;
  yAxisScaleMode: AxisScaleMode;
  axisRange: AxisRangeSettings;
  logicle: LogicleSettings;
  xChannel: string;
  yChannel: string;
  workspaceSearch: string;
  workerProgress: number | null;
  workerStatus: string;
  error: string | null;
  historyPast: HistorySnapshot[];
  historyFuture: HistorySnapshot[];
  setRailMode: (mode: RailMode) => void;
  setWorkspaceSearch: (query: string) => void;
  setWorkerProgress: (progress: number | null) => void;
  setWorkerStatus: (status: string) => void;
  setError: (message: string | null) => void;
  createGroup: (name?: string) => string;
  importFiles: (files: File[]) => Promise<void>;
  selectGroup: (groupId: string) => void;
  selectSample: (sampleId: string) => void;
  nextSample: () => void;
  prevSample: () => void;
  setAxes: (xChannel: string, yChannel: string) => void;
  setToolMode: (tool: ToolMode) => void;
  setGraphSettings: (settings: Partial<GraphSettings>) => void;
  setCompensationEnabled: (enabled: boolean) => void;
  setTransformEnabled: (enabled: boolean) => void;
  setCofactor: (cofactor: number) => void;
  setAxisScaleMode: (axis: 'x' | 'y', mode: AxisScaleMode) => void;
  setAxisRange: (range: Partial<AxisRangeSettings>) => void;
  setLogicleSettings: (settings: Partial<LogicleSettings>) => void;
  selectPopulation: (populationId: string) => void;
  addPopulation: (population: Omit<PopulationNode, 'id' | 'version' | 'createdAt'>) => string;
  updatePopulation: (populationId: string, updates: Partial<Omit<PopulationNode, 'id' | 'createdAt'>>) => void;
  deletePopulation: (populationId: string) => void;
  renamePopulation: (populationId: string, name: string) => void;
  togglePopulationVisibility: (populationId: string) => void;
  undo: () => void;
  redo: () => void;
  getCurrentProcessingSignature: (sampleId: string) => string;
  ensureProcessedChannels: (sampleId: string, forcedSignature?: string) => string | null;
  getProcessedChannels: (sampleId: string, forcedSignature?: string) => Record<string, Float32Array> | null;
  cacheGateMask: (sampleId: string, key: string, mask: Uint8Array) => void;
  getGateMask: (sampleId: string, key: string) => Uint8Array | null;
  clearGateMaskByPopulation: (populationId: string) => void;
  cacheThumbnail: (sampleId: string, key: string, dataUrl: string) => void;
  getThumbnail: (sampleId: string, key: string) => string | null;
}

function createSnapshot(state: WorkspaceStoreState): HistorySnapshot {
  return {
    populations: clonePopulations(state.populations),
    populationOrder: [...state.populationOrder],
    selectedPopulationId: state.selectedPopulationId,
    xChannel: state.xChannel,
    yChannel: state.yChannel,
    graphSettings: { ...state.graphSettings },
    compensationEnabled: state.compensationEnabled,
    transformEnabled: state.transformEnabled,
    cofactor: state.cofactor,
    xAxisScaleMode: state.xAxisScaleMode,
    yAxisScaleMode: state.yAxisScaleMode,
    axisRange: { ...state.axisRange },
    logicle: { ...state.logicle }
  };
}

function pushHistory(set: (fn: (state: WorkspaceStoreState) => Partial<WorkspaceStoreState>) => void, get: () => WorkspaceStoreState): void {
  const snapshot = createSnapshot(get());
  set((state) => ({
    historyPast: [...state.historyPast.slice(-(MAX_HISTORY - 1)), snapshot],
    historyFuture: []
  }));
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  railMode: 'graphs',
  groups: [],
  samples: {},
  sampleData: {},
  selectedGroupId: null,
  selectedSampleId: null,
  selectedPopulationId: 'ungated',
  populations: {},
  populationOrder: [],
  graphSettings: {
    plotType: 'pseudocolor',
    palette: 'heat',
    backgroundColor: '#070b10',
    smooth: false
  },
  toolMode: 'pointer',
  compensationEnabled: true,
  transformEnabled: true,
  cofactor: DEFAULT_COFACTOR,
  xAxisScaleMode: 'auto',
  yAxisScaleMode: 'auto',
  axisRange: DEFAULT_AXIS_RANGE,
  logicle: DEFAULT_LOGICLE,
  xChannel: '',
  yChannel: '',
  workspaceSearch: '',
  workerProgress: null,
  workerStatus: 'idle',
  error: null,
  historyPast: [],
  historyFuture: [],

  setRailMode: (mode) => set({ railMode: mode }),
  setWorkspaceSearch: (query) => set({ workspaceSearch: query }),
  setWorkerProgress: (progress) => set({ workerProgress: progress }),
  setWorkerStatus: (status) => set({ workerStatus: status }),
  setError: (message) => set({ error: message }),

  createGroup: (name) => {
    const groupId = makeId('group');
    const groupName = name?.trim() ? name : `Group ${get().groups.length + 1}`;

    set((state) => ({
      groups: [...state.groups, { id: groupId, name: groupName, sampleIds: [], createdAt: Date.now() }],
      selectedGroupId: groupId,
      workspaceSearch: ''
    }));

    return groupId;
  },

  importFiles: async (files) => {
    if (files.length === 0) {
      return;
    }

    const groupId = makeId('group');
    const importName = `Import ${new Date().toLocaleTimeString()}`;
    const sampleIds: string[] = [];
    const samplesToAdd: Record<string, WorkspaceSample> = {};
    const sampleDataToAdd: Record<string, SampleDataPayload> = {};
    let firstChannelX = '';
    let firstChannelY = '';
    let firstSampleId: string | null = null;
    const errors: string[] = [];

    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        const parsed = parseFcsFile(buffer);
        const sampleId = makeId('sample');
        const channelNames = parsed.channels.map((channel) => channel.name);

        const rawChannels: Record<string, Float32Array> = {};
        for (const channel of parsed.channels) {
          rawChannels[channel.name] = channel.values;
        }

        sampleIds.push(sampleId);
        samplesToAdd[sampleId] = {
          id: sampleId,
          groupId,
          name: file.name.replace(/\.fcs$/i, ''),
          fileName: file.name,
          eventCount: parsed.eventCount,
          channelNames,
          createdAt: Date.now()
        };

        sampleDataToAdd[sampleId] = {
          sampleId,
          rawChannels,
          eventCount: parsed.eventCount,
          channelNames,
          metadata: {
            fileName: file.name,
            eventCount: parsed.eventCount,
            channelCount: channelNames.length
          },
          spillover: parsed.spillover,
          derivedCache: {
            processedBySignature: {},
            gateMaskByKey: {},
            thumbnailByKey: {}
          }
        };

        if (!firstSampleId) {
          firstSampleId = sampleId;
          firstChannelX = channelNames[0] ?? '';
          firstChannelY = channelNames[1] ?? firstChannelX;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown parsing error';
        errors.push(`${file.name}: ${message}`);
      }
    }

    if (sampleIds.length === 0) {
      set({
        error: errors.length > 0 ? errors.join(' | ') : 'No valid FCS files were imported.'
      });
      return;
    }

    set((state) => ({
      groups: [...state.groups, { id: groupId, name: importName, sampleIds, createdAt: Date.now() }],
      samples: { ...state.samples, ...samplesToAdd },
      sampleData: { ...state.sampleData, ...sampleDataToAdd },
      selectedGroupId: groupId,
      selectedSampleId: firstSampleId,
      xChannel: firstChannelX,
      yChannel: firstChannelY,
      selectedPopulationId: 'ungated',
      error: errors.length > 0 ? errors.join(' | ') : null
    }));
  },

  selectGroup: (groupId) => {
    set((state) => {
      const group = state.groups.find((item) => item.id === groupId);
      if (!group) {
        return state;
      }

      const currentSampleInGroup = state.selectedSampleId ? group.sampleIds.includes(state.selectedSampleId) : false;
      const nextSampleId = currentSampleInGroup ? state.selectedSampleId : group.sampleIds[0] ?? null;
      const sample = nextSampleId ? state.samples[nextSampleId] : null;

      return {
        selectedGroupId: groupId,
        selectedSampleId: nextSampleId,
        xChannel: sample?.channelNames[0] ?? state.xChannel,
        yChannel: sample?.channelNames[1] ?? sample?.channelNames[0] ?? state.yChannel
      };
    });
  },

  selectSample: (sampleId) => {
    set((state) => {
      const sample = state.samples[sampleId];
      if (!sample) {
        return state;
      }

      const xExists = sample.channelNames.includes(state.xChannel);
      const yExists = sample.channelNames.includes(state.yChannel);
      const xChannel = xExists ? state.xChannel : sample.channelNames[0] ?? '';
      const yChannel = yExists ? state.yChannel : sample.channelNames[1] ?? sample.channelNames[0] ?? '';

      return {
        selectedSampleId: sampleId,
        selectedGroupId: sample.groupId,
        xChannel,
        yChannel
      };
    });
  },

  nextSample: () => {
    const state = get();
    const group = state.selectedGroupId ? state.groups.find((item) => item.id === state.selectedGroupId) : null;
    if (!group || group.sampleIds.length === 0 || !state.selectedSampleId) {
      return;
    }

    const currentIdx = group.sampleIds.indexOf(state.selectedSampleId);
    if (currentIdx < 0) {
      return;
    }

    const nextId = group.sampleIds[(currentIdx + 1) % group.sampleIds.length];
    get().selectSample(nextId);
  },

  prevSample: () => {
    const state = get();
    const group = state.selectedGroupId ? state.groups.find((item) => item.id === state.selectedGroupId) : null;
    if (!group || group.sampleIds.length === 0 || !state.selectedSampleId) {
      return;
    }

    const currentIdx = group.sampleIds.indexOf(state.selectedSampleId);
    if (currentIdx < 0) {
      return;
    }

    const prevIdx = (currentIdx - 1 + group.sampleIds.length) % group.sampleIds.length;
    get().selectSample(group.sampleIds[prevIdx]);
  },

  setAxes: (xChannel, yChannel) => {
    const state = get();
    if (state.xChannel === xChannel && state.yChannel === yChannel) {
      return;
    }

    pushHistory(set, get);
    set({ xChannel, yChannel });
  },

  setToolMode: (tool) => set({ toolMode: tool }),

  setGraphSettings: (settings) => {
    pushHistory(set, get);
    set((state) => ({
      graphSettings: {
        ...state.graphSettings,
        ...settings
      }
    }));
  },

  setCompensationEnabled: (enabled) => {
    if (get().compensationEnabled === enabled) {
      return;
    }

    pushHistory(set, get);
    set({ compensationEnabled: enabled });
  },

  setTransformEnabled: (enabled) => {
    if (get().transformEnabled === enabled) {
      return;
    }

    pushHistory(set, get);
    set({ transformEnabled: enabled });
  },

  setCofactor: (cofactor) => {
    const normalized = Math.max(1, cofactor);
    if (get().cofactor === normalized) {
      return;
    }

    pushHistory(set, get);
    set({ cofactor: normalized });
  },

  setAxisScaleMode: (axis, mode) => {
    const state = get();
    if ((axis === 'x' && state.xAxisScaleMode === mode) || (axis === 'y' && state.yAxisScaleMode === mode)) {
      return;
    }

    pushHistory(set, get);
    set(axis === 'x' ? { xAxisScaleMode: mode } : { yAxisScaleMode: mode });
  },

  setAxisRange: (range) => {
    const state = get();
    const next: AxisRangeSettings = {
      ...state.axisRange,
      ...range
    };

    if (
      next.xMin === state.axisRange.xMin &&
      next.xMax === state.axisRange.xMax &&
      next.yMin === state.axisRange.yMin &&
      next.yMax === state.axisRange.yMax
    ) {
      return;
    }

    pushHistory(set, get);
    set({ axisRange: next });
  },

  setLogicleSettings: (settings) => {
    const state = get();
    const next: LogicleSettings = {
      ...state.logicle,
      ...settings
    };

    // Keep parameters in valid ranges.
    next.m = Math.max(0.5, next.m);
    next.w = Math.max(0, next.w);
    next.a = Math.max(0, next.a);

    if (next.m === state.logicle.m && next.w === state.logicle.w && next.a === state.logicle.a) {
      return;
    }

    pushHistory(set, get);
    set({ logicle: next });
  },

  selectPopulation: (populationId) => {
    if (populationId === 'ungated') {
      set({ selectedPopulationId: 'ungated' });
      return;
    }

    const exists = Boolean(get().populations[populationId]);
    set({ selectedPopulationId: exists ? populationId : 'ungated' });
  },

  addPopulation: (population) => {
    pushHistory(set, get);

    const id = makeId('gate');
    const now = Date.now();

    set((state) => ({
      populations: {
        ...state.populations,
        [id]: {
          ...population,
          id,
          version: 1,
          createdAt: now
        }
      },
      populationOrder: [...state.populationOrder, id],
      selectedPopulationId: id,
      historyFuture: []
    }));

    return id;
  },

  updatePopulation: (populationId, updates) => {
    const existing = get().populations[populationId];
    if (!existing) {
      return;
    }

    pushHistory(set, get);

    set((state) => ({
      populations: {
        ...state.populations,
        [populationId]: {
          ...state.populations[populationId],
          ...updates,
          definition: updates.definition ? cloneGateDefinition(updates.definition) : state.populations[populationId].definition,
          version: state.populations[populationId].version + 1
        }
      }
    }));

    get().clearGateMaskByPopulation(populationId);
  },

  deletePopulation: (populationId) => {
    const existing = get().populations[populationId];
    if (!existing) {
      return;
    }

    pushHistory(set, get);

    set((state) => {
      const nextPopulations = { ...state.populations };
      delete nextPopulations[populationId];

      return {
        populations: nextPopulations,
        populationOrder: state.populationOrder.filter((id) => id !== populationId),
        selectedPopulationId: state.selectedPopulationId === populationId ? 'ungated' : state.selectedPopulationId
      };
    });

    get().clearGateMaskByPopulation(populationId);
  },

  renamePopulation: (populationId, name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    get().updatePopulation(populationId, { name: trimmed });
  },

  togglePopulationVisibility: (populationId) => {
    const existing = get().populations[populationId];
    if (!existing) {
      return;
    }

    get().updatePopulation(populationId, { visible: !existing.visible });
  },

  undo: () => {
    const state = get();
    if (state.historyPast.length === 0) {
      return;
    }

    const previous = state.historyPast[state.historyPast.length - 1];
    const currentSnapshot = createSnapshot(state);

    set({
      populations: clonePopulations(previous.populations),
      populationOrder: [...previous.populationOrder],
      selectedPopulationId: previous.selectedPopulationId,
      xChannel: previous.xChannel,
      yChannel: previous.yChannel,
      graphSettings: { ...previous.graphSettings },
      compensationEnabled: previous.compensationEnabled,
      transformEnabled: previous.transformEnabled,
      cofactor: previous.cofactor,
      xAxisScaleMode: previous.xAxisScaleMode,
      yAxisScaleMode: previous.yAxisScaleMode,
      axisRange: { ...previous.axisRange },
      logicle: { ...previous.logicle },
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: [currentSnapshot, ...state.historyFuture]
    });
  },

  redo: () => {
    const state = get();
    if (state.historyFuture.length === 0) {
      return;
    }

    const next = state.historyFuture[0];
    const currentSnapshot = createSnapshot(state);

    set({
      populations: clonePopulations(next.populations),
      populationOrder: [...next.populationOrder],
      selectedPopulationId: next.selectedPopulationId,
      xChannel: next.xChannel,
      yChannel: next.yChannel,
      graphSettings: { ...next.graphSettings },
      compensationEnabled: next.compensationEnabled,
      transformEnabled: next.transformEnabled,
      cofactor: next.cofactor,
      xAxisScaleMode: next.xAxisScaleMode,
      yAxisScaleMode: next.yAxisScaleMode,
      axisRange: { ...next.axisRange },
      logicle: { ...next.logicle },
      historyPast: [...state.historyPast, currentSnapshot].slice(-MAX_HISTORY),
      historyFuture: state.historyFuture.slice(1)
    });
  },

  getCurrentProcessingSignature: (sampleId) => {
    const state = get();
    const sampleData = state.sampleData[sampleId];
    const compensation = state.compensationEnabled && Boolean(sampleData?.spillover);

    return buildProcessingSignature(compensation, state.transformEnabled, state.cofactor);
  },

  ensureProcessedChannels: (sampleId, forcedSignature) => {
    const state = get();
    const sampleData = state.sampleData[sampleId];
    if (!sampleData) {
      return null;
    }

    const signature = forcedSignature ?? state.getCurrentProcessingSignature(sampleId);

    if (sampleData.derivedCache.processedBySignature[signature]) {
      return signature;
    }

    const parsedSignature = parseProcessingSignature(signature);
    const shouldCompensate = parsedSignature.compensate && Boolean(sampleData.spillover);
    const shouldTransform = parsedSignature.transform;

    const channels: ChannelData[] = sampleData.channelNames.map((name) => ({
      name,
      values: sampleData.rawChannels[name]
    }));

    const compensated = shouldCompensate ? applyCompensation(channels, sampleData.spillover) : applyCompensation(channels);
    const processed = shouldTransform ? applyArcsinh(compensated, parsedSignature.cofactor) : compensated;
    const processedMap: Record<string, Float32Array> = {};

    for (const channel of processed) {
      processedMap[channel.name] = channel.values;
    }

    set((current) => {
      const source = current.sampleData[sampleId];
      if (!source) {
        return current;
      }

      return {
        sampleData: {
          ...current.sampleData,
          [sampleId]: {
            ...source,
            derivedCache: {
              ...source.derivedCache,
              processedBySignature: {
                ...source.derivedCache.processedBySignature,
                [signature]: processedMap
              }
            }
          }
        }
      };
    });

    return signature;
  },

  getProcessedChannels: (sampleId, forcedSignature) => {
    const signature = get().ensureProcessedChannels(sampleId, forcedSignature);
    if (!signature) {
      return null;
    }

    const sampleData = get().sampleData[sampleId];
    return sampleData?.derivedCache.processedBySignature[signature] ?? null;
  },

  cacheGateMask: (sampleId, key, mask) => {
    set((state) => {
      const sample = state.sampleData[sampleId];
      if (!sample) {
        return state;
      }

      return {
        sampleData: {
          ...state.sampleData,
          [sampleId]: {
            ...sample,
            derivedCache: {
              ...sample.derivedCache,
              gateMaskByKey: {
                ...sample.derivedCache.gateMaskByKey,
                [key]: mask
              }
            }
          }
        }
      };
    });
  },

  getGateMask: (sampleId, key) => {
    const sample = get().sampleData[sampleId];
    if (!sample) {
      return null;
    }

    return sample.derivedCache.gateMaskByKey[key] ?? null;
  },

  clearGateMaskByPopulation: (populationId) => {
    set((state) => {
      const nextSampleData: Record<string, SampleDataPayload> = {};

      for (const [sampleId, payload] of Object.entries(state.sampleData)) {
        const nextMaskCache: Record<string, Uint8Array> = {};
        const token = `|${populationId}|`;

        for (const [key, value] of Object.entries(payload.derivedCache.gateMaskByKey)) {
          if (!key.includes(token)) {
            nextMaskCache[key] = value;
          }
        }

        nextSampleData[sampleId] = {
          ...payload,
          derivedCache: {
            ...payload.derivedCache,
            gateMaskByKey: nextMaskCache
          }
        };
      }

      return { sampleData: nextSampleData };
    });
  },

  cacheThumbnail: (sampleId, key, dataUrl) => {
    set((state) => {
      const sample = state.sampleData[sampleId];
      if (!sample) {
        return state;
      }

      return {
        sampleData: {
          ...state.sampleData,
          [sampleId]: {
            ...sample,
            derivedCache: {
              ...sample.derivedCache,
              thumbnailByKey: {
                ...sample.derivedCache.thumbnailByKey,
                [key]: dataUrl
              }
            }
          }
        }
      };
    });
  },

  getThumbnail: (sampleId, key) => {
    const sample = get().sampleData[sampleId];
    if (!sample) {
      return null;
    }

    return sample.derivedCache.thumbnailByKey[key] ?? null;
  }
}));
