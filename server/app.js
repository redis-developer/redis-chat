import express from "express";
import { WebSocketServer } from "ws";
import { engine } from "express-handlebars";
import { RedisStore } from "connect-redis";
import session from "express-session";
import getClient from "./redis.js";
import config from "./config.js";
import * as chat from "./components/chat/controller.js";

export async function initialize() {
  await chat.initialize();
}

const redisStore = new RedisStore({
  client: getClient(),
  prefix: "session:",
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

wss.on("connection", async (ws, req) => {
  await new Promise((resolve, reject) => {
    sessionParser(req, {}, () => {
      if (!req.session.id) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        reject();
        return;
      }

      resolve();
    });
  });

  await chat.initializeChat(ws, req.session.id);
});

app.get("/", (req, res) => {
  res.render("index");
});

export default app;
