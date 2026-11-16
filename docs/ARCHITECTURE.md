# Architecture: Sticker Layout & Cutline Studio

อ้างอิง SRS v1.1 (2026-11-04) แผนงานใช้ M1–M5 ตาม SRS ข้อ 10
การแมป Requirement → Module → Test อยู่ใน [TRACEABILITY.md](TRACEABILITY.md)

## 1. ความเสี่ยงหลัก

| ความเสี่ยง | ผลถ้าพลาด | แนวทาง |
|---|---|---|
| ภาพพิมพ์กับเส้นตัดไม่ตรงกัน | งานเสียทั้งแผ่น | เมทริกซ์วางวัตถุจุดเดียว `placementMatrix` ใช้กับทุกปลายทาง และห้าม Re-layout ตอน Export |
| Offset และ Nesting ไม่เสถียร | เส้นตัดพัน ชิ้นงานชน | ใช้ Clipper2 หรือไลบรารีที่พิสูจน์แล้ว ทดสอบด้วยรูปยากก่อนต่อ UI |
| งานหนักทำหน้าจอค้าง | ใช้งานจริงไม่ได้ | Contour และ Nesting อยู่ใน Web Worker มี Progress และ Cancel |
| ข้อมูลหาย | เสียเวลางาน | บันทึกอัตโนมัติ และ Project File ใน M5 |

## 2. สถาปัตยกรรม

```
UI (src/ui)            Canvas, แผงควบคุม, ช่องกรอก
   │ เรียก actions         ▲ subscribe
   ▼                      │
App (src/app)          Store + Undo/Redo, นำเข้าไฟล์, บันทึกอัตโนมัติ
   │ เรียกฟังก์ชันล้วน
   ▼
Core (src/core)        เอกสาร, พิกัด, กระดาษ, ตรวจสอบ
                       ไม่แตะ DOM ทดสอบใน Node ได้ทั้งหมด
Workers (M2 เป็นต้นไป)  Contour, Offset, Nesting ใช้ Core เดียวกัน
```

- **ไม่มีขั้น Build** ใช้ ES Modules ตรง และไม่พึ่ง CDN จึงทำงาน Offline ได้ (NFR-02)
- **Core ไม่พึ่งเบราว์เซอร์** จึงมี Unit Test และใช้ใน Worker ได้
- **เอกสารเป็น Immutable** Undo เก็บแค่การอ้างอิง
- **ภาพเก็บแยก** `ImageBitmap` หนึ่งก้อนต่อไฟล์ ใช้ร่วมทุก Instance
- **ชั้นข้อมูลแยกกัน** Artwork, Cutlines, Marks, Guides (SRS ข้อ 2.4) เพิ่มเป็นโมดูลแยกตั้งแต่ M2

## 3. การรักษาพิกัด (SRS ข้อ 5)

- หน่วยเอกสาร: มิลลิเมตร เก็บค่าเต็ม ไม่ปัด ปัด 0.01 มม. เฉพาะตอนแสดงผล
- จุดอ้างอิง: `xMm, yMm` คือมุมบนซ้ายของกรอบหลัง Scale และก่อนหมุน
- ลำดับ Transformation: Scale ที่มุมบนซ้าย แล้วหมุนรอบจุดกึ่งกลางกรอบ
- แกน: X ไปทางขวา Y ลงล่าง มุมบวกตามเข็มนาฬิกา จุด 0,0 คือมุมบนซ้ายของกระดาษ
- `src/core/geometry.js: placementMatrix` คือ Single Source of Truth

## 4. Data Model (version 4)

ตามหัวข้อขั้นต่ำของ SRS ข้อ 5 ฟิลด์ของ M2 ขึ้นไปยังเป็นค่าว่าง

