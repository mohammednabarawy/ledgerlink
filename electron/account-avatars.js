/**
 * Convert remote image URLs to data URLs for reliable display in Electron renderer.
 */
export async function urlToDataUrl(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

export function bufferToDataUrl(buffer, mime = 'image/jpeg') {
  if (!buffer || !buffer.length) return null;
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** Run async work on items with limited concurrency. */
export async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await mapper(items[i], i);
    }
  }

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
