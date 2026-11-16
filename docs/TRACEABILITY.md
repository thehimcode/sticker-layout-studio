# Requirement Traceability Map (M1–M3)

Unit = `tests/*.test.mjs`, E2E = `tests/e2e/m1.e2e.mjs` และ `m2.e2e.mjs`, `m3.e2e.mjs`
สถานะ: ครบ, บางส่วน, ไม่อยู่ใน M1

| Requirement | Module | Test | สถานะ |
|---|---|---|---|
| FR-01.1 A4 เริ่มต้น | core/paper, document | Unit, AC-01 | ครบ |
| FR-01.2 A0–A6 | core/paper | Unit | ครบ |
| FR-01.3 A3+ และ Super A3 พร้อมคำอธิบาย | core/paper, ui/panels | Unit, AC-01 | ครบ |
| FR-01.4 Custom | core/paper | Unit, AC-01 | ครบ |
| FR-01.5 แนวกระดาษ, Zoom, Fit, ไม้บรรทัด, Grid | core/viewport, ui/canvas-view | Unit, E2E FR-01.5 | ครบ |
| FR-01.6 ไม่อิง Zoom, ไม่ปัดค่า | core/units, geometry, export | Unit, E2E Zoom, NFR-07, AC-11 | ครบ |
| FR-02.1 Drag & Drop, Picker หลายไฟล์ | main, app/importer | E2E (จำลอง Drop), ผู้ใช้ทดสอบลากไฟล์จริงแล้ว | ครบ |
| FR-02.2 PNG Alpha, JPG | app/importer | E2E FR-02 | PNG/JPG ครบ PDF อยู่ M5 |
| FR-02.5 ข้อมูลไฟล์ | ui/panels | E2E FR-02 | ครบ |
| FR-02.6 จัดการหน่วยความจำ | main, importer | ไม่มีอัตโนมัติ | บางส่วน: เตือนเมื่อเกิน 1.5 GB |
| FR-02.7 ไฟล์เสีย | image-meta, importer | Unit, E2E | ครบ |
| FR-03.1 จำนวน ≥ 0 | core/document | Unit, AC-04 | ครบ |
| FR-03.2 ปุ่ม +/−, ช่องกรอก | ui/panels | AC-04 | ครบ |
| FR-03.3 ขนาด, ล็อก, หมุน, ย้าย, ลำดับ | document, geometry, canvas-view | Unit, E2E | ครบ |
| FR-03.5 หลายชิ้น, Duplicate, Delete, Align, Undo | document, store, canvas-view | Unit, E2E FR-03.5 | ครบ |
| FR-03.6 ลดจำนวนคาดเดาได้ | core/document | Unit | ครบ |
| FR-08.1 Margin 4 ด้าน ค่าเริ่มต้น 5 | core/paper | Unit, AC-02 | ครบ |
| FR-08.2 Link Margins | ui/panels | E2E FR-08.2 | ครบ |
| FR-08.3 พื้นที่วางงาน รวม Artwork, Bleed, Cutline, Keep-out | core/document, shape, validate | Unit, E2E M2, M3 | ครบ |
| FR-08.4 Clamp พร้อม Feedback | document, canvas-view | Unit, AC-02 | ครบ |
| FR-08.5 ตรวจแล้วแจ้ง ไม่ Scale | document, validate | Unit, E2E FR-08.5 | ครบ |
| FR-08.6 กันพื้นที่ติดลบ | core/paper | Unit, AC-02 | ครบ |
| FR-11.3, 11.4 เก็บในเครื่อง, เตือนก่อนปิด | app/persistence, main | Unit, E2E | IndexedDB ครบ Project File อยู่ M5 |
| NFR-01 UI ไทย, จอหลายขนาด | ทุก UI | E2E จอเล็ก | ครบ |
| NFR-02 ไม่ส่งไฟล์ออก, Offline | ทั้งระบบ | ตรวจโค้ด: ไม่มีการเรียกเครือข่าย | ครบ |
| NFR-03 Chrome/Edge | ทั้งระบบ | E2E Chromium | Chromium ผ่าน Edge และ Firefox ยังไม่ได้ทดสอบ |
| NFR-07 ≤0.1 มม. | core/geometry | Unit, E2E ตรวจพิกเซล | ครบส่วน Editor |
| NFR-08 Undo/Redo, Cleanup | store, main | Unit, E2E | ครบ Bitmap ถูกปิดเมื่อเริ่มงานใหม่ |
| NFR-09 แจ้งความล้มเหลวตามจริง | main, persistence | Unit, E2E | ครบ |

## M2 Cutline Engine

