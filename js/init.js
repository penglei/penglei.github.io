document.addEventListener('DOMContentLoaded', (event) => {
  document.querySelectorAll('pre.highlight code').forEach((block) => {
    hljs.highlightBlock(block);
  });
});