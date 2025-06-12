import crypto from "crypto";

/**
 * Generates a random hexadecimal string of the specified length.
 */
export function randomBytes(length) {
  const b = crypto.randomBytes(length);

  return b.toString("hex");
}
