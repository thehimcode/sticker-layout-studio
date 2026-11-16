/** แปลงเส้นปิดเป็น SVG Path หน่วยตามค่าที่ส่งเข้ามา (มม.) ไม่ทำ Transform เพิ่ม */
const num = (v) => String(Math.round(v * 1000) / 1000);

export function toPathData(paths) {
  return paths.map((path) => {
    const parts = [`M${num(path[0])} ${num(path[1])}`];
    for (let i = 2; i < path.length; i += 2) parts.push(`L${num(path[i])} ${num(path[i + 1])}`);
    parts.push('Z');
    return parts.join(' ');
  }).join(' ');
}

/** Cubic Bezier แบบ flat เป็น SVG Path: M จุดแรก แล้ว C ทีละช่วง ปิดด้วย Z */
export function toCurveData(curves) {
  return curves.map((curve) => {
    const parts = [`M${num(curve[0])} ${num(curve[1])}`];
    for (let i = 2; i + 5 < curve.length; i += 6) {
      parts.push(`C${num(curve[i])} ${num(curve[i + 1])} ${num(curve[i + 2])} ${num(curve[i + 3])} ${num(curve[i + 4])} ${num(curve[i + 5])}`);
    }
    parts.push('Z');
    return parts.join(' ');
  }).join(' ');
}

/** ข้อมูล Path ของเส้นตัด งานเก่าที่ยังไม่มี curves ใช้ Polyline */
export const cutlineData = (cutline) => (
  cutline.curves ? toCurveData(cutline.curves) : toPathData(cutline.closedPaths)
);

/** SVG เส้นตัดของแบบเดียว ขนาดตามเส้นตัด จุด 0,0 ของ viewBox เท่ากับมุมบนซ้ายของภาพ */
export function cutlineSvg(cutline, name) {
  const b = cutline.envelopeMm;
  const title = name.replace(/[<&>]/g, ' ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${num(b.width)}mm" height="${num(b.height)}mm" viewBox="${num(b.x)} ${num(b.y)} ${num(b.width)} ${num(b.height)}">
<title>${title}</title>
<g id="CUT_LINES" fill="none" stroke="#ff00ff" stroke-width="0.1">
<path d="${cutlineData(cutline)}"/>
</g>
</svg>
`;
}
