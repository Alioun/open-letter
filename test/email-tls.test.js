import { test, expect } from "bun:test";
import { createServer } from "node:net";
import { createServer as createTlsServer } from "node:tls";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { smtpOptions } from "../server/email-setup.js";

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
const close = (server) => new Promise((resolve) => server.close(resolve));
const profile = {
  host: "localhost",
  user: "fixture@example.org",
  secret: "fixture-only-password",
  secure: false,
};

test("SMTP refuses a STARTTLS downgrade before sending credentials", async () => {
  const commands = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 fixture ESMTP\r\n");
    socket.on("data", (data) => {
      commands.push(data.toString());
      socket.write("250-fixture\r\n250 AUTH PLAIN LOGIN\r\n");
    });
  });
  const port = await listen(server);
  const transport = nodemailer.createTransport(
    smtpOptions({ ...profile, port }),
  );
  try {
    await expect(transport.verify()).rejects.toThrow();
    expect(commands.join(" ")).not.toContain("AUTH PLAIN ");
    expect(commands.join(" ")).not.toContain(
      Buffer.from(profile.secret).toString("base64"),
    );
  } finally {
    transport.close();
    for (const socket of sockets) socket.destroy();
    await close(server);
  }
});

test("SMTP validates certificates and delivers over trusted TLS", async () => {
  const directory = mkdtempSync(join(tmpdir(), "campaign-tls-"));
  const key = join(directory, "key.pem"),
    cert = join(directory, "cert.pem");
  const generated = Bun.spawnSync(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
  expect(generated.exitCode).toBe(0);
  let accepted = 0;
  const sockets = new Set();
  const server = createTlsServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      socket.write("220 fixture ESMTP\r\n");
      let buffer = "",
        dataMode = false;
      socket.on("data", (data) => {
        buffer += data;
        while (buffer.includes("\r\n")) {
          const index = buffer.indexOf("\r\n");
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (dataMode) {
            if (line === ".") {
              dataMode = false;
              accepted++;
              socket.write("250 accepted fixture-id\r\n");
            }
            continue;
          }
          if (/^EHLO/.test(line))
            socket.write("250-fixture\r\n250 AUTH PLAIN\r\n");
          else if (/^AUTH/.test(line)) socket.write("235 authenticated\r\n");
          else if (line === "DATA") {
            dataMode = true;
            socket.write("354 data\r\n");
          } else if (line === "QUIT") socket.end("221 bye\r\n");
          else socket.write("250 ok\r\n");
        }
      });
    },
  );
  server.on("tlsClientError", () => {});
  const port = await listen(server);
  const options = smtpOptions({ ...profile, port, secure: true });
  const untrusted = nodemailer.createTransport(options);
  const trusted = nodemailer.createTransport({
    ...options,
    tls: { ...options.tls, ca: readFileSync(cert) },
  });
  try {
    await expect(untrusted.verify()).rejects.toThrow();
    await trusted.verify();
    const result = await trusted.sendMail({
      from: profile.user,
      to: "receiver@example.org",
      subject: "TLS fixture",
      text: "Secure delivery",
    });
    expect(result.accepted).toEqual(["receiver@example.org"]);
    expect(accepted).toBe(1);
  } finally {
    untrusted.close();
    trusted.close();
    for (const socket of sockets) socket.destroy();
    await close(server);
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
