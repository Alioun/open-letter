import { expect, test } from "bun:test";
import { clientIp } from "../server/client-ip.js";

const from = (headers) => new Headers(headers);

test("behind the proxy the address is the hop the proxy appended", () => {
  expect(
    clientIp(from({ "x-forwarded-for": "203.0.113.7" }), "172.18.0.2", true),
  ).toBe("203.0.113.7");
  expect(
    clientIp(
      from({ "x-forwarded-for": "198.51.100.1, 203.0.113.7" }),
      "172.18.0.2",
      true,
    ),
  ).toBe("203.0.113.7");
  expect(
    clientIp(from({ "x-forwarded-for": "2001:db8::1" }), "172.18.0.2", true),
  ).toBe("2001:db8::1");
});

test("a client cannot choose its own rate-limit address", () => {
  const spoofed = from({
    "x-real-ip": "10.9.9.9",
    "x-forwarded-for": "10.1.1.1, 10.2.2.2, 203.0.113.7",
  });
  expect(clientIp(spoofed, "172.18.0.2", true)).toBe("203.0.113.7");
  // X-Real-IP alone names nobody: it is whatever the client typed.
  expect(clientIp(from({ "x-real-ip": "10.9.9.9" }), "172.18.0.2", true)).toBe(
    "172.18.0.2",
  );
  // Not an address at all: nothing to key a limit on, so the peer it is.
  expect(
    clientIp(
      from({ "x-forwarded-for": "203.0.113.7, anything-i-like" }),
      "172.18.0.2",
      true,
    ),
  ).toBe("172.18.0.2");
});

test("without a trusted proxy every forwarding header is ignored", () => {
  const headers = from({
    "x-real-ip": "10.9.9.9",
    "x-forwarded-for": "203.0.113.7",
  });
  expect(clientIp(headers, "192.0.2.4", false)).toBe("192.0.2.4");
  expect(clientIp(headers, undefined, false)).toBe("unknown");
});
