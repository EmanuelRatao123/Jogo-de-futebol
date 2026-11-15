export interface SpriteSlice {
  x: number;
  width: number;
}

export interface SpriteBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
}

/**
 * Pure column segmentation helper (kept for horizontal strip tests).
 */
export function detectSpriteColumns(
  columnHasForeground: boolean[],
  expectedCount: number,
  minGapWidth = 4
): SpriteSlice[] {
  const width = columnHasForeground.length;
  if (width === 0 || expectedCount <= 0) return [];

  const rawSegments: SpriteSlice[] = [];
  let inSeg = false;
  let segStart = 0;
  let gapCount = 0;

  for (let x = 0; x < width; x++) {
    if (columnHasForeground[x]) {
      if (!inSeg) {
        inSeg = true;
        segStart = x;
      }
      gapCount = 0;
    } else if (inSeg) {
      gapCount++;
      if (gapCount >= minGapWidth) {
        const segEnd = x - gapCount;
        if (segEnd - segStart >= 12) {
          rawSegments.push({ x: segStart, width: segEnd - segStart + 1 });
        }
        inSeg = false;
      }
    }
  }

  if (inSeg) {
    const segEnd = width - 1;
    if (segEnd - segStart >= 12) {
      rawSegments.push({ x: segStart, width: segEnd - segStart + 1 });
    }
  }

  if (rawSegments.length > expectedCount) {
    return [...rawSegments]
      .sort((a, b) => b.width - a.width)
      .slice(0, expectedCount)
      .sort((a, b) => a.x - b.x);
  }

  if (rawSegments.length === expectedCount) {
    return rawSegments;
  }

  const sliceWidth = Math.floor(width / expectedCount);
  const even: SpriteSlice[] = [];
  for (let i = 0; i < expectedCount; i++) {
    even.push({
      x: i * sliceWidth,
      width: i === expectedCount - 1 ? width - i * sliceWidth : sliceWidth,
    });
  }
  return even;
}

/**
 * Pure 2D connected-component clustering over an opaque foreground mask.
 * Properly separates diagonal poses (e.g., diving goalkeepers) whose X bounds
 * overlap horizontally without touching in 2D space.
 */
export function extractSpriteComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  expectedCount: number
): { labels: Int32Array; boxes: SpriteBox[] } {
  const labels = new Int32Array(width * height);
  const rawBoxes: SpriteBox[] = [];
  const queue = new Int32Array(width * height);
  let currentLabel = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startIdx = y * width + x;
      if (mask[startIdx] === 0 || labels[startIdx] !== 0) continue;

      currentLabel++;
      let head = 0;
      let tail = 0;
      queue[tail++] = startIdx;
      labels[startIdx] = currentLabel;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let pixelCount = 0;

      while (head < tail) {
        const idx = queue[head++];
        const cx = idx % width;
        const cy = (idx - cx) / width;
        pixelCount++;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        // 8-connectivity neighbors
        for (let ny = cy - 1; ny <= cy + 1; ny++) {
          if (ny < 0 || ny >= height) continue;
          const rowOff = ny * width;
          for (let nx = cx - 1; nx <= cx + 1; nx++) {
            if (nx < 0 || nx >= width) continue;
            const nIdx = rowOff + nx;
            if (mask[nIdx] === 1 && labels[nIdx] === 0) {
              labels[nIdx] = currentLabel;
              queue[tail++] = nIdx;
            }
          }
        }
      }

      rawBoxes.push({ minX, minY, maxX, maxY, pixelCount });
    }
  }

  // Keep the top `expectedCount` largest connected components as primary character anchors
  const indexed = rawBoxes
    .map((box, i) => ({ box, label: i + 1 }))
    .filter((item) => item.box.pixelCount >= 40);

  if (indexed.length === 0) {
    return { labels, boxes: [] };
  }

  const anchors = [...indexed]
    .sort((a, b) => b.box.pixelCount - a.box.pixelCount)
    .slice(0, expectedCount)
    .sort((a, b) => (a.box.minX + a.box.maxX) - (b.box.minX + b.box.maxX));

  // Map every foreground pixel label to its nearest anchor (if not already an anchor)
  const labelToSlot = new Int32Array(currentLabel + 1).fill(-1);
  anchors.forEach((a, slotIdx) => {
    labelToSlot[a.label] = slotIdx;
  });

  for (const item of indexed) {
    if (labelToSlot[item.label] !== -1) continue;
    const cx = (item.box.minX + item.box.maxX) * 0.5;
    const cy = (item.box.minY + item.box.maxY) * 0.5;
    let bestSlot = -1;
    let bestDist = Infinity;

    for (let s = 0; s < anchors.length; s++) {
      const ab = anchors[s].box;
      const dx = Math.max(ab.minX - cx, 0, cx - ab.maxX);
      const dy = Math.max(ab.minY - cy, 0, cy - ab.maxY);
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        bestDist = d;
        bestSlot = s;
      }
    }

    // Attach small fragments (e.g. separated hair/shoe/glove detail) within 30px
    if (bestSlot !== -1 && bestDist <= 30) {
      labelToSlot[item.label] = bestSlot;
      const target = anchors[bestSlot].box;
      target.minX = Math.min(target.minX, item.box.minX);
      target.minY = Math.min(target.minY, item.box.minY);
      target.maxX = Math.max(target.maxX, item.box.maxX);
      target.maxY = Math.max(target.maxY, item.box.maxY);
      target.pixelCount += item.box.pixelCount;
    }
  }

  // Rewrite labels array in place to store slot index + 1 (0 = background/unassigned)
  for (let i = 0; i < labels.length; i++) {
    const lbl = labels[i];
    if (lbl > 0) {
      const slot = labelToSlot[lbl];
      labels[i] = slot >= 0 ? slot + 1 : 0;
    }
  }

  return {
    labels,
    boxes: anchors.map((a) => a.box),
  };
}

