import express from "express";
import { engine } from "express-handlebars";
import config from "./config";
import session from "./utils/session";
import { ctrl } from "./components/chat";

const app = express();
app.use(express.static("public"));
app.engine(
  "hbs",
  engine({
    extname: ".hbs",
    helpers: {
      /**
       * Checks if two values are equal.
       *
       * @param {import("handlebars").HelperOptions} options - Handlebars options object.
       */
      isEqual(options) {
        const { chatId, currentChatId } = options.hash;
        return chatId == currentChatId
          ? options.fn(this)
          : options.inverse(this);
      },
    },
  }),
);
app.set("view engine", "hbs");
app.set("views", "./views");
app.use(session);

app.get("/", async (req, res) => {
  const sessionId = req.session.id;
  // @ts-ignore
  const currentChatId = req.session.currentChatId;
  const chats = await ctrl.getChatsHistory(sessionId);
  res.render("index", {
    sessionId,
    currentChatId,
    chats, // TODO: add chats
  });
});

export default app;
