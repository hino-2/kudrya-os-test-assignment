export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function randomInRange(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}
