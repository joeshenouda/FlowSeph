import type { SpilloverInfo } from '../types';

export type RailMode = 'workspace' | 'graphs' | 'tables' | 'layout' | 'settings';
export type PlotType = 'scatter' | 'density' | 'pseudocolor';
export type ToolMode = 'pointer' | 'rectangle' | 'polygon' | 'quadrant' | 'ellipse';
export type QuadrantLabel = 'Q1' | 'Q2' | 'Q3' | 'Q4';
export type AxisScaleMode = 'auto' | 'linear' | 'logicle';

export interface WorkspaceGroup {
  id: string;
  name: string;
  sampleIds: string[];
  createdAt: number;
}

export interface WorkspaceSample {
  id: string;
  groupId: string;
  name: string;
  fileName: string;
  channelNames: string[];
  eventCount: number;
  createdAt: number;
}

export interface RectGateDefinition {
  kind: 'rectangle';
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface PolygonGateDefinition {
  kind: 'polygon';
  points: Array<{ x: number; y: number }>;
}

export interface QuadrantGateDefinition {
  kind: 'quadrant';
  xThreshold: number;
  yThreshold: number;
  quadrant: QuadrantLabel;
}

export interface EllipseGateDefinition {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
}

export type GateDefinition =
  | RectGateDefinition
  | PolygonGateDefinition
  | QuadrantGateDefinition
  | EllipseGateDefinition;

export interface PopulationNode {
  id: string;
  name: string;
  parentId: 'ungated' | string;
  type: GateDefinition['kind'];
  visible: boolean;
  xChannel: string;
  yChannel: string;
  transformSignature: string;
  definition: GateDefinition;
  version: number;
  createdAt: number;
}

export interface GraphSettings {
  plotType: PlotType;
  palette: 'cyan' | 'heat' | 'viridis' | 'orange';
  backgroundColor: string;
  smooth: boolean;
}

export interface LogicleSettings {
  m: number;
  w: number;
  a: number;
}

export interface AxisRangeSettings {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface PanelLayoutState {
  mainHorizontal: number[];
  leftVertical: number[];
  centerVertical: number[];
}

export interface SampleDerivedCache {
  processedBySignature: Record<string, Record<string, Float32Array>>;
  gateMaskByKey: Record<string, Uint8Array>;
  thumbnailByKey: Record<string, string>;
}

export interface SampleDataPayload {
  sampleId: string;
  rawChannels: Record<string, Float32Array>;
  eventCount: number;
  channelNames: string[];
  metadata: Record<string, string | number>;
  spillover?: SpilloverInfo;
  derivedCache: SampleDerivedCache;
}

export interface HistorySnapshot {
  populations: Record<string, PopulationNode>;
  populationOrder: string[];
  selectedPopulationId: string;
  xChannel: string;
  yChannel: string;
  graphSettings: GraphSettings;
  compensationEnabled: boolean;
  transformEnabled: boolean;
  cofactor: number;
  xAxisScaleMode: AxisScaleMode;
  yAxisScaleMode: AxisScaleMode;
  axisRange: AxisRangeSettings;
  logicle: LogicleSettings;
}