```js
Project  { id, version, name, paper, pages:[{id}], masters, instances, marks:[], keepouts, settings, lastLayout }
Paper    { preset, orientation, widthMm, heightMm, marginsMm:{top,right,bottom,left} }
Master   { id, name, sourceType, lockAspect, quantity, bleedMm, cutlineConfig, contours:{paths}, cutline,
           originalAsset:{assetId,mimeType,byteSize},
           naturalSize:{widthPx,heightPx,dpi}, desiredSizeMm:{widthMm,heightMm} }
Instance { id, masterId, pageId, placementStatus:'placed'|'unplaced',
           transform:{xMm,yMm,rotationDeg,scaleX,scaleY} }
Cutline  { sourceMasterId, closedPaths, offsetMm, contourParameters, geometryVersion,
           sizeMm, envelopeMm, issues, stale }
settings { spacingMm:3, spacingMode:'cutline'|'image', layout:{ sortBy, rotationStep, autoPages } }
Keepout  { id, xMm, yMm, widthMm, heightMm }  // ใช้ทุกหน้า
Mark     { id, shape:'circle'|'square'|'cross'|'corner', xMm, yMm, widthMm, heightMm, rotationDeg,
           fill, stroke, lineMm, locked, keepoutMm }  // ใช้ทุกหน้า ตำแหน่งเดียวกัน
markSettings { profileId, label, verificationStatus, template, exportOptions } | null
MachineProfile { id, label, builtIn, verificationStatus, note, coordinateConvention, template | marks,
                 paperMm?, exportOptions, pageRules }
settings.export { dpi, png, jpg, pdf, cutSvg, combinedSvg, pngBackground, includeMarks, marksInCutSvg, multiPageNaming }
```

Pipeline เส้นตัด: พิกเซล → Mask → Marching Squares → Taubin Smooth → RDP Simplify เก็บเป็น Contour
ในพิกัดพิกเซลของภาพต้นฉบับ จากนั้นแปลงเป็น มม. ตามขนาดจริง รวมเส้น Offset ด้วย Clipper2
ลบมุมเว้าด้วย Closing ตามรัศมีจริง เกลี่ยเส้น แล้วฟิต Cubic Bezier แบบ G1 ค่าคลาดเคลื่อน 0.05 มม.
`curves` คือเส้นที่วาดและส่งออก `closedPaths` คือ Polyline ที่ได้จาก `curves` ชุดเดียวกัน ใช้คำนวณเรขาคณิต
เส้นตัดเก็บเป็น มม. ในพิกัดชิ้นงาน ทุกสำเนาใช้ร่วมกันผ่าน `placementMatrix` เมื่อแก้ขนาด
เส้นเดิมถูกทำเครื่องหมาย `stale` แล้วคำนวณใหม่จาก Contour ไม่ Scale เส้นเดิม

- `quantity` เท่ากับจำนวน Instance เสมอ
- ชิ้นที่ไม่มีที่วางเป็น `unplaced` ไม่ซ้อนและไม่ย่อ เพื่อรองรับหลายหน้าใน M3
- ทุกคำสั่งแก้ไขคืนเอกสารที่ถูกต้อง หรือ throw `UserError` โดยเอกสารเดิมไม่เปลี่ยน
- งานบันทึกจากรุ่นก่อนหน้าแปลงอัตโนมัติด้วย `migrate`
- `src/core/shape.js` ให้รูปร่างจริงสองชุด: `wide` (ภาพ + Bleed + เส้นตัด) และ `image` (ภาพ + Bleed)
  ทั้งการกันขอบ การตรวจ และ Nesting ใช้รูปร่างนี้ ถ้าไม่มีเส้นตัดใช้กรอบภาพ
- Nesting (`src/core/layout/layout.js`): No-Fit Polygon จาก Minkowski Sum ของ Clipper2 วางทีละชิ้นที่ขอบล่างต่ำสุด
  แล้วชิดซ้าย ค้นด้วยรูปที่ลดจุดและครอบรูปจริง ก่อนใช้ผล `verifyLayout` ตรวจซ้ำกับรูปเต็มโดยไม่อาศัย NFP
  ถ้าไม่ผ่านจะไม่นำผลมาใช้
