import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const RANGE_START = /bytes=(?<start>\d+)-/u;

export interface FixtureOptions {
  /** Ignore the Range header and always send the whole body with 200. */
  ignoreRange?: boolean;
  /** Send this many bytes and then never finish, so the client can be aborted. */
  stallAfter?: number;
}

export interface FixtureServer {
  close: () => Promise<void>;
  /** Range header of each request, in order. `undefined` when no Range was sent. */
  requests: (string | undefined)[];
  url: string;
}

/** Local HTTP server with Range support. Used instead of the network in unit tests. */
export async function startFixtureServer(
  body: Buffer,
  options: FixtureOptions = {},
): Promise<FixtureServer> {
  const requests: (string | undefined)[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const { range } = req.headers;
    requests.push(range);

    let start = 0;
    let status = 200;
    if (range && !options.ignoreRange) {
      start = Number(RANGE_START.exec(range)?.groups?.start ?? 0);
      if (start >= body.length) {
        res.writeHead(416, { "content-range": `bytes */${body.length}` });
        res.end();
        return;
      }
      status = 206;
    }

    const slice = body.subarray(start);
    const headers: Record<string, string | number> = { "content-length": slice.length };
    if (status === 206) {
      headers["content-range"] = `bytes ${start}-${body.length - 1}/${body.length}`;
    }
    res.writeHead(status, headers);

    if (options.stallAfter !== undefined) {
      res.write(slice.subarray(0, options.stallAfter));
      return;
    }
    res.end(slice);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    requests,
    url: `http://127.0.0.1:${port}/model.gguf`,
  };
}
