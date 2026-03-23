export async function withMockedPlatform<T>(platform: NodeJS.Platform, action: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");

  if (!descriptor) {
    throw new Error("process.platform descriptor is unavailable");
  }

  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform
  });

  try {
    return await action();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}
