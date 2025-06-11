import express from "express";
import { WebSocketServer } from "ws";
import { engine } from "express-handlebars";
import { RedisStore } from "connect-redis";
import session from "express-session";
import getClient from "./redis.js";
import { addChatMessage, getChatMessages } from "./components/chat/store.js";
import { generateResponse } from "./utils/ai.js";
import { renderMessage } from "./utils/templates.js";
import config from "./config.js";

export async function initialize() {}

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
      if (!req.session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        reject();
        return;
      }

      resolve();
    });
  });

  const sessionId = req.session.id;
  const messages = await getChatMessages(sessionId);

  for (const message of messages) {
    ws.send(
      renderMessage({
        message: message.message,
        isLocal: message.isLocal,
      }),
    );
  }

  ws.on("error", console.error);
  ws.on("message", (data) => {
    const { message } = JSON.parse(data)

    wss.clients.forEach(async (client) => {
      if (client.readyState === ws.OPEN) {
        const userMessage = {
          message,
          isLocal: true,
        };

        client.send(
          renderMessage({
            message,
            isLocal: true,
          }),
        );
        await addChatMessage(sessionId, userMessage);

        const response = {
          message: await generateResponse(message),
          isLocal: false,
        };

        await addChatMessage(sessionId, response);

        client.send(
          renderMessage(response),
        );
      }
    });
  });
});

app.get("/", (req, res) => {
  res.render("index");
});

export default app;
