import express from "express";
import { WebSocketServer } from "ws";
import { engine } from "express-handlebars";
import { RedisStore } from "connect-redis";
import session from "express-session";
import getClient from "./redis.js";
import config from "./config.js";
import logger from "./utils/log.js";
import * as chat from "./components/chat/controller.js";

export async function initialize() {
  await chat.initialize();
}

const redisStore = new RedisStore({
  client: getClient(),
  prefix: config.redis.SESSION_PREFIX,
});
const sessionParser = session({
  store: redisStore,
  resave: false,
  saveUninitialized: true,
  secret: config.redis.SESSION_SECRET,
});

const app = express();
app.use(sessionParser);
app.engine(
  "hbs",
  engine({
    extname: ".hbs",
  }),
);
app.set("view engine", "hbs");
app.set("views", "./views");

export const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
  sessionParser(req, {}, async () => {
    if (!req.session.id) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    ws.on("error", logger.error);
    ws.on("message", (data) => {
      const { message } = JSON.parse(data);
      chat.handleMessage(
        (response) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(response);
          } else {
            logger.warn("WebSocket is not open, cannot send message");
          }
        },
        req.session.id,
        message,
      );
    });

    await chat.initializeChat((response) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(response);
      } else {
        logger.warn("WebSocket is not open, cannot send message");
      }
    }, req.session.id);
  });
});

app.get("/", (_, res) => {
  res.render("index");
});

export default app;
