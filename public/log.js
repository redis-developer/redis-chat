const ws = new WebSocket("/log");

function toggleLogs() {
  const container = document.getElementById("logContainer");
  if (container.classList.contains("hidden")) {
    container.classList.remove("hidden");
  } else {
    container.classList.add("hidden");
  }
}

/**
 *
 * @param {string} level
 * @param {string} message
 * @param {any} meta
 */
function addLogEntry(level, message, meta) {
  const el = document.getElementById("logs");
  const colorClassMap = {
    debug: "text-green-600",
    info: "text-gray-600",
    warn: "text-yellow-600",
    error: "text-red-600",
  };
  const pre = document.createElement("pre");
  pre.classList.add("text-sm");
  pre.classList.add("w-11/12");
  pre.classList.add("text-wrap");
  const levelSpan = document.createElement("span");
  levelSpan.classList.add("uppercase", "font-semibold");
  levelSpan.classList.add(colorClassMap[level] ?? "text-gray-600");
  levelSpan.textContent = `[${level.charAt(0)}] `;
  const messageSpan = document.createElement("span");
  messageSpan.textContent = message;
  pre.appendChild(levelSpan);
  pre.appendChild(messageSpan);
  el.insertBefore(pre, el.firstChild);
}

ws.onopen = () => {
  document.getElementById("viewLogs").addEventListener("click", toggleLogs);
};

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

  addLogEntry(level, message, meta);
  log(`[%c${level.toUpperCase()}%c]: ${message}`, logColor, "color:inherit");
  if (meta) {
    log(meta);
  }
};
