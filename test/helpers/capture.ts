export async function captureStdout(run: () => Promise<void> | void): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = "";

  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const callback = args.find((value): value is (error?: Error | null) => void => typeof value === "function");
    callback?.(null);
    return true;
  }) as typeof process.stdout.write;

  try {
    await run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return output;
}