- ภาพพื้นทึบ (โหมดสีพื้นหลัง) ถูกตัดตามเส้นตัดทั้งบนจอและในไฟล์ส่งออก
- มาร์ค: `xMm, yMm` คือจุดกึ่งกลาง หมุนรอบจุดกึ่งกลาง (`src/core/marks.js: markMatrix`) พื้นที่สงวนคือกรอบหลังหมุนขยายด้วย `keepoutMm`
  `effectiveKeepouts` รวม Keep-out ที่ผู้ใช้กำหนดกับพื้นที่สงวนของมาร์ค ทุกจุดที่กันทับใช้ฟังก์ชันนี้
- ตัววาดหน้า `src/render/page-render.js` ใช้ร่วมระหว่าง Canvas บนจอและการส่งออก ภาพพิมพ์วาดที่ DPI ที่เลือกด้วยเมทริกซ์เดียวกัน
  SVG เขียนพิกัดเส้นตัดหลังแปลงด้วย `placementMatrix` ลงไฟล์ตรง ๆ ไม่ใช้ attribute transform
- Bleed ยืดพิกเซลแถวขอบภาพออกไปตามระยะ (Edge Extension)

## 5. โครงสร้างโฟลเดอร์

```
index.html, styles/app.css
src/main.js          ประกอบโปรแกรม, คำสั่งผู้ใช้
src/core/            units, paper, geometry, shape, viewport, document, validate, image-meta, errors
src/core/contour/    mask, trace, path, bezier, clipper-ops, pipeline, svg
src/core/layout/     layout (Standard, Nesting, ตรวจผล)
src/app/             store, importer, persistence, cutline-service, cutline-jobs
src/core/marks.js    Registration Marks, Machine Profile, พื้นที่สงวน
src/render/          page-render (ตัววาดหน้าที่ใช้ร่วมกันระหว่างจอและไฟล์)
src/export/          binary, image-dpi (pHYs/JFIF), pdf, zip, svg-export, preflight (ไม่พึ่ง DOM)
src/app/             exporter (วาดและเข้ารหัสในเบราว์เซอร์), profiles (User Profile ใน localStorage)
src/ui/              canvas-view, panels, fields, cutline-editor, marks-panel, export-dialog
src/workers/         cutline.worker
vendor/clipper2/     Clipper2-WASM พร้อม License
tests/               Unit Tests (node:test)
tests/e2e/           ทดสอบในเบราว์เซอร์ (Playwright)
test-data/, tools/, docs/
```

## 6. Library

| งาน | เลือก | License | Offline | เหตุผล และสถานะ |
|---|---|---|---|---|
| Editor | Canvas 2D ตรง (ผู้ใช้อนุมัติแล้ว) | ไม่มี | ได้ | ไม่ใช้ Konva/Fabric ที่ SRS เสนอ เพราะเมทริกซ์วางวัตถุต้องเป็นของเราเอง ไม่ใช่ของ Library และโมเดล 2000 ชิ้นวาดได้ตรง ๆ ทบทวนได้ถ้า Editor ซับซ้อนขึ้น |
| อ่าน PDF/AI | pdfjs-dist 6.2.108 | Apache-2.0 | Bundle ได้ | M5 |
| เขียน PDF และ Zip | เขียนเอง (`src/export/pdf.js`, `zip.js`) | ไม่มี | ได้ | เดิมวางแผนใช้ pdf-lib แต่ PDF พิมพ์ต้องการแค่ภาพเต็มหน้า จึงเขียนเองราว 60 บรรทัด บีบอัดด้วย CompressionStream ของเบราว์เซอร์ ไม่ต้องดาวน์โหลด Library |
| Offset/Boolean | clipper2-wasm 0.4.0 | BSL-1.0 | อยู่ใน `vendor/clipper2` | SRS แนะนำและผู้ใช้อนุมัติแล้ว ขนาดจริง 268 KB ไม่มีสคริปต์ติดตั้ง ผู้ใช้ดาวน์โหลดจาก npm แล้วแนบมา |
| Contour | เขียนเองบน ImageData | ไม่มี | ได้ | Marching Squares ไม่ต้องใช้ OpenCV.js ที่ขนาดใหญ่ ทบทวนใน M2 ถ้า Mask JPG ต้องการมากกว่านี้ |

