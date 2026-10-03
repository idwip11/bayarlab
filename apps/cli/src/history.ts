import type { DeliveryResult, WireRequest } from "@bayarlab/core";

export interface SessionRecord {
  id: string;
  provider: string;
  scenario: string;
  request: WireRequest;
  result: DeliveryResult;
}

/** In-memory only. The original unredacted request is retained solely for replay. */
export class SessionHistory {
  readonly #records: SessionRecord[] = [];

  constructor(private readonly limit = 100) {}

  add(record: SessionRecord): void {
    this.#records.push(record);
    if (this.#records.length > this.limit) this.#records.shift();
  }

  latest(): SessionRecord | undefined {
    return this.#records.at(-1);
  }

  list(): readonly SessionRecord[] {
    return this.#records.map((record) => ({ ...record }));
  }
}
