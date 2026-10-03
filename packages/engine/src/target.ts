import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { BayarLabError } from "@bayarlab/core";

export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export function parseTarget(targetUrl: string): URL {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new BayarLabError("INVALID_TARGET", "Target must be a complete HTTP(S) URL.");
  }
  if (
    !/^https?:\/\//i.test(targetUrl) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new BayarLabError(
      "INVALID_TARGET",
      "Target must use HTTP(S), with no embedded credentials or fragment.",
    );
  }
  if (!url.hostname || url.hostname.endsWith(".")) {
    throw new BayarLabError("INVALID_TARGET", "Target hostname is invalid.");
  }
  return url;
}

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const bytes = address.split(".").map(Number);
  return bytes.length === 4 ? bytes : null;
}

function isUnsafeAddress(address: string): boolean {
  const ipv4 = ipv4Bytes(address);
  if (ipv4) {
    const [first, second, third, fourth] = ipv4;
    if (first === undefined || second === undefined || third === undefined || fourth === undefined)
      return true;
    return (
      first === 0 ||
      (first === 169 && second === 254) ||
      (first === 100 && second === 100 && third === 100 && fourth === 200) ||
      (first === 192 && second === 0 && third === 0 && fourth === 192) ||
      first >= 224
    );
  }
  const lower = address.toLowerCase();
  if (lower === "fd00:ec2::254") return true;
  if (
    lower === "::" ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff")
  )
    return true;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice(7);
    return mapped.includes(".") ? isUnsafeAddress(mapped) : true;
  }
  return false;
}

function isDevelopmentAddress(address: string): boolean {
  const ipv4 = ipv4Bytes(address);
  if (ipv4) {
    const [first, second] = ipv4;
    return (
      first === 127 ||
      first === 10 ||
      (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  const lower = address.toLowerCase();
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd");
}

function looksProduction(hostname: string): boolean {
  return /(^|[.-])(prod|production)([.-]|$)/i.test(hostname);
}

export async function resolveTarget(
  targetUrl: string,
  allowRemoteTarget = false,
): Promise<ResolvedTarget> {
  const url = parseTarget(targetUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (cause) {
    throw new BayarLabError("DNS_FAILURE", "Could not resolve target hostname.", { cause });
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isUnsafeAddress(address))) {
    throw new BayarLabError("UNSAFE_TARGET", "Target resolved to a reserved or unsafe address.");
  }
  if (
    !allowRemoteTarget &&
    (looksProduction(hostname) || addresses.some(({ address }) => !isDevelopmentAddress(address)))
  ) {
    throw new BayarLabError(
      "REMOTE_TARGET_NOT_ALLOWED",
      "Remote or production-labelled target requires explicit allowRemoteTarget.",
    );
  }
  const selected = addresses[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6)) {
    throw new BayarLabError("DNS_FAILURE", "Target has no usable IP address.");
  }
  return { url, address: selected.address, family: selected.family };
}
