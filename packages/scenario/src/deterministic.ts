import { createHash } from "node:crypto";

/**
 * Derive a deterministic UUID-v4-formatted identifier from a seed, step index,
 * and label.  The result is a SHA-256 digest truncated and formatted as a
 * UUID v4 string so that downstream code that expects UUID format continues to
 * work, while still being fully reproducible from the inputs.
 */
export function deriveId(seed: string, index: number, label: string): string {
  const hash = createHash("sha256").update(`${seed}:${index}:${label}`, "utf8").digest("hex");

  // Format first 32 hex chars as UUID v4:
  // xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where y is one of 8, 9, a, b
  const hex = hash.slice(0, 32);
  const rawChar = hex[16] ?? "0";
  const yChar = ((Number.parseInt(rawChar, 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${yChar}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Derive a deterministic timestamp by offsetting `base` by `stepIndex` seconds.
 * This gives each step in a deterministic scenario a distinct, ordered timestamp.
 */
export function deriveTimestamp(base: Date | string, stepIndex: number): Date {
  const baseMs = typeof base === "string" ? new Date(base).getTime() : base.getTime();
  if (Number.isNaN(baseMs)) {
    throw new Error("Invalid base timestamp for deterministic clock.");
  }
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) {
    throw new Error("Step index must be a non-negative integer.");
  }
  return new Date(baseMs + stepIndex * 1_000);
}
