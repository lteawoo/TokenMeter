import net from "node:net";
import { spawn } from "node:child_process";

const DEFAULT_DEV_PORT = 5173;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, "localhost");
  });
}

function getRandomAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        const port = address.port;
        server.close(() => {
          resolve(port);
        });
        return;
      }

      server.close(() => {
        reject(new Error("Failed to resolve an available dashboard dev port."));
      });
    });

    server.listen(0, "localhost");
  });
}

async function resolveDevPort() {
  const requestedPort = Number.parseInt(
    process.env.TOKENMETER_DASHBOARD_DEV_PORT ?? "",
    10,
  );

  if (Number.isInteger(requestedPort) && requestedPort > 0) {
    return requestedPort;
  }

  if (await isPortAvailable(DEFAULT_DEV_PORT)) {
    return DEFAULT_DEV_PORT;
  }

  return getRandomAvailablePort();
}

const port = await resolveDevPort();
const devUrl = `http://localhost:${port}`;
const config = {
  build: {
    devUrl,
    beforeDevCommand: [
      "VITE_TOKENMETER_RUNTIME=desktop",
      `TOKENMETER_DASHBOARD_DEV_PORT=${port}`,
      "pnpm exec vite",
      "--host localhost",
      `--port ${port}`,
      "--strictPort",
    ].join(" "),
  },
};

console.log(`Starting TokenMeter desktop dev server on ${devUrl}`);

const child = spawn(
  "pnpm",
  ["exec", "tauri", "dev", "--config", JSON.stringify(config), ...process.argv.slice(2)],
  {
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
