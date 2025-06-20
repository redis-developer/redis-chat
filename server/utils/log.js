import { WebSocketServer } from "ws";
import config from "../config";
import getClient from "../redis";
import { LEVEL, SPLAT } from "triple-beam";
import winston from "winston";
import Transport from "winston-transport";

/**
 * @typedef {Object} TransportInfo
 * @property {string} level - The log level (e.g., "info", "error").
 * @property {string} message - The log message.
 */

class RedisTransport extends Transport {
  /**
   * Logs messages to a Redis stream.
   *
   * @param {TransportInfo & { [SPLAT]?: string[] }} info
   * @param {function} [callback] - Optional callback function to call after logging.
   */
  log(info, callback = () => {}) {
    try {
      const level = info.level;
      let message = info.message;
      let meta = info[SPLAT]?.[0] ?? "{}";

      if (typeof message !== "string") {
        message = JSON.stringify(message);
      }

      if (typeof meta !== "string") {
        meta = JSON.stringify(meta);
      }

      const redis = getClient();
      // Don't await this so the app can keep moving.
      void redis.xAdd(config.log.LOG_STREAM, "*", {
        service: config.app.FULL_NAME,
        level,
        message,
        meta,
      });

      if (level.toLowerCase() === "error") {
        void redis.xAdd(config.log.ERROR_STREAM, "*", {
          service: config.app.SERVICE_NAME,
          level,
          message,
          meta,
        });
      }
    } catch (e) {}

    callback();
  }
}

class WebsocketTransport extends Transport {
  /** @type {((ev: { level: string; message: string; meta?: unknown }) => unknown)[]} */
  subscribers = [];

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
      let meta = info[SPLAT]?.[0];

      for (const subscriber of this.subscribers) {
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
   * @param {(ev: { level: string; message: string; meta?: unknown }) => unknown} subscriber
   *
   * @returns {() => void} - A function to unsubscribe the subscriber.
   */
  subscribe(subscriber) {
    if (typeof subscriber !== "function") {
      throw new Error("Subscriber must be a function");
    }

    let subscribers = this.subscribers;
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
   * Handles WebSocket connections and messages.
   *
   * @param {import("ws").WebSocket} ws - The WebSocket connection.
   * @param {import("express").Request} req - The HTTP request object.
   */
  onConnection(ws, req) {
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

    const unsubscribe = this.subscribe(send);
    ws.on("error", unsubscribe);
    ws.on("close", unsubscribe);

    send({
      level: "info",
      message: "WebSocket connection established",
    });
  }
}

export const logWss = new WebSocketServer({ noServer: true });
const wst = new WebsocketTransport();
logWss.on("connection", wst.onConnection.bind(wst));

const logger = winston.createLogger({
  level: config.log.LEVEL.toLowerCase(),
  format: winston.format.json(),
  defaultMeta: { service: config.app.FULL_NAME },
  transports: [
    new RedisTransport(),
    wst,
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

export default logger;
