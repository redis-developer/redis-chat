export function float32ToBuffer(arr: number[]) {
  const floatArray = new Float32Array(arr);
  const float32Buffer = Buffer.from(floatArray.buffer);
  return float32Buffer;
}
