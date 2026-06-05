import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';

// Preprocessing pipeline optimized for receipts (low contrast, thermal text, phone shadows)
export async function preprocessImageForOCR(imagePath, options = {}) {
  const {
    targetWidth = 2000,
    thresholdValue = 135,
    sharpenSigma = 1.3,
  } = options;

  try {
    const pipeline = sharp(imagePath)
      .resize({
        width: targetWidth,
        withoutEnlargement: true,
        kernel: 'lanczos3',
      })
      .grayscale()
      .normalize() // Stretch contrast to auto-level shadows/faded text
      .sharpen({ sigma: sharpenSigma })
      .threshold(thresholdValue); // Convert to pure black and white for Tesseract

    return await pipeline.png().toBuffer();
  } catch (error) {
    console.error('Image pre-processing failed, falling back to original buffer:', error);
    return fs.readFileSync(imagePath);
  }
}

export async function runOCR(imagePath, language = 'eng+ara', options = {}) {
  const { onProgress } = options;
  const modelsPath = path.join(app.getPath('userData'), 'tesseract-models');
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true });
  }

  let worker = null;
  try {
    // Pre-process the image to binarize and improve contrast
    const preprocessedBuffer = await preprocessImageForOCR(imagePath);

    // Initialize worker with languages (e.g. eng, ara, eng+ara)
    worker = await Tesseract.createWorker(language, 1, {
      cachePath: modelsPath,
      logger: m => {
        if (typeof onProgress === 'function') {
          onProgress({
            status: m.status,
            progress: typeof m.progress === 'number' ? m.progress : null,
          });
        }
      }
    });

    // Set page segmentation mode to 6 (Single uniform block of text) - best for tabular receipts
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
    });

    const { data } = await worker.recognize(preprocessedBuffer);
    await worker.terminate();
    worker = null;

    return {
      text: data.text || '',
      confidence: data.confidence || 0,
      words: (data.words || []).map(w => ({
        text: w.text,
        confidence: w.confidence
      }))
    };
  } catch (error) {
    console.error('OCR execution failed:', error);
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // ignore cleanup failures
      }
    }
    throw error;
  }
}
