import { WebSocketServer } from "ws";
import config from "./config";
import app from "./app";
import logger, { logWss } from "./utils/log";
import * as chat from "./components/chat";

const port = config.env.PORT;

const server = app.listen(port, async () => {
  logger.info(`Redis chat server listening on port ${port}`, {
    noStream: true,
  });
});

/**
 * Handles WebSocket upgrade requests for the chat service.
 *
 * @param {import("express").Request} req - The HTTP request object.
 * @param {import("node:stream").Duplex} socket - The socket for the connection.
 * @param {Buffer} head - The first packet of the WebSocket connection.
 */
function onUpgrade(req, socket, head) {
  let url = req.url;

  if (url.includes("wss://")) {
    url = new URL(url).pathname;
  }

  if (url === "/chat") {
    chat.socket.wss.handleUpgrade(req, socket, head, (ws) => {
      chat.socket.wss.emit("connection", ws, req);
    });
  } else if (url === "/log") {
    logWss.handleUpgrade(req, socket, head, (ws) => {
      logWss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
}

server.on("upgrade", onUpgrade);

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", {
    error: err,
    noStream: true,
  });
});

process.on("unhandledRejection", (err, promise) => {
  logger.error("Unhandled Rejection:", {
    error: err,
    noStream: true,
  });
});

export default server;
