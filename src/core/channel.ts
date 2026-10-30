/**
 * A minimal push-based async channel. The producer pushes values and then closes or fails it.
 * The consumer iterates with `for await`. Used to turn backend deltas into `textStream`.
 */
export class AsyncChannel<T> {
  private readonly buffered: T[] = [];
  private readonly waiting: ((r: IteratorResult<T>) => void)[] = [];
  private readonly rejecting: ((err: unknown) => void)[] = [];
  private done = false;
  private error: unknown;
  private failed = false;

  push(value: T): void {
    if (this.done) return;
    const waiter = this.waiting.shift();
    this.rejecting.shift();
    if (waiter) waiter({ value, done: false });
    else this.buffered.push(value);
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    for (const waiter of this.waiting.splice(0)) waiter({ value: undefined, done: true });
    this.rejecting.splice(0);
  }

  fail(err: unknown): void {
    if (this.done) return;
    this.done = true;
    this.failed = true;
    this.error = err;
    for (const reject of this.rejecting.splice(0)) reject(err);
    this.waiting.splice(0);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buffered.length > 0) {
          return Promise.resolve({ value: this.buffered.shift() as T, done: false });
        }
        if (this.done) {
          return this.failed
            ? Promise.reject(this.error)
            : Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiting.push(resolve);
          this.rejecting.push(reject);
        });
      },
    };
  }
}
