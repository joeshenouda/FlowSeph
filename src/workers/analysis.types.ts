import type { GateDefinition } from '../store/types';

export interface ComputeGateMaskPayload {
  xValues: Float32Array<ArrayBufferLike>;
  yValues: Float32Array<ArrayBufferLike>;
  gate: GateDefinition;
  parentMask?: Uint8Array<ArrayBufferLike> | null;
}

export interface ComputeGateMaskResult {
  mask: Uint8Array<ArrayBufferLike>;
}

export interface ComputeDensity2DPayload {
  xValues: Float32Array<ArrayBufferLike>;
  yValues: Float32Array<ArrayBufferLike>;
  mask?: Uint8Array<ArrayBufferLike> | null;
  width: number;
  height: number;
  smooth: boolean;
  xDomain?: [number, number];
  yDomain?: [number, number];
  qLow?: number;
  qHigh?: number;
  domainPadding?: number;
  debug?: boolean;
}

export interface ComputeDensity2DResult {
  grid: Float32Array<ArrayBufferLike>;
  width: number;
  height: number;
  xDomain: [number, number];
  yDomain: [number, number];
  maxDensity: number;
}

export interface DownsamplePointsPayload {
  xValues: Float32Array<ArrayBufferLike>;
  yValues: Float32Array<ArrayBufferLike>;
  mask?: Uint8Array<ArrayBufferLike> | null;
  maxPoints: number;
  seed: string;
}

export interface DownsamplePointsResult {
  xValues: Float32Array<ArrayBufferLike>;
  yValues: Float32Array<ArrayBufferLike>;
}

export type AnalysisWorkerRequest =
  | { type: 'computeGateMask'; jobId: string; payload: ComputeGateMaskPayload }
  | { type: 'computeDensity2D'; jobId: string; payload: ComputeDensity2DPayload }
  | { type: 'downsamplePoints'; jobId: string; payload: DownsamplePointsPayload }
  | { type: 'cancelJob'; jobId: string };

export type AnalysisWorkerResponse =
  | { type: 'progress'; jobId: string; progress: number }
  | {
      type: 'result';
      jobId: string;
      task: 'computeGateMask';
      payload: ComputeGateMaskResult;
    }
  | {
      type: 'result';
      jobId: string;
      task: 'computeDensity2D';
      payload: ComputeDensity2DResult;
    }
  | {
      type: 'result';
      jobId: string;
      task: 'downsamplePoints';
      payload: DownsamplePointsResult;
    }
  | { type: 'error'; jobId: string; message: string };
