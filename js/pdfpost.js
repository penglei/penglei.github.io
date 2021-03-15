!(function() {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.7.570/pdf.worker.min.js";
  var CSS_UNITS = 96.0 / 72.0;
  var canvas = document.getElementById('pdf-content');
  var url = canvas.getAttribute("value");

  var loadingTask = pdfjsLib.getDocument(url);
  loadingTask.promise.then(function(pdf) {
    //
    // Fetch the first page
    //
    pdf.getPage(1).then(function(page) {
      var scale = 1;
      var viewport = page.getViewport({ scale: scale * CSS_UNITS, });

      console.log("scale", scale * CSS_UNITS);
      //
      // Prepare canvas using PDF page dimensions
      //
      var context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      //
      // Render PDF page into canvas context
      //
      var renderContext = {
        canvasContext: context,
        viewport: viewport,
      };
      page.render(renderContext);
    });
  });
})();
