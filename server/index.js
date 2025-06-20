import config from "./config";
import app from "./app";
import logger from "./utils/log";
import * as chat from "./components/chat";

const port = config.env.PORT;

const server = app.listen(port, async () => {
  logger.info(`Redis chat server listening on port ${port}`);
});

/**
 * Handles WebSocket upgrade requests for the chat service.
 *
 * @param {import("express").Request} req - The HTTP request object.
 * @param {import("node:stream").Duplex} socket - The socket for the connection.
 * @param {Buffer} head - The first packet of the WebSocket connection.
 */
function onUpgrade(req, socket, head) {
  const { pathname } = new URL(req.url, "wss://localhost");
  if (pathname === "/chat") {
    chat.socket.wss.handleUpgrade(req, socket, head, (ws) => {
      chat.socket.wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
}

server.on("upgrade", onUpgrade);

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection:", reason);
});

export default server;
