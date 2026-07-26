/**
 * Global serial MEMORY mutation queue (README memoryQueue).
 * One mutation at a time: reflect, compact, restore, import.
 */
export function createMemoryQueue() {
  /** @type {Promise<void>} */
  let tail = Promise.resolve();
  let depth = 0;

  function enqueue(job) {
    depth += 1;
    const run = tail.then(() => job()).finally(() => {
      depth -= 1;
    });
    // Keep chain alive even if job rejects
    tail = run.catch(() => {});
    return run;
  }

  function pending() {
    return depth;
  }

  return { enqueue, pending };
}
