import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { runOCR } from './ocr-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PDF_EXTENSIONS = /\.(pdf)$/i;
let rendererWindow = null;

function getRendererWindow() {
  if (rendererWindow && !rendererWindow.isDestroyed()) {
    return rendererWindow;
  }
  
  rendererWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // allow file:// access for local pdfs
    }
  });

  const htmlPath = path.join(__dirname, 'pdf-renderer.html');
  rendererWindow.loadFile(htmlPath);
  return rendererWindow;
}

export async function detectDocumentOcrSupport() {
  return {
    pdf: {
      available: true,
      engine: 'pdfjs-dist (Pure JS) + Tesseract.js',
      reason: null
    },
    word: {
      available: false,
      engine: 'Not Supported',
      reason: 'Word document OCR has been deprecated to guarantee native support on all devices.'
    }
  };
}

function renderPdfPages(pdfPath, options = {}) {
  const { maxPages = 12, dpi = 220 } = options;
  const win = getRendererWindow();
  const requestId = Math.random().toString(36).substring(7);

  return new Promise((resolve, reject) => {
    // Timeout in case it hangs
    const timer = setTimeout(() => {
      ipcMain.removeAllListeners(`render-pdf-result-${requestId}`);
      reject(new Error('PDF rendering timed out'));
    }, 60000);

    ipcMain.once(`render-pdf-result-${requestId}`, (event, result) => {
      clearTimeout(timer);
      if (result.success) {
        resolve(result);
      } else {
        reject(new Error(result.error || 'PDF rendering failed'));
      }
    });

    win.webContents.send('render-pdf-request', {
      id: requestId,
      pdfPath: 'file://' + pdfPath.replace(/\\/g, '/'),
      maxPages,
      dpi
    });
  });
}

function base64ToTempFile(base64Data, tempDir, index) {
  const data = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(data, 'base64');
  const filePath = path.join(tempDir, `page-${index.toString().padStart(3, '0')}.jpg`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export async function runDocumentOCR(documentPath, language = 'eng+ara', options = {}) {
  const { onProgress, maxPages = 12, dpi = 220 } = options;
  const ext = path.extname(documentPath).toLowerCase();
  
  if (!PDF_EXTENSIONS.test(ext)) {
    throw new Error(`Unsupported document type for local OCR: ${ext}. Only PDF is supported.`);
  }

  const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp') || os.tmpdir(), 'ledgerlink-doc-ocr-'));

  try {
    onProgress?.({ status: 'rendering pages', progress: 0.1 });
    
    const rendered = await renderPdfPages(documentPath, { maxPages, dpi });
    if (!rendered.images || rendered.images.length === 0) {
      throw new Error('No renderable pages were found in this document');
    }

    const pageImages = [];
    for (let i = 0; i < rendered.images.length; i++) {
      pageImages.push(base64ToTempFile(rendered.images[i], tempRoot, i + 1));
    }

    const pageResults = [];
    for (let index = 0; index < pageImages.length; index += 1) {
      const pageNumber = index + 1;
      const pagePath = pageImages[index];
      
      const pageResult = await runOCR(pagePath, language, {
        onProgress: (event) => {
          const base = index / pageImages.length;
          const item = typeof event.progress === 'number' ? event.progress / pageImages.length : 0;
          onProgress?.({
            status: `page ${pageNumber}: ${event.status || 'recognizing text'}`,
            progress: Math.min(0.98, 0.15 + ((base + item) * 0.83)),
            page: pageNumber,
            pageCount: rendered.pageCount,
          });
        },
      });
      
      pageResults.push({
        page: pageNumber,
        text: pageResult.text,
        confidence: pageResult.confidence,
      });
    }

    const text = pageResults
      .map(page => `Page ${page.page}\n${page.text || ''}`.trim())
      .filter(Boolean)
      .join('\n\n');
      
    const confidence = pageResults.length
      ? pageResults.reduce((sum, page) => sum + (page.confidence || 0), 0) / pageResults.length
      : 0;

    onProgress?.({ status: 'document OCR complete', progress: 1 });
    
    return {
      text,
      confidence,
      pageCount: rendered.pageCount,
      renderedPages: pageImages.length,
      pages: pageResults,
      sourceType: 'pdf',
    };
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (e) {
      console.warn('Failed to cleanup temp doc OCR dir', e);
    }
  }
}
