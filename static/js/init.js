// ---- copy button for code blocks ---- {
function initCodeCopy() {
  'use strict';

  if(!document.queryCommandSupported('copy')) {
    return;
  }

  function flashCopyMessage(el, msg) {
    el.textContent = msg;
    setTimeout(function() {
      el.textContent = "Copy";
    }, 2000);
  }

  function selectText(node) {
    var selection = window.getSelection();
    if (selection.toString().length > 0) {
      // console.log(selection.toString())
    } else {
        var range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
    }
    return selection;
  }

  function addCopyButton(containerEl) {
    var copyBtn = document.createElement("button");
    copyBtn.className = "highlight-copy-btn";
    copyBtn.textContent = "Copy";

    var codeEl = containerEl.firstElementChild;
    copyBtn.addEventListener('click', function() {
      try {
        var selection = selectText(codeEl);
        document.execCommand('copy');
        selection.removeAllRanges();

        flashCopyMessage(copyBtn, 'Copied!')
      } catch(e) {
        console && console.log(e);
        flashCopyMessage(copyBtn, 'Failed :\'(')
      }
    });

    containerEl.appendChild(copyBtn);
  }

  // Add copy button to code blocks
  var highlightBlocks = document.querySelectorAll('.copy pre.highlight');
  Array.prototype.forEach.call(highlightBlocks, addCopyButton);
}

document.addEventListener('DOMContentLoaded', (event) => {
  document.querySelectorAll('pre.highlight code').forEach((block) => {
    hljs.highlightBlock(block);
  });
  initCodeCopy();
});
// ---- copy button for code block ---- }
