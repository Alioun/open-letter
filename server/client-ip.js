import { isIP } from "node:net";

// The address every per-IP rate limit is keyed on.
//
// Behind the reverse proxy the socket peer is the proxy itself, so the client
// address has to come from a header. Only the last X-Forwarded-For entry is
// usable: the proxy appends the peer it actually saw there, while everything
// before it, and X-Real-IP as a whole, arrives as the client sent it. Reading
// either of those let a client pick a fresh "address" per request and walk
// past every limit, the admin login's included.
export function clientIp(headers, socketAddress, trustProxy) {
  if (trustProxy) {
    const hop = (headers.get("x-forwarded-for") || "").split(",").pop().trim();
    if (isIP(hop)) return hop;
  }
  return socketAddress || "unknown";
}
