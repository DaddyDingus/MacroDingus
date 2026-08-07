// Verification for the SSRF guard (engine/urlGuard.ts).
//
// This repo has no test framework and deliberately isn't gaining one (see
// README "Development"), but a security control with no check at all is worse
// than the missing framework. This is a plain script: no runner, no
// dependencies, no network access for the literal-IP cases.
//
//   npm run build && node dist/scripts/check-url-guard.js
//
// Exits non-zero on any failure so it can gate a build if wanted.

import { assertPublicUrl, isBlockedAddress } from "../engine/urlGuard.js";

let failures = 0;

function check(label: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    console.log(`  ok    ${label}`);
  } else {
    console.error(`  FAIL  ${label} — expected ${expected}, got ${actual}`);
    failures++;
  }
}

async function expectBlocked(url: string) {
  try {
    await assertPublicUrl(url);
    console.error(`  FAIL  ${url} — was allowed, should have been blocked`);
    failures++;
  } catch {
    console.log(`  ok    blocked ${url}`);
  }
}

async function expectAllowed(url: string) {
  try {
    await assertPublicUrl(url);
    console.log(`  ok    allowed ${url}`);
  } catch (err) {
    console.error(`  FAIL  ${url} — was blocked: ${(err as Error).message}`);
    failures++;
  }
}

console.log("\naddress classification (no DNS):");
for (const address of [
  "127.0.0.1", "127.5.5.5", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255",
  "192.168.20.50", "192.168.20.111", "169.254.169.254", "100.64.1.1", "224.0.0.1",
  "255.255.255.255", "::1", "::", "fe80::1", "fd00::1", "fc00::1", "ff02::1",
  "::ffff:127.0.0.1", "::ffff:192.168.20.50",
]) {
  check(`${address} blocked`, isBlockedAddress(address), true);
}
for (const address of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "192.169.0.1", "2606:4700:4700::1111"]) {
  check(`${address} allowed`, isBlockedAddress(address), false);
}

console.log("\nURL rejection (literal IPs — the homelab's own surface):");
await expectBlocked("http://127.0.0.1:3000/api/health");     // the app itself
await expectBlocked("http://192.168.20.50:9000/");            // portainer
await expectBlocked("http://192.168.20.111:8006/");           // proxmox api
await expectBlocked("http://192.168.20.55:8098/");            // a sibling app
await expectBlocked("http://169.254.169.254/latest/meta-data/");
await expectBlocked("http://[::1]/");
await expectBlocked("http://[::ffff:127.0.0.1]/");

console.log("\nURL rejection (scheme, port, credentials):");
await expectBlocked("file:///etc/passwd");
await expectBlocked("gopher://example.com/");
await expectBlocked("http://example.com:22/");                // non-web port
await expectBlocked("http://example.com:11434/");             // ollama
await expectBlocked("http://user:pass@example.com/");         // embedded credentials
await expectBlocked("not-a-url");

console.log("\nURL acceptance (public — requires DNS):");
await expectAllowed("https://www.taste.com.au/");
await expectAllowed("http://example.com/");

console.log(
  failures === 0
    ? "\nurl guard: all checks passed\n"
    : `\nurl guard: ${failures} FAILURE(S)\n`
);
process.exit(failures === 0 ? 0 : 1);
