import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
  ComputeDensity2DPayload,
  ComputeDensity2DResult,
  ComputeGateMaskPayload,
  ComputeGateMaskResult,
  DownsamplePointsPayload,
  DownsamplePointsResult
} from './analysis.types';

type TaskResultMap = {
  computeGateMask: ComputeGateMaskResult;
  computeDensity2D: ComputeDensity2DResult;
  downsamplePoints: DownsamplePointsResult;
};

type PendingJob = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number) => void;
};

function makeJobId(task: string): string {
  return `${task}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class AnalysisClient {
  private worker: Worker;
  private pending = new Map<string, PendingJob>();

  constructor() {
    this.worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
      this.handleResponse(event.data);
    };
    this.worker.onerror = (event: ErrorEvent) => {
      const message = event.message || 'Analysis worker crashed';
      for (const [jobId, job] of this.pending.entries()) {
        job.reject(new Error(message));
        this.pending.delete(jobId);
      }
    };
  }

  private handleResponse(response: AnalysisWorkerResponse): void {
    const job = this.pending.get(response.jobId);
    if (!job) {
      return;
    }

    if (response.type === 'progress') {
      job.onProgress?.(response.progress);
      return;
    }

    if (response.type === 'error') {
      this.pending.delete(response.jobId);
      job.reject(new Error(response.message));
      return;
    }

    this.pending.delete(response.jobId);
    job.resolve(response.payload);
  }

  private runTask<TTask extends keyof TaskResultMap>(
    type: TTask,
    payload: Extract<AnalysisWorkerRequest, { type: TTask }>['payload'],
    onProgress?: (progress: number) => void
  ): { jobId: string; promise: Promise<TaskResultMap[TTask]>; cancel: () => void } {
    const jobId = makeJobId(type);

    const promise = new Promise<TaskResultMap[TTask]>((resolve, reject) => {
      this.pending.set(jobId, {
        resolve: (value) => resolve(value as TaskResultMap[TTask]),
        reject,
        onProgress
      });

      const message = { type, jobId, payload } as AnalysisWorkerRequest;
      this.worker.postMessage(message);
    });

    return {
      jobId,
      promise,
      cancel: () => {
        if (!this.pending.has(jobId)) {
          return;
        }
        this.pending.delete(jobId);
        this.worker.postMessage({ type: 'cancelJob', jobId } satisfies AnalysisWorkerRequest);
      }
    };
  }

  computeGateMask(payload: ComputeGateMaskPayload, onProgress?: (progress: number) => void) {
    return this.runTask('computeGateMask', payload, onProgress);
  }

  computeDensity2D(payload: ComputeDensity2DPayload, onProgress?: (progress: number) => void) {
    return this.runTask('computeDensity2D', payload, onProgress);
  }

  downsamplePoints(payload: DownsamplePointsPayload, onProgress?: (progress: number) => void) {
    return this.runTask('downsamplePoints', payload, onProgress);
  }
}

export const analysisClient = new AnalysisClient();
