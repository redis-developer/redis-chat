import { WebSocketServer } from "ws";
import config from "../config";
import getClient from "../redis";
import { LEVEL, SPLAT } from "triple-beam";
import winston from "winston";
import Transport from "winston-transport";
import session from "./session";

/**
 * @typedef {Object} TransportInfo
 * @property {string} level - The log level (e.g., "info", "error").
 * @property {string} message - The log message.
 */

class EnumerableError extends Error {
  toJSON() {
    return JSON.stringify({
      message: this.message,
    });
  }
}

/**
 * Creates a deep clone of the given value using JSON serialization.
 *
 * @param {any} value - The value to clone.
 */
function quickClone(value) {
  return JSON.parse(JSON.stringify(value));
}

class RedisTransport extends Transport {
  /**
   * Logs messages to a Redis stream.
   *
   * @param {TransportInfo & { [SPLAT]?: unknown[] }} info
   * @param {function} [callback] - Optional callback function to call after logging.
   */
  log(info, callback = () => {}) {
    try {
      const level = info.level;
      let message = info.message;
      let meta = /** @type {any} */ (info[SPLAT]?.[0] ?? "{}");

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

      const redis = getClient();
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
    } catch (e) {}

    callback();
  }
}

class WebsocketTransport extends Transport {
  /** @type {Record<string, ((ev: { level: string; message: string; meta?: unknown }) => unknown)[]>} */
  subscribers = {};

  /**
   * Logs messages to a Redis stream.
   *
   * @param {TransportInfo & { [SPLAT]?: unknown[] }} info
   * @param {function} [callback] - Optional callback function to call after logging.
   */
  log(info, callback = () => {}) {
    try {
      const level = info.level;
      let message = info.message;
      let meta = /** @type {any} */ (info[SPLAT]?.[0]);

      if (!meta?.sessionId) {
        callback();
        return;
      }

      meta = quickClone(meta);

      if (meta?.error) {
        meta.error = new EnumerableError(meta.error.message);
      }

      const sessionId = /** @type {string} */ (meta.sessionId);
      delete meta.sessionId;
      const subscribers = this.subscribers[sessionId] || [];

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

  /**
   * Subscribes to log messages.
   *
   * @param {string} sessionId - The session ID for which to subscribe.
   * @param {(ev: { level: string; message: string; meta?: unknown }) => unknown} subscriber
   *
   * @returns {() => void} - A function to unsubscribe the subscriber.
   */
  subscribe(sessionId, subscriber) {
    if (typeof subscriber !== "function") {
      throw new Error("Subscriber must be a function");
    }

    let subscribers = this.subscribers[sessionId] ?? [];

    if (subscribers.length === 0) {
      this.subscribers[sessionId] = subscribers;
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
   * Removes a session and all its subscribers.
   *
   * @param {string} sessionId - The session ID to remove.
   */
  removeSession(sessionId) {
    if (!this.subscribers[sessionId]) {
      return;
    }

    delete this.subscribers[sessionId];
  }

  /**
   * Handles WebSocket connections and messages.
   *
   * @param {import("ws").WebSocket} ws - The WebSocket connection.
   * @param {import("express").Request} req - The HTTP request object.
   */
  onConnection(ws, req) {
    session(req, /** @type {any} */ ({}), async () => {
      const sessionId = req.session.id;

      if (!sessionId) {
        return;
      }
      /**
       * Sends a response to the WebSocket client.
       *
       * @param {{ level: string; message: string; meta?: unknown }} response - The response message to send.
       */
      const send = (response) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(response));
        } else {
          unsubscribe();
        }
      };

      const unsubscribe = this.subscribe(sessionId, send);
      ws.on("error", unsubscribe);
      ws.on("close", unsubscribe);

      send({
        level: "info",
        message: "WebSocket connection established",
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
