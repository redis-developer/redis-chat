const ws = new WebSocket("/log");

ws.onmessage = (ev) => {
  const { level, message, meta } = JSON.parse(ev.data);
  const logLevel = level.toLowerCase();
  let logColor = "color:blue";
  let log = console.log;

  switch (logLevel) {
    case "debug":
      logColor = "color:green";
      log = console.debug;
      return;
    case "info":
      logColor = "color:gray";
      log = console.info;
      break;
    case "warn":
      logColor = "color:yellow";
      log = console.warn;
      break;
    case "error":
      logColor = "color:red";
      log = console.error;
      break;
    default:
      logColor = "color:gray";
      log = console.log;
  }

  log(`[%c${level.toUpperCase()}%c]: ${message}`, logColor, "color:inherit");
  if (meta) {
    log(meta);
  }
};
