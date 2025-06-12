import crypto from "crypto";

export async function randomBytes(length) {
  const b = await crypto.randomBytes(length);

  return b.toString("hex");
}
