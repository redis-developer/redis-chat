import express from "express";
import { engine } from "express-handlebars";
import type { HelperOptions } from "handlebars";
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
       */
      ifEqual(options: HelperOptions) {
        const { a, b } = options.hash;
        return a == b ? options.fn(this) : options.inverse(this);
      },
      isEqual(options: HelperOptions) {
        const { a, b } = options.hash;

        return a === b;
      },
    },
  }),
);
app.set("view engine", "hbs");
app.set("views", "./views");
app.use(session);

app.get("/", async (req, res) => {
  const userId = req.session.id;
  // @ts-ignore
  const currentSessionId = req.session.currentSessionId;
  const chats = await ctrl.getAllChats(userId);

  res.render("index", {
    userId,
    currentSessionId,
    chats,
    placeholder: !currentSessionId,
  });
});

export default app;
