import { describe, expect, test } from "bun:test";

import { privateAddress } from "../../src/v2/importer";

describe("privateAddress", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "172.20.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::",
    "::1",
    "fd00::1",
    "fe80::1%eth0",
    "fec0::1",
    // IPv4 hidden inside IPv6, including the hex form WHATWG URL normalizes [::ffff:127.0.0.1] to
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:c0a8:101",
    "::7f00:1",
    "64:ff9b::c0a8:101",
    "2002:c0a8:101::1",
  ])("blocks %s", (ip) => {
    expect(privateAddress(ip)).toBe(true);
  });

  test.each(["8.8.8.8", "1.1.1.1", "2606:4700::1111", "::ffff:8.8.8.8", "2002:808:808::1"])("allows %s", (ip) => {
    expect(privateAddress(ip)).toBe(false);
  });

  test("treats anything that isn't an IP as blocked", () => {
    expect(privateAddress("localhost")).toBe(true);
  });

  test("URL parsing doesn't hide a loopback address", () => {
    const host = new URL("http://[::ffff:127.0.0.1]:3000/").hostname.replace(/^\[|\]$/g, "");
    expect(privateAddress(host)).toBe(true);
  });
});
