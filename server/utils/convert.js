/**
 * Turns a float array into a buffer
 *
 * @param {number[]} arr - The array of float numbers to convert
 */
export function float32ToBuffer(arr) {
  const floatArray = new Float32Array(arr);
  const float32Buffer = Buffer.from(floatArray.buffer);
  return float32Buffer;
}
