import config from "./config.js";
import app, { initialize, wss } from "./app.js";
import logger from "./utils/log.js";

const port = config.env.PORT;

const server = app.listen(port, async () => {
  logger.info(`Redis chat server listening on port ${port}`);

  await initialize();
});

server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url, "wss://localhost");
  if (pathname === "/chat") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});
