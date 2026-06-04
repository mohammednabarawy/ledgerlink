export function extractReceiptFields(rawText) {
  const lines = rawText.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const result = {
    vendor: '',
    date: '',
    total: '',
    tax: '',
    currency: 'SAR', // Default fallback for Saudi Arabia context
  };

  if (lines.length === 0) return result;

  // 1. Estimate Vendor Name (typically first 2 lines that don't contain numbers or timestamps)
  const nonNumericLines = lines.slice(0, 4).filter(line => {
    // Exclude lines with common invoice labels or date/time strings
    const hasNumbers = /\d{3,}/.test(line);
    const hasTime = /\b\d{1,2}:\d{2}\b/.test(line);
    const isHeaderLabel = /(?:welcome|tax invoice|فاتورة|ضريبية|مرحباً)/i.test(line);
    return !hasNumbers && !hasTime && !isHeaderLabel && line.length > 2;
  });

  if (nonNumericLines.length > 0) {
    result.vendor = nonNumericLines[0];
  } else {
    result.vendor = lines[0]; // Fallback to first line
  }

  const fullText = lines.join('\n');

  // 2. Detect Currency
  if (/(\$|usd)/i.test(fullText)) {
    result.currency = 'USD';
  } else if (/(aed|د\.إ)/i.test(fullText)) {
    result.currency = 'AED';
  } else if (/(﷼|ر\.س|sar)/i.test(fullText)) {
    result.currency = 'SAR';
  }

  // 3. Match Date
  // Formats: DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY, etc.
  const dateRegex = /\b(\d{1,4}[/\-.]\d{1,2}[/\-.]\d{2,4})\b/;
  const dateMatch = fullText.match(dateRegex);
  if (dateMatch) {
    result.date = dateMatch[1];
  }

  // 4. Extract Numbers for Total and Tax
  // Look for lines containing "total", "vat", "tax" in English/Arabic
  const totalKeywords = /(?:total|المجموع|الإجمالي|المبلغ|مجموع|net|حساب|إجمالي|net total|grand total)/i;
  const taxKeywords = /(?:vat|tax|ضريبة|ض\.ق\.م|الضريبة|قيمة المضافة)/i;
  
  let bestTotal = '';
  let bestTax = '';

  for (const line of lines) {
    // Check for totals
    if (totalKeywords.test(line) && !taxKeywords.test(line)) {
      const match = line.match(/[\d,]+\.\d{2}/) || line.match(/[\d,]+/);
      if (match) {
        const val = match[0].trim();
        // Parse value to float to make sure it's valid
        const num = parseFloat(val.replace(/,/g, ''));
        if (!isNaN(num) && num > 0 && (!bestTotal || num > parseFloat(bestTotal.replace(/,/g, '')))) {
          bestTotal = val;
        }
      }
    }

    // Check for tax/vat
    if (taxKeywords.test(line)) {
      const match = line.match(/[\d,]+\.\d{2}/) || line.match(/[\d,]+/);
      if (match) {
        const val = match[0].trim();
        const num = parseFloat(val.replace(/,/g, ''));
        if (!isNaN(num) && num > 0 && (!bestTax || num > parseFloat(bestTax.replace(/,/g, '')))) {
          bestTax = val;
        }
      }
    }
  }

  // Fallback: If no total matches keyword, search for the largest amount on the receipt
  if (!bestTotal) {
    const allAmounts = [];
    const amountMatches = fullText.match(/\b\d{1,6}\.\d{2}\b/g);
    if (amountMatches) {
      amountMatches.forEach(m => {
        const num = parseFloat(m);
        if (!isNaN(num)) allAmounts.push({ raw: m, val: num });
      });
    }
    if (allAmounts.length > 0) {
      allAmounts.sort((a, b) => b.val - a.val);
      // Select the largest amount (usually the total)
      bestTotal = allAmounts[0].raw;
      // Second largest might be subtotal or vat
      if (allAmounts.length > 1 && !bestTax) {
        // If second largest is small compared to total, it could be tax
        const ratio = allAmounts[1].val / allAmounts[0].val;
        if (ratio > 0.05 && ratio < 0.25) {
          bestTax = allAmounts[1].raw;
        }
      }
    }
  }

  result.total = bestTotal;
  result.tax = bestTax;

  return result;
}
