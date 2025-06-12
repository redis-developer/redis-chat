/**
 * Turns a float array into a buffer
 */
export function float32ToBuffer(arr) {
  const floatArray = new Float32Array(arr);
  const float32Buffer = Buffer.from(floatArray.buffer);
  return float32Buffer;
}
