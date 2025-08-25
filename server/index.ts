import config from "./config";
import app from "./app";
import logger, { logWss } from "./utils/log";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import * as chat from "./components/chat";

const port = config.env.PORT;

const server = app.listen(port, async () => {
  logger.info(`Redis chat server listening on port ${port}`, {
    noStream: true,
  });
});

function onUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer<ArrayBufferLike>,
) {
  let url = req.url!;

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
  console.error(err);
});

process.on("unhandledRejection", (err, promise) => {
  console.error(err);
});

export default server;
