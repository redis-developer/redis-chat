import { Router } from "express";
import { clearMessages } from "./view";
import * as ctrl from "./controller.js";

const router = Router();

router.get("/clear", async (req, res) => {
  if (req.session.id) {
    await ctrl.clearMessages(req.session.id);
  }

  res.send(clearMessages());
});

router.get("/regenerate/:id", async (req, res) => {
  if (!req.session.id) {
    return res.status(400).send("Session ID is required");
  }

  const messageId = req.params.id;
  if (!messageId) {
    return res.status(400).send("message id is required");
  }

  try {
    const response = await ctrl.regenerateMessage(req.session.id, messageId);

    res.send(response);
  } catch (error) {
    res.status(500).send(`Error processing message: ${error.message}`);
  }
});

export default router;
