export interface JobEnqueuer {
  enqueue(name: string, data: unknown, jobId: string): Promise<void>;
}
