const { ipcRenderer } = require('electron');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// Configure worker to point to the local file
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

ipcRenderer.on('render-pdf-request', async (event, { id, pdfPath, maxPages, dpi }) => {
  try {
    const loadingTask = pdfjsLib.getDocument({
      url: pdfPath,
      cMapUrl: require.resolve('pdfjs-dist/cmaps/').replace(/\\/g, '/').replace(/\/index\.js$/, ''),
      cMapPacked: true
    });
    
    const pdfDocument = await loadingTask.promise;
    const pageCount = pdfDocument.numPages;
    const renderLimit = Math.min(pageCount, maxPages || 12);
    const images = [];

    // DPI to scale factor (72 dpi is 1.0)
    const scale = (dpi || 220) / 72;

    for (let pageNum = 1; pageNum <= renderLimit; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      await page.render(renderContext).promise;
      // Convert to base64 jpeg
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      images.push(dataUrl);
    }
    
    ipcRenderer.send(`render-pdf-result-${id}`, { success: true, pageCount, images });
  } catch (err) {
    ipcRenderer.send(`render-pdf-result-${id}`, { success: false, error: err.message });
  }
});
