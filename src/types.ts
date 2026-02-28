export interface ChannelData {
  name: string;
  values: Float32Array;
}

export interface SpilloverInfo {
  channels: string[];
  matrix: number[][];
}

export interface ParsedFcs {
  eventCount: number;
  channels: ChannelData[];
  spillover?: SpilloverInfo;
}

export interface DataGate {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ChannelStatistics {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  stdDev: number | null;
  cvPercent: number | null;
  p5: number | null;
  p95: number | null;
  geometricMean: number | null;
}