function isChromaMagenta(r: number, g: number, b: number): number {
  const rbMin = Math.min(r, b);
  const magentaExcess = rbMin - g;
  if (magentaExcess > 75 && r > 130 && b > 130) {
    return 1;
  }
  if (magentaExcess > 32 && r > 110 && b > 110) {
    return (magentaExcess - 32) / 43;
  }
  return 0;
}

export interface ProcessedSpritesheet {
  frames: HTMLCanvasElement[];
  sourceUrl: string;
}

export async function loadChromaKeyedSpritesheet(
  url: string,
  expectedCount: number,
  options?: {
    mirrorIndex?: number;
    targetSize?: number;
  }
): Promise<ProcessedSpritesheet> {
  const targetSize = options?.targetSize ?? 384;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = (err) => reject(err);
    image.src = url;
  });

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.naturalWidth;
  srcCanvas.height = img.naturalHeight;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) {
    return { frames: [], sourceUrl: url };
  }
  srcCtx.drawImage(img, 0, 0);

  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const imgData = srcCtx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const fgMask = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pIdx = y * w + x;
      const idx = pIdx * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const bgAlpha = isChromaMagenta(r, g, b);
      if (bgAlpha > 0) {
        const keep = Math.max(0, 1 - bgAlpha);
        data[idx + 3] = Math.round(keep * 255);
        if (keep > 0 && keep < 1) {
          data[idx] = Math.min(r, g + (r - g) * 0.25);
          data[idx + 2] = Math.min(b, g + (b - g) * 0.25);
        }
        if (keep > 0.45) {
          fgMask[pIdx] = 1;
        }
      } else {
        fgMask[pIdx] = 1;
      }
    }
  }

  srcCtx.putImageData(imgData, 0, 0);

  const { labels, boxes } = extractSpriteComponents(fgMask, w, h, expectedCount);
  const frames: HTMLCanvasElement[] = [];

  for (let s = 0; s < boxes.length; s++) {
    const box = boxes[s];
    const cropW = box.maxX - box.minX + 1;
    const cropH = box.maxY - box.minY + 1;

    // Extract only pixels belonging to component slot (s + 1) so overlapping X neighbors are masked out
    const isolated = document.createElement('canvas');
    isolated.width = cropW;
    isolated.height = cropH;
    const isoCtx = isolated.getContext('2d')!;
    const isoImg = isoCtx.createImageData(cropW, cropH);
    const isoData = isoImg.data;
    const targetSlot = s + 1;

    for (let ly = 0; ly < cropH; ly++) {
      const sy = box.minY + ly;
      for (let lx = 0; lx < cropW; lx++) {
        const sx = box.minX + lx;
        const pIdx = sy * w + sx;
        const dIdx = (ly * cropW + lx) * 4;
        // Include pixel if it belongs to this slot, or if it's a semi-transparent edge halo adjacent to this slot
        const lbl = labels[pIdx];
        const sIdx = pIdx * 4;
        if (lbl === targetSlot || (lbl === 0 && data[sIdx + 3] > 0 && data[sIdx + 3] < 160)) {
          // Verify semi-transparent edge isn't closer to another slot
          let belongsHere = lbl === targetSlot;
          if (!belongsHere) {
            for (let oy = -2; oy <= 2 && !belongsHere; oy++) {
              const ny = sy + oy;
              if (ny < 0 || ny >= h) continue;
              for (let ox = -2; ox <= 2; ox++) {
                const nx = sx + ox;
                if (nx >= 0 && nx < w && labels[ny * w + nx] === targetSlot) {
                  belongsHere = true;
                  break;
                }
              }
            }
          }
          if (belongsHere) {
            isoData[dIdx] = data[sIdx];
            isoData[dIdx + 1] = data[sIdx + 1];
            isoData[dIdx + 2] = data[sIdx + 2];
            isoData[dIdx + 3] = data[sIdx + 3];
          }
        }
      }
    }
    isoCtx.putImageData(isoImg, 0, 0);

    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = targetSize;
    frameCanvas.height = targetSize;
    const fCtx = frameCanvas.getContext('2d');
    if (fCtx) {
      const pad = 16;
      const scale = Math.min((targetSize - pad * 2) / cropW, (targetSize - pad * 2) / cropH);
      const drawW = cropW * scale;
      const drawH = cropH * scale;
      const drawX = (targetSize - drawW) / 2;
      const drawY = targetSize - pad - drawH;
      fCtx.drawImage(isolated, 0, 0, cropW, cropH, drawX, drawY, drawW, drawH);
    }

    frames.push(frameCanvas);
  }

  if (options?.mirrorIndex !== undefined && frames[options.mirrorIndex]) {
    const source = frames[options.mirrorIndex];
    const mirrored = document.createElement('canvas');
    mirrored.width = targetSize;
    mirrored.height = targetSize;
    const mCtx = mirrored.getContext('2d');
    if (mCtx) {
      mCtx.translate(targetSize, 0);
      mCtx.scale(-1, 1);
      mCtx.drawImage(source, 0, 0);
    }
    frames.push(mirrored);
  }

  return { frames, sourceUrl: url };
}