| Requirement | Module | Test | สถานะ |
|---|---|---|---|
| FR-04.1 Contour จาก Alpha, Threshold ปรับได้ | contour/mask, trace, cutline-editor | Unit, E2E | ครบ |
| FR-04.2 เลือกสีพื้นหลัง, Threshold, Preview | contour/mask, cutline-editor | Unit, E2E AC-14 | ครบ |
| FR-04.3 ขอบนอก, รวมเส้นเดียว, หลาย Contour | contour/pipeline | Unit, E2E | ครบ |
| FR-04.4 ลด Noise, Smooth, Simplify, SVG Path ปิด | contour/mask, path, bezier, svg | Unit, E2E SVG | ครบ เป็น Cubic Bezier ต่อเนื่อง |
| FR-04.5 Offset ±, ค่าเริ่มต้น +2, Magenta, ตาม Geometry | contour/clipper-ops, canvas-view | Unit, AC-06 | ครบ |
| FR-04.6 รีเซ็ต, สร้างใหม่, ตรวจเส้นซ้อนและ Path ที่ใช้ไม่ได้ | contour/pipeline, path, cutline-editor | Unit, E2E | ครบ |
| FR-04.7 แก้ Contour พื้นฐาน, เตือนผลไม่แน่นอน | cutline-editor, pipeline | E2E | ครบ ย้าย เพิ่ม ลบจุด |
| FR-04.8 พิกเซลเป็น มม., แก้ขนาดแล้วคำนวณใหม่ | contour/pipeline, app/cutline-jobs | Unit, E2E | ครบ |
| FR-03.4 ค่าเส้นตัดต่อแบบ ใช้ร่วมทุก Instance | core/document | Unit | ครบ Spacing เป็นค่าระดับโปรเจกต์ |
| FR-11.3 เก็บเส้นตัดในเครื่อง | app/persistence | E2E รีโหลด | IndexedDB ครบ |
| NFR-04 Web Worker | workers/cutline.worker, app/cutline-service | E2E | ครบ |
| NFR-05 Progress, Error, Cancel | cutline-service, cutline-editor | E2E | ครบ |
| NFR-07 ≤0.1 มม. | contour/* | AC-06 ที่ราว 300 DPI | ครบ และเตือนเมื่อความละเอียดภาพไม่พอ |
| NFR-08 Cleanup Worker, WASM | cutline-service, clipper-ops | Unit, E2E | ครบ |

## M3 Layout & Nesting

| Requirement | Module | Test | สถานะ |
|---|---|---|---|
| FR-05.1 Standard Layout | core/layout | Unit, E2E | ครบ |
| FR-05.2 Smart Nesting รูปจริง, หมุนตาม step | core/layout | Unit, AC-07 | ครบ |
| FR-05.3 อยู่ในพื้นที่ ไม่ทับ Keep-out | core/layout, verifyLayout | Unit, AC-09 | ครบ |
| FR-05.4 ระยะห่างทุกคู่ | core/layout | Unit, AC-07 | ครบ |
| FR-05.5 หลายหน้าและรายงานผล | core/layout, document, panels | Unit, AC-12 | ครบ |
| FR-05.6 ไม่ย่ออัตโนมัติ | core/layout | Unit, E2E | ครบ |
| FR-05.7 Progress, Cancel, คำนวณใหม่ | worker, cutline-jobs, main | E2E | ครบ |
| FR-05.8 ผลไม่ละเมิด รายงานเมื่อวางไม่ครบ | verifyLayout, cutline-jobs | Unit | ครบ |
| FR-09.1 ระยะห่างเป็น มม. ค่าเริ่มต้น 3 | core/document, panels | Unit, E2E | ครบ |
| ช่องตัวเลข ▲▼ และหน่วย (คำขอผู้ใช้ หลังตรวจ M3) | ui/fields | Unit, E2E ช่องตัวเลข | ครบ |
| FR-09.2 โหมดภาพและเส้นตัด | core/layout, validate | Unit | ครบ |
| FR-09.3 ค่าเริ่มต้นวัดจากเส้นตัด | core/document | Unit, E2E | ครบ |
| FR-09.4 วัดจาก Polygon จริง | core/shape, layout | Unit, AC-07 | ครบ |
| FR-09.5 ตรวจตอนจัดเอง | core/validate | Unit, E2E | ครบ แจ้งเตือน ไม่บล็อกการลาก |
| FR-09.6 Bleed และ Envelope กว้างสุด | contour/pipeline, shape | Unit, E2E | ครบ |
| FR-08.3/FR-10.7 Keep-out | core/document, marks, canvas-view | Unit, AC-09, E2E M4 | ครบ รวมพื้นที่สงวนของมาร์ค |

## Acceptance Criteria

| AC | ผล |
|---|---|
| AC-01 Paper | ผ่าน |
| AC-02 Margins | ผ่าน ลากทั้ง 4 ด้านด้วยเมาส์ |
| AC-03 Import | ผ่านเฉพาะ PNG/JPG และการแจ้งเตือน PDF หลายหน้าอยู่ M5 |
| AC-04 Quantity | ผ่าน จำนวนในไฟล์ส่งออกตรงกับจำนวนที่วาง Preflight แจ้งชิ้นที่ยังวางไม่ได้ |
| AC-08 Marks | ผ่าน 5 จุดกำหนดเอง เปลี่ยนขนาด ลากย้าย ล็อก บันทึกและโหลด Profile |
| AC-10 Export | ผ่าน PNG/JPG/PDF ไม่มีเส้นตัด, Print+Marks มีมาร์ค, Cut SVG มี Path จริง มาร์คเป็นชั้นอ้างอิงไม่มีเส้น |
| AC-11 Alignment | ผ่าน คลาดสูงสุด 0.014 มม. ที่ 300 DPI |
| AC-05 Contour | ผ่าน รูปดาวและรูปตัว C |
| AC-06 Offset | ผ่าน Circle และ Square ≤0.1 มม. ที่ความละเอียดราว 300 DPI |
| AC-07 Spacing | ผ่าน 10 ชิ้น เส้นตัดทุกคู่ ≥3 มม. ตรวจอิสระจากโค้ดโปรแกรม |
| AC-09 Keep-out | ผ่าน ทั้ง Auto Layout และการลากเอง |
| AC-12 Multi-page | ผ่าน จำนวนและสเกลไม่เปลี่ยน |
| AC-14 Error | ผ่าน มีการแยกสี Preview และคำเตือน |

## M4 Marks & Export

| Requirement | Module | Test | สถานะ |
|---|---|---|---|
| FR-06.1 สลับภาพ+เส้นตัด, ภาพ, เส้นตัด | ui/canvas-view, render/page-render | E2E M4 | ครบ |
| FR-06.2 ซ่อนไม่ลบข้อมูล | canvas-view | E2E M4 | ครบ |
| FR-06.3 เส้นตัดสีแยก, เปิดปิดเส้นช่วยและมาร์คอิสระ | canvas-view, main | E2E M4 | ครบ |
| FR-07.1 PNG 150/300/600 DPI โปร่งใส/ขาว ไม่มีเส้นตัด | app/exporter, export/image-dpi | Unit, AC-10 | ครบ ฝัง pHYs |
| FR-07.2 JPG พื้นขาว, PDF ขนาดจริง | exporter, export/pdf | Unit, AC-10 | ครบ PDF เป็น Raster |
| FR-07.3 Cutline SVG กลุ่ม CUT_LINES, width/height/viewBox ตรงเอกสาร | export/svg-export | Unit, AC-10, AC-11 | ครบ |
| FR-07.4 Combined SVG แยกกลุ่ม | svg-export | Unit, AC-10 | ครบ ARTWORK เป็นภาพทั้งหน้า |
| FR-07.5 Print + Marks | exporter | AC-10 | ครบ |
| FR-07.6 หลายหน้าแยกไฟล์ใน Zip ชื่อสม่ำเสมอ | exporter, export/zip | Unit, E2E M4 | ครบ |
| FR-07.7 ไม่ Re-layout ตอน Export | exporter, page-render | AC-11 | ครบ ใช้เอกสารชุดเดียวทั้งรอบ |
| FR-07.8 Preflight | export/preflight, ui/export-dialog | Unit, E2E M4 | ครบ |
| FR-07.9 มาร์คใน SVG เป็นชั้นอ้างอิง ไม่ใช่เส้นตัด | svg-export | Unit, AC-10 | ครบ |
| FR-10.1 Preset 3 กลุ่ม | core/marks | Unit | ครบ |
| FR-10.2, 10.3 ไม่อ้างว่าใช้กับเครื่องได้, MicroCut Unverified | core/marks, preflight | Unit (เทียบ PDF จาก SignMaster), E2E | ครบ พิกัดตรง SignMaster ยังไม่ได้ทดสอบตัดจริง |
| FR-10.4 Circle, Square, Cross, L | core/marks | Unit | ครบ และเพิ่มสามเหลี่ยมบอกทิศแบบ SignMaster |
| FR-10.5 เพิ่ม ลบ ซ้ำ ย้าย หมุน ขนาด X,Y ล็อก จัดแนว | core/marks, ui/marks-panel, canvas-view | Unit, AC-08 | ครบ |
| FR-10.6 Margin และ Keep-out ของมาร์ค, User Profile | core/marks, app/profiles | Unit, AC-08 | ครบ Profile อยู่ใน localStorage |
| FR-10.7 Keep-out ก่อน Auto Layout | core/marks, layout | Unit, E2E M4 | ครบ |
| FR-10.8 แยก Marks Layer จาก CUT_LINES | svg-export | Unit, AC-10 | ครบ |
| FR-10.9 Machine Profile Data Model | core/marks | Unit | ครบ ยังไม่มีเครื่องอื่นนอกจาก Template |
| NFR-05 Progress, Cancel ตอนส่งออก | ui/export-dialog | E2E M4 | ครบ ยกเลิกระหว่างขั้นตอน |
| NFR-06 แจ้งข้อจำกัดหน่วยความจำ | preflight | Unit | ครบ เตือนเกิน 100 ล้านพิกเซล บล็อกเกินขีดจำกัด Canvas |

## รอ Milestone ถัดไป

- M5: FR-02.3, FR-02.4, FR-11.1, FR-11.2, AC-03, AC-13
