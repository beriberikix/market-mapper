/**
 * Export. The SVG path is a straight serialization of what is on screen; the
 * PNG path rasterizes that same markup through a canvas.
 *
 * The canvas never taints because logos.js has already inlined every image as
 * a data: URI. If that ever regresses, PNG export fails with a security error
 * while SVG export keeps working -- which is the tell.
 */

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function slug(title) {
  return (
    String(title || 'market-map')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'market-map'
  );
}

export function exportSvg(markup, title) {
  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${markup}`], {
    type: 'image/svg+xml;charset=utf-8',
  });
  download(blob, `${slug(title)}.svg`);
}

export async function exportPng(markup, width, height, title, scale = 2) {
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not rasterize the map'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0, width, height);

    const png = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))),
        'image/png'
      );
    });

    download(png, `${slug(title)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
