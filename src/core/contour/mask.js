/**
 * สร้าง Mask จากพิกเซล RGBA ผลลัพธ์เป็น Uint8Array ขนาด width × height ค่า 1 คือชิ้นงาน
 * ทำงานได้ทั้งใน Worker และ Node
 */
export function alphaMask(rgba, width, height, threshold) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) mask[i] = rgba[i * 4 + 3] >= threshold ? 1 : 0;
  return mask;
}

/** ค่าสีพื้นหลังโดยประมาณ: มัธยฐานจากพิกเซลขอบภาพทั้งสี่มุม */
export function detectBackground(rgba, width, height) {
  const size = Math.max(1, Math.min(8, Math.floor(Math.min(width, height) / 4)));
  const samples = [[], [], []];
  for (const [ox, oy] of [[0, 0], [width - size, 0], [0, height - size], [width - size, height - size]]) {
    for (let y = oy; y < oy + size; y += 1) {
      for (let x = ox; x < ox + size; x += 1) {
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c += 1) samples[c].push(rgba[i + c]);
      }
    }
  }
  return samples.map((s) => s.sort((a, b) => a - b)[s.length >> 1]);
}

/**
 * แยกพื้นหลังด้วยการไหลจากขอบภาพ พื้นหลังคือพิกเซลที่ต่อกับขอบและสีใกล้ bg
 * สีเดียวกันที่อยู่กลางชิ้นงานจึงไม่ถูกตัดออก
 */
export function colorMask(rgba, width, height, bg, tolerance) {
  const total = width * height;
  const limit = tolerance * tolerance * 3;
  const isBg = (p) => {
    const i = p * 4;
    if (rgba[i + 3] < 128) return true;
    const dr = rgba[i] - bg[0];
    const dg = rgba[i + 1] - bg[1];
    const db = rgba[i + 2] - bg[2];
    return dr * dr + dg * dg + db * db <= limit;
  };
  const mask = new Uint8Array(total).fill(1);
  const stack = new Int32Array(total);
  let top = 0;
  const push = (p) => {
    if (mask[p] === 1 && isBg(p)) {
      mask[p] = 0;
      stack[top] = p;
      top += 1;
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push(total - width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (top > 0) {
    top -= 1;
    const p = stack[top];
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < total - width) push(p + width);
  }
  return mask;
}

/** ลบกลุ่มพิกเซลค่า value ที่พื้นที่น้อยกว่า minArea โดยกลับค่าเป็นตรงข้าม คืนจำนวนกลุ่มที่เหลือ */
function dropSmall(mask, width, height, value, minArea) {
  const total = width * height;
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  let kept = 0;
  for (let start = 0; start < total; start += 1) {
    if (seen[start] || mask[start] !== value) continue;
    const pixels = [];
    let top = 1;
    stack[0] = start;
    seen[start] = 1;
    let touchesEdge = false;
    while (top > 0) {
      top -= 1;
      const p = stack[top];
      pixels.push(p);
      const x = p % width;
      if (x === 0 || x === width - 1 || p < width || p >= total - width) touchesEdge = true;
      const visit = (q) => {
        if (!seen[q] && mask[q] === value) {
          seen[q] = 1;
          stack[top] = q;
          top += 1;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < total - width) visit(p + width);
    }
    const protectedBackground = value === 0 && touchesEdge;
    if (pixels.length < minArea && !protectedBackground) {
      for (const p of pixels) mask[p] = value ? 0 : 1;
    } else {
      kept += 1;
    }
  }
  return kept;
}

/** ลด Noise: ลบจุดเล็กและอุดรูเล็ก แก้ mask ที่ส่งเข้ามา คืนจำนวนชิ้นส่วน */
export function removeNoise(mask, width, height, minArea) {
  dropSmall(mask, width, height, 0, minArea);
  return dropSmall(mask, width, height, 1, minArea);
}

export function coverage(mask) {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) count += mask[i];
  return count / mask.length;
}

/** ภาพมีความโปร่งใสที่ใช้แยกวัตถุได้หรือไม่ */
export function hasUsableAlpha(rgba, width, height) {
  let transparent = 0;
  const total = width * height;
  for (let i = 0; i < total; i += 1) if (rgba[i * 4 + 3] < 128) transparent += 1;
  return transparent > total * 0.001;
}
