export interface ActivityLoadGeneration {
  begin(): number;
  invalidate(): void;
  isCurrent(generation: number): boolean;
}

export function createActivityLoadGeneration(): ActivityLoadGeneration {
  let current = 0;
  return {
    begin(): number {
      current += 1;
      return current;
    },
    invalidate(): void {
      current += 1;
    },
    isCurrent(generation: number): boolean {
      return generation === current;
    },
  };
}

export async function settleLatestActivityLoad<T>(
  generations: ActivityLoadGeneration,
  generation: number,
  request: Promise<T>,
  onSuccess: (value: T) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    const value = await request;
    if (generations.isCurrent(generation)) {
      onSuccess(value);
    }
  } catch (error) {
    if (generations.isCurrent(generation)) {
      onError(error);
    }
  }
}
