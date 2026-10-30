import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FixtureOptions {
  /** Ignore the Range header and always send the whole body with 200. */
  ignoreRange?: boolean;
  /** On the first request only, send this many bytes and then drop the connection. */
  truncateFirstAfter?: number;
  /** Send this many bytes and then never finish, so the client can be aborted. */
  stallAfter?: number;
}

export interface FixtureServer {
  url: string;
  /** Range header of each request, in order. `undefined` when no Range was sent. */
  requests: (string | undefined)[];
  close(): Promise<void>;
}

/** Local HTTP server with Range support. Used instead of the network in unit tests. */
export async function startFixtureServer(
  body: Buffer,
  options: FixtureOptions = {},
): Promise<FixtureServer> {
  const requests: (string | undefined)[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const range = req.headers.range;
    requests.push(range);
    const isFirst = requests.length === 1;

    let start = 0;
    let status = 200;
    if (range && !options.ignoreRange) {
      const match = /bytes=(\d+)-/.exec(range);
      start = Number(match?.[1] ?? 0);
      if (start >= body.length) {
        res.writeHead(416, { "content-range": `bytes */${body.length}` });
        res.end();
        return;
      }
      status = 206;
    }

    const slice = body.subarray(start);
    const headers: Record<string, string | number> = { "content-length": slice.length };
    if (status === 206)
      headers["content-range"] = `bytes ${start}-${body.length - 1}/${body.length}`;
    res.writeHead(status, headers);

    if (isFirst && options.truncateFirstAfter !== undefined) {
      // Drop the connection only after the partial bytes are flushed, so the client keeps them.
      res.write(slice.subarray(0, options.truncateFirstAfter), () => {
        setTimeout(() => res.destroy(), 30);
      });
      return;
    }
    if (options.stallAfter !== undefined) {
      res.write(slice.subarray(0, options.stallAfter));
      return;
    }
    res.end(slice);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/model.gguf`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
