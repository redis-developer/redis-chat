import crypto from "crypto";

export function randomBytes(length) {
  const b = crypto.randomBytes(length);

  return b.toString("hex");
}
