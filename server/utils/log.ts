import { WebSocketServer } from "ws";
import config from "../config";
import getClient from "../redis";
import { LEVEL, SPLAT } from "triple-beam";
import winston from "winston";
import Transport from "winston-transport";
import { getSessionParser } from "./session";

interface TransportInfo {
  level: string;
  message: string;
}

interface Meta {
  [key: string]: unknown;
  userId?: string;
  error?: Error;
  noStream?: boolean;
}

class EnumerableError extends Error {
  toJSON() {
    return JSON.stringify({
      message: this.message,
    });
  }
}

function quickClone(value: any) {
  return JSON.parse(JSON.stringify(value));
}

class RedisTransport extends Transport {
  log(
    info: TransportInfo & { [SPLAT]?: unknown[] },
    callback: Function = () => {},
  ) {
    try {
      const level = info.level;
      let message = info.message;
      let meta = (info[SPLAT]?.[0] ?? "{}") as Meta;

      if (typeof message !== "string") {
        message = JSON.stringify(message);
      }

      if (meta?.noStream) {
        callback();
        return;
      }

      if (meta?.error) {
        meta.error = new EnumerableError(meta.error.message);
      }

      let metaStr = typeof meta === "string" ? meta : JSON.stringify(meta);

      (async () => {
        const redis = await getClient();
        // Don't await this so the app can keep moving.
        void redis.xAdd(config.log.LOG_STREAM, "*", {
          service: config.app.SERVICE_NAME,
          level,
          message,
          meta: metaStr,
        });

        if (level.toLowerCase() === "error") {
          void redis.xAdd(config.log.ERROR_STREAM, "*", {
            service: config.app.SERVICE_NAME,
            level,
            message,
            meta: metaStr,
          });
        }
      })();
    } catch (e) {}

    callback();
  }
}

class WebsocketTransport extends Transport {
  subscribers: Record<
    string,
    ((ev: { level: string; message: string; meta?: unknown }) => unknown)[]
  > = {};

  /**
   * Logs messages to a Redis stream.
   *
   * @param {TransportInfo & { [SPLAT]?: unknown[] }} info
   * @param {function} [callback] - Optional callback function to call after logging.
   */
  log(
    info: TransportInfo & { [SPLAT]?: unknown[] },
    callback: Function = () => {},
  ) {
    try {
      const level = info.level;
      let message = info.message;
      let meta = info[SPLAT]?.[0] as Meta | undefined;

      if (!meta?.userId) {
        callback();
        return;
      }

      meta = quickClone(meta) as Meta;

      if (meta?.error) {
        meta.error = new EnumerableError(meta.error.message);
      }

      const userId = meta.userId!;
      delete meta.userId;
      const subscribers = this.subscribers[userId] || [];

      if (Object.keys(meta).length === 0) {
        meta = undefined;
      }

      for (const subscriber of subscribers) {
        try {
          subscriber({
            level,
            message,
            meta,
          });
        } catch (e) {
          // Ignore errors in sending to subscribers
        }
      }
    } catch (e) {
      console.log(e);
    }

    callback();
  }

  subscribe(
    userId: string,
    subscriber: (ev: {
      level: string;
      message: string;
      meta?: unknown;
    }) => unknown,
  ): () => void {
    if (typeof subscriber !== "function") {
      throw new Error("Subscriber must be a function");
    }

    let subscribers = this.subscribers[userId] ?? [];

    if (subscribers.length === 0) {
      this.subscribers[userId] = subscribers;
    }

    subscribers.push(subscriber);

    return () => {
      const index = subscribers.indexOf(subscriber);

      if (index === -1) {
        return;
      }

      subscribers.splice(index, 1);
    };
  }

  /**
   * Removes a user and all its subscribers.
   */
  removeUser(userId: string) {
    if (!this.subscribers[userId]) {
      return;
    }

    delete this.subscribers[userId];
  }

  /**
   * Handles WebSocket connections and messages.
   */
  async onConnection(ws: import("ws").WebSocket, req: import("express").Request) {
    const session = await getSessionParser();
    session(req, {} as any, async () => {
      const userId = req.session.id;

      if (!userId) {
        return;
      }
      /**
       * Sends a response to the WebSocket client.
       */
      const send = (response: {
        level: string;
        message: string;
        meta?: unknown;
      }) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(response));
        } else {
          unsubscribe();
        }
      };

      const unsubscribe = this.subscribe(userId, send);
      ws.on("error", unsubscribe);
      ws.on("close", unsubscribe);

      send({
        level: "debug",
        message: "Logging websocket connection established",
      });
    });
  }
}

export const logWss = new WebSocketServer({ noServer: true });
export const logWst = new WebsocketTransport();
logWss.on("connection", logWst.onConnection.bind(logWst));

const logger = winston.createLogger({
  level: config.log.LEVEL.toLowerCase(),
  format: winston.format.json(),
  defaultMeta: { service: config.app.SERVICE_NAME },
  transports: [
    new RedisTransport(),
    logWst,
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

export default logger;
