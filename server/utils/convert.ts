export function float32ToBuffer(arr: number[]) {
  const floatArray = new Float32Array(arr);
  const float32Buffer = Buffer.from(floatArray.buffer);
  return float32Buffer;
}

export function escapeDashes(str: string) {
  return str.replace(/-/g, "\\-");
}

export function urlToBase64(url: string) {
  return Buffer.from(url).toString("base64").replace(/=/g, "");
}

export function base64ToUrl(base64: string) {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf-8");
}
