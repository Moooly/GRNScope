/** Schedule from completion, so a slow connection never stacks requests. */
export function startPolling(
  task: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  immediate = false,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const run = async () => {
    try {
      await task(controller.signal);
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(run, intervalMs);
    }
  };
  if (immediate) void run();
  else timer = setTimeout(run, intervalMs);
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
