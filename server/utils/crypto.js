import crypto from "crypto";

/**
 * Generates a random hexadecimal string of the specified length.
 *
 * @param {number} length - The length of the random string to generate.
 */
export function randomBytes(length) {
  const b = crypto.randomBytes(length);

  return b.toString("hex");
}