ข้อจำกัดจากเบราว์เซอร์: Canvas ทำงานใน sRGB การแปลง CMYK ตาม ICC profile จึงไม่อยู่ในแผน

## 7. Milestones ตาม SRS

| # | เนื้อหา | สถานะ |
|---|---|---|
| M1 | Workspace & Object Editor | ปิดงานแล้ว รายละเอียดใน STATUS.md |
| M2 | Cutline Engine: Mask/Contour, SVG Path, Offset, Preview, Basic Editing, Geometry Tests | ปิดงานแล้ว |
| M3 | Layout & Nesting: Standard Layout, Spacing, Keep-out, Multi-page, Polygon Nesting | ปิดงานแล้ว |
| M4 | Marks & Export: 3 Templates, Custom Marks, Machine Profiles, Export, Preflight | ส่งตรวจ รายละเอียดใน STATUS.md |
| M5 | PDF/AI import, Save Project, Performance, Production Testing | ยังไม่เริ่ม |

## 8. สมมติฐาน

- ไฟล์ไม่มี DPI ใช้ 300 DPI
- กระดาษกำหนดเอง 10–5000 มม.
- ภาพที่ใหญ่กว่าพื้นที่ตอนนำเข้าย่อขนาดเริ่มต้นพร้อมแจ้ง (เป็นการตั้งขนาดครั้งแรก ไม่ใช่ Auto Scale ของงานที่มีอยู่)
- ขนาดอยู่ที่ Master ใช้ร่วมทุก Instance ตาม `desiredSizeMm` และ FR-03.4 ส่วน `scaleX/Y` คงเป็น 1 ใน M1
- ขีดจำกัด 2000 Instance ต่อโปรเจกต์ ไม่จำกัดจำนวนแบบ
- Keep-out ใช้กับทุกหน้า เป็นสี่เหลี่ยม กำหนดด้วยตัวเลข
- โหมดขอบภาพยังกันไม่ให้ Envelope ทับกันตาม FR-09.6
- MicroCut 30Q: ใช้ชื่อ `MicroCut 30Q - Custom 5 Dots (Unverified)` จนกว่าจะยืนยันข้อมูลตาม SRS ข้อ 11
  ค่าวัดจาก PDF ที่ SignMaster สร้าง (Teneth MC350CCD, ARMS CCD 5mm): จุดดำ ⌀5 มม. ที่ 4 มุม + จุดที่ 5 ใต้จุดบนซ้าย 20 มม.
  + สามเหลี่ยมด้าน 4 มม. ยอดชี้ขึ้นกลางขอบบน ฐานเหนือแนวจุดบน 2 มม. Page Mark Margins คือระยะจากขอบกระดาษถึงจุดกึ่งกลาง
  การอ่านมาร์คกับเครื่องจริงยังไม่ได้ทดสอบ
- Template ของมาร์คใช้ `marginsMm {top,right,bottom,left}` วัดถึงจุดกึ่งกลางของมาร์คมุม ทุก Template ใช้ความหมายเดียวกัน
- ไฟล์ตัดใช้เส้น Magenta #ff00ff หนา 0.1 มม. มาร์คในไฟล์ตัดเป็นรูปเติมสีไม่มีเส้น อยู่ในกลุ่ม `REG_MARKS_REFERENCE_NOT_CUT`
- ไฟล์ส่งออกใช้ชื่อ `ชื่องาน_p01_ชนิด.นามสกุล` ชนิดคือ print, print-marks, cut, combined PDF รวมทุกหน้าในไฟล์เดียว
