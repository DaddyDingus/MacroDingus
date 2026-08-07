import dns from "node:dns/promises";
import net from "node:net";

// Guards outbound fetches made on behalf of a user (currently only recipe
// import) against being pointed at the private network the server lives on.
//
// Without this, "fetch a URL and tell me what's on it" is a working port
// scanner and a partial read primitive for every internal service the
// container can route to — the container's own health endpoint, the reverse
// proxy, the identity provider, the container manager, the hypervisor API,
// cloud metadata endpoints. Validating the *scheme* alone (the previous
// behaviour) stops none of that.

const BLOCKED_V4 = [
  { net: "0.0.0.0", bits: 8 },       // "this" network
  { net: "10.0.0.0", bits: 8 },      // RFC1918
  { net: "100.64.0.0", bits: 10 },   // CGNAT / Tailscale
  { net: "127.0.0.0", bits: 8 },     // loopback
  { net: "169.254.0.0", bits: 16 },  // link-local incl. cloud metadata
  { net: "172.16.0.0", bits: 12 },   // RFC1918
  { net: "192.0.0.0", bits: 24 },    // IETF protocol assignments
  { net: "192.168.0.0", bits: 16 },  // RFC1918
  { net: "198.18.0.0", bits: 15 },   // benchmarking
  { net: "224.0.0.0", bits: 4 },     // multicast
  { net: "240.0.0.0", bits: 4 },     // reserved, incl. 255.255.255.255
];

function v4ToInt(address: string): number {
  return address.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedV4(address: string): boolean {
  const value = v4ToInt(address);
  return BLOCKED_V4.some(({ net: base, bits }) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (v4ToInt(base) & mask);
  });
}

/**
 * Expands any IPv6 form to its eight 16-bit groups, or null if unparseable.
 *
 * Matching on the textual form does not work: `new URL()` normalises IPv6
 * hosts, so `[::ffff:127.0.0.1]` arrives here as `::ffff:7f00:1`. A regex
 * looking for a dotted quad sails straight past that and lets loopback
 * through — which is exactly what check-url-guard.ts caught.
 */
function expandV6(address: string): number[] | null {
  let text = address;

  // A trailing dotted quad (::ffff:127.0.0.1) becomes its two hex groups, so
  // both spellings converge on one representation before any comparison.
  const trailingV4 = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (trailingV4) {
    const value = v4ToInt(trailingV4[2]);
    text = `${trailingV4[1]}${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : [];

  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill("0"), ...tail];
  }

  const numeric = groups.map((group) => parseInt(group, 16));
  return numeric.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : numeric;
}

function isBlockedV6(address: string): boolean {
  const groups = expandV6(address.toLowerCase().split("%")[0]); // strip any zone index
  if (!groups) return true; // unparseable — fail closed

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses
  // reach the IPv4 stack, so they must be judged by the IPv4 rules. This also
  // covers `::1` and `::`, which expand to 0.0.0.1 and 0.0.0.0 — both inside
  // the blocked 0.0.0.0/8 and 127.0.0.0/8 space.
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    const value = (((groups[6] << 16) >>> 0) + groups[7]) >>> 0;
    const dotted = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
    return isBlockedV4(dotted);
  }

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7  unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8  multicast
  return false;
}

export function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return isBlockedV4(address);
  if (version === 6) return isBlockedV6(address);
  return true; // not a literal IP — caller resolves first, so this is a bug guard
}

/** Thrown for every rejection, with one message, deliberately. */
export class BlockedUrlError extends Error {
  constructor() {
    // Callers surface this verbatim. It must never distinguish "host does not
    // exist" from "host is internal" from "port is closed" — those three
    // answers are exactly what turns this endpoint into a network scanner.
    super("That link couldn't be fetched");
    this.name = "BlockedUrlError";
  }
}

/**
 * Validates a user-supplied URL and resolves it. Rejects anything that is not
 * plain http/https on a standard web port, and anything that resolves — via
 * ANY returned address — into private or otherwise non-public space.
 *
 * Residual risk: a hostname whose DNS answer changes between this check and
 * the fetch (DNS rebinding) is not fully closed. Doing so needs a custom agent
 * that dials the already-validated IP, which is disproportionate here. The
 * per-hop re-validation in fetchPageText narrows the window to a single
 * request.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BlockedUrlError();
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new BlockedUrlError();

  // Credentials in the URL are never needed for a recipe page and are a
  // classic way to confuse a downstream parser about the real host.
  if (parsed.username || parsed.password) throw new BlockedUrlError();

  const port = parsed.port === "" ? (parsed.protocol === "https:" ? "443" : "80") : parsed.port;
  if (port !== "80" && port !== "443") throw new BlockedUrlError();

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // A bare IP literal skips DNS entirely.
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new BlockedUrlError();
    return parsed;
  }

  let resolved: { address: string }[];
  try {
    resolved = await dns.lookup(hostname, { all: true });
  } catch {
    throw new BlockedUrlError();
  }
  if (resolved.length === 0) throw new BlockedUrlError();

  // EVERY answer must be public. A host that returns one public and one
  // private address would otherwise be a trivial bypass.
  for (const { address } of resolved) {
    if (isBlockedAddress(address)) throw new BlockedUrlError();
  }

  return parsed;
}
