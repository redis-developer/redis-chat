const ws = new WebSocket("/log");

ws.onmessage = (ev) => {
  const { level, message, meta } = JSON.parse(ev.data);
  const logLevel = level.toLowerCase();
  let logColor = "color:blue";

  switch (logLevel) {
    case "debug":
      logColor = "color:green";
      break;
    case "info":
      logColor = "color:gray";
      break;
    case "warn":
      logColor = "color:yellow";
      break;
    case "error":
      logColor = "color:red";
      break;
    default:
      logColor = "color:gray";
  }

  console.log(
    `[%c${level.toUpperCase()}%c]: ${message}`,
    logColor,
    "color:inherit",
  );
  if (meta) {
    console.log(meta);
  }
};
