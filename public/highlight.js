document.addEventListener("htmx:wsAfterMessage", (event) => {
  document.querySelectorAll("pre code").forEach((el) => {
    if (el.getAttribute("data-highlighted") === "yes") {
      return;
    }

    hljs.highlightElement(el);
  });
});

document.addEventListener("htmx:oobErrorNoTarget", (event) => {
  console.log(event);
});
