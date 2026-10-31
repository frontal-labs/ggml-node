import { NodeSlmError } from "@/core/errors.js";

export interface SchedulerOptions {
  /** Requests allowed to wait beyond the running ones. Overflow throws `QUEUE_FULL`. */
  maxQueue: number;
  /** Number of backend sequences, which is also the maximum number of running requests. */
  sequences: number;
}

export interface Lease {
  /** Index of the backend sequence this request owns. */
  index: number;
  /** Milliseconds spent waiting for a free sequence. */
  queueMs: number;
  release: () => void;
}

interface Waiter {
  cleanup: () => void;
  enqueuedAt: number;
  resolve: (lease: Lease) => void;
}

/**
 * A pool of backend sequences with a bounded FIFO queue. A released sequence goes straight to
 * the next waiter, so the order is preserved and nothing is lost between release and acquire.
 */
export class Scheduler {
  private readonly total: number;
  private readonly free: number[];
  private readonly queue: Waiter[] = [];
  private readonly maxQueue: number;

  constructor(options: SchedulerOptions) {
    this.total = options.sequences;
    this.maxQueue = options.maxQueue;
    this.free = Array.from({ length: options.sequences }, (_, i) => i);
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.total - this.free.length;
  }

  /**
   * Takes a sequence, or waits for one. `onQueued` runs when the request has to wait.
   * Rejects with `QUEUE_FULL` when the queue is at `maxQueue`, and with `ABORTED` if the signal
   * fires while waiting (the request is removed from the queue).
   */
  acquire(
    signal: AbortSignal | undefined,
    onQueued?: (queueLength: number) => void,
  ): Promise<Lease> {
    if (signal?.aborted) {
      return Promise.reject(abortedError());
    }

    const index = this.free.shift();
    if (index !== undefined) {
      return Promise.resolve(this.makeLease(index, 0));
    }

    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(
        new NodeSlmError("QUEUE_FULL", `Queue is full (${this.maxQueue} waiting requests)`, {
          hint: "Retry later, or raise maxQueue or maxConcurrency.",
        }),
      );
    }

    return new Promise<Lease>((resolve, reject) => {
      const onAbort = () => {
        const i = this.queue.indexOf(waiter);
        if (i !== -1) {
          this.queue.splice(i, 1);
        }
        reject(abortedError());
      };
      const waiter: Waiter = {
        cleanup: () => signal?.removeEventListener("abort", onAbort),
        enqueuedAt: performance.now(),
        resolve,
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
      onQueued?.(this.queue.length);
    });
  }

  /** Waits until every running request has released its sequence and nothing is queued. */
  async drain(): Promise<void> {
    while (this.running > 0 || this.queue.length > 0) {
      // Polling is intentional here: drain runs only at unload, and it needs no event wiring.
      // biome-ignore lint/performance/noAwaitInLoops: polling loop by design
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private makeLease(index: number, queueMs: number): Lease {
    let released = false;
    return {
      index,
      queueMs,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.handOff(index);
      },
    };
  }

  private handOff(index: number): void {
    const next = this.queue.shift();
    if (!next) {
      this.free.push(index);
      return;
    }
    next.cleanup();
    next.resolve(this.makeLease(index, performance.now() - next.enqueuedAt));
  }
}

export function abortedError(cause?: unknown): NodeSlmError {
  return new NodeSlmError("ABORTED", "The request was aborted", {
    cause,
    hint: "The signal fired. Call again if you still need the result.",
  });
}
