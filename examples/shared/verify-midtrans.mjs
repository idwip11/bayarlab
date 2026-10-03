import { createHash, timingSafeEqual } from "node:crypto";

export function verifyMidtrans(payload, serverKey) {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof payload.order_id !== "string" ||
    typeof payload.status_code !== "string" ||
    typeof payload.gross_amount !== "string" ||
    typeof payload.signature_key !== "string" ||
    !/^[a-f0-9]{128}$/i.test(payload.signature_key)
  ) {
    return false;
  }
  const expected = createHash("sha512")
    .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`, "utf8")
    .digest();
  const actual = Buffer.from(payload.signature_key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
