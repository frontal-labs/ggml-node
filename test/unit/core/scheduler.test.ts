import { describe, expect, it } from "vitest";
import { isInboardError } from "../../../src/core/errors.js";
import { Scheduler } from "../../../src/core/scheduler.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Scheduler", () => {
  it("hands out sequences up to the pool size, then queues FIFO", async () => {
    const s = new Scheduler({ sequences: 2, maxQueue: 10 });
    const a = await s.acquire(undefined);
    const b = await s.acquire(undefined);
    expect(new Set([a.index, b.index]).size).toBe(2);

    const order: string[] = [];
    const c = s.acquire(undefined).then((l) => {
      order.push("c");
      return l;
    });
    const d = s.acquire(undefined).then((l) => {
      order.push("d");
      return l;
    });
    await flush();
    expect(s.queueLength).toBe(2);

    a.release();
    const lc = await c;
    expect(lc.index).toBe(a.index);
    lc.release();
    (await d).release();
    b.release();
    expect(order).toEqual(["c", "d"]);
    expect(s.running).toBe(0);
  });

  it("never runs more requests than there are sequences", async () => {
    const s = new Scheduler({ sequences: 2, maxQueue: 10 });
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        const lease = await s.acquire(undefined);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        lease.release();
      }),
    );
    expect(peak).toBe(2);
  });

  it("rejects with QUEUE_FULL when the queue is at maxQueue", async () => {
    const s = new Scheduler({ sequences: 1, maxQueue: 1 });
    const held = await s.acquire(undefined);
    void s.acquire(undefined); // occupies the single queue slot
    const err = await s.acquire(undefined).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isInboardError(err) && err.code).toBe("QUEUE_FULL");
    expect(isInboardError(err) && err.hint.length > 0).toBe(true);
    held.release();
  });

  it("removes an aborted request from the queue and rejects with ABORTED", async () => {
    const s = new Scheduler({ sequences: 1, maxQueue: 5 });
    const held = await s.acquire(undefined);
    const controller = new AbortController();
    const waiting = s.acquire(controller.signal);
    expect(s.queueLength).toBe(1);

    controller.abort();
    const err = await waiting.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isInboardError(err) && err.code).toBe("ABORTED");
    expect(s.queueLength).toBe(0);

    held.release();
    const next = await s.acquire(undefined);
    expect(next.index).toBe(held.index);
    next.release();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const s = new Scheduler({ sequences: 1, maxQueue: 0 });
    const controller = new AbortController();
    controller.abort();
    const err = await s.acquire(controller.signal).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isInboardError(err) && err.code).toBe("ABORTED");
  });

  it("release is idempotent", async () => {
    const s = new Scheduler({ sequences: 1, maxQueue: 0 });
    const lease = await s.acquire(undefined);
    lease.release();
    lease.release();
    expect(s.running).toBe(0);
  });

  it("reports the queue length when a request has to wait", async () => {
    const s = new Scheduler({ sequences: 1, maxQueue: 5 });
    const held = await s.acquire(undefined);
    const seen: number[] = [];
    void s.acquire(undefined, (n) => seen.push(n));
    expect(seen).toEqual([1]);
    held.release();
  });
});
