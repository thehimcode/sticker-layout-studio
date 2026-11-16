# Software Requirements Specification (SRS)

**Project:** Sticker Layout & Cutline Studio  
**Version:** 1.1 (Consolidated)  
**Document language:** Thai  
**Application type:** Local-first, Client-side Web Application  
**Status:** Baseline for architecture and iterative development  
**Date:** 2026-11-04

---

## 1. ภาพรวมโครงการ

### 1.1 วัตถุประสงค์
สร้างเว็บแอปบนฝั่งผู้ใช้ (Client-side) สำหรับนำเข้าภาพกราฟิกหลายแบบ กำหนดขนาดและจำนวน สร้างเส้นตัดเวกเตอร์อัตโนมัติ จัดเรียงภาพบนกระดาษให้เหมาะกับงานพิมพ์และตัดสติกเกอร์ และส่งออกไฟล์ภาพสำหรับพิมพ์แยกจากไฟล์ SVG สำหรับตัด โดยรักษาระบบพิกัดและขนาดจริงให้ตรงกัน

### 1.2 ขอบเขต
- ใช้งานหลักบน Desktop ผ่านเบราว์เซอร์สมัยใหม่
- ประมวลผลภาพ ตัดขอบ จัดเรียง และส่งออกภายในเครื่องเป็นหลัก ไม่อัปโหลดงานไปเซิร์ฟเวอร์
- รองรับเอกสารหลายหน้าหากชิ้นงานไม่พอในหนึ่งแผ่น
- รองรับงาน Print & Cut รวม Registration Marks และพื้นที่ห้ามวางงาน
- ระบบต้องรายงานข้อจำกัดของรูปแบบไฟล์และความเข้ากันได้ของเครื่องตัดตามจริง

### 1.3 สิ่งที่อยู่นอกขอบเขต (เวอร์ชันแรก)
- การควบคุมเครื่องตัดผ่านไดรเวอร์/USB โดยตรง
- การรับประกันว่ามาร์ค Custom จะอ่านได้กับเครื่องทุกรุ่น
- การรองรับไฟล์ AI ทุกรูปแบบโดยตรง (รองรับเฉพาะที่แปลง/อ่านได้)
- การรับประกันผล Smart Nesting เป็นการจัดเรียงที่ดีที่สุดเชิงคณิตศาสตร์
- การแยกวัตถุจากพื้นหลังทุกชนิดได้แม่นยำ 100% โดยอัตโนมัติ

## 2. หลักการออกแบบ
1. UI ภาษาไทย สะอาด Minimal Modern มีพื้นที่ทำงานกลางจอ รายการไฟล์ซ้าย และคุณสมบัติขวา
2. ระบบพิกัดของเอกสารใช้หน่วยมิลลิเมตร (mm) และมี **Single Source of Truth** สำหรับตำแหน่ง/ขนาด/การหมุน
3. ห้ามสั่งจัดเรียงใหม่ในขั้นตอน Export เพราะไฟล์พิมพ์และไฟล์ตัดต้องตรงกัน
4. แยก **Artwork**, **Cutlines**, **Registration Marks**, **Guides/Keep-out** เป็นชั้นข้อมูลอิสระ
5. เส้นตัดต้องเป็นเวกเตอร์ Path จริง และ Offset ต้องคำนวณตามเรขาคณิต ไม่ใช่ Scale
6. ห้ามวางชิ้นงานเกินขอบที่ใช้ได้ และห้ามเข้าพื้นที่สงวนของ Registration Marks
7. การทำงานที่ใช้เวลานานต้องมีสถานะความคืบหน้าและยกเลิกได้

## 3. คำศัพท์
- **Master Object:** กราฟิกต้นฉบับหนึ่งแบบ ที่อาจถูกทำสำเนาหลายชิ้น
- **Instance:** ชิ้นงานหนึ่งชิ้นที่อ้างอิง Master Object และมี Transformation ของตัวเอง
- **Artwork:** ภาพที่ต้องพิมพ์
- **Cutline:** เส้นเวกเตอร์แบบปิดสำหรับเครื่องตัด
- **Offset:** ระยะขยายออก (+) หรือหดเข้า (-) จากเส้นขอบอ้างอิงเป็นมิลลิเมตร
- **Bleed:** พื้นที่ภาพพิมพ์เผื่อเลยแนวตัด
- **Object Spacing:** ระยะห่างขั้นต่ำระหว่างชิ้นงาน โดยเลือกอ้างอิงภาพหรือเส้นตัด
- **Keep-out Zone:** พื้นที่ห้ามวาง Artwork/Cutline เพื่อรักษาการอ่านมาร์คหรือข้อจำกัดเครื่อง
- **Nesting:** การจัดวางชิ้นงานโดยคำนึงถึงรูปร่างจริงเพื่อประหยัดพื้นที่
- **Registration Marks:** เครื่องหมายอ้างอิงตำแหน่งเพื่อให้เครื่องตัดตรวจจับ/จัดแนว

## 4. Functional Requirements

### FR-01: หน้ากระดาษและระบบพิกัด
**FR-01.1** ค่าเริ่มต้นเป็น A4 แนวตั้ง 210 × 297 mm  
**FR-01.2** รองรับ ISO A0–A6 ได้แก่ A0 841×1189, A1 594×841, A2 420×594, A3 297×420, A4 210×297, A5 148×210, A6 105×148 mm  
**FR-01.3** เพิ่ม A3+ (320×450 mm) และอีก Preset สำหรับ Super A3 / 13×19 นิ้ว (329×483 mm) โดยอธิบายว่าคำว่า A3+ อาจมีขนาดต่างกันตามเครื่องพิมพ์/ผู้ผลิต  
**FR-01.4** รองรับ Custom Paper Width/Height เป็น mm  
**FR-01.5** เปลี่ยน Portrait/Landscape; มี Zoom, Fit to Page, ไม้บรรทัด และเส้น Grid ที่เปิด/ปิดได้  
**FR-01.6** ขนาดและตำแหน่งจริงต้องไม่อิงระดับ Zoom และต้องไม่ถูกปัดค่าจนคลาดเคลื่อนเมื่อ Export

### FR-02: นำเข้ากราฟิก
**FR-02.1** Drag & Drop และ File Picker นำเข้าหลายไฟล์พร้อมกัน  
**FR-02.2** รองรับ PNG (รักษา Alpha Transparency), JPG/JPEG, PDF  
**FR-02.3** PDF หลายหน้าให้เลือกหน้าที่นำเข้า; รูปภาพ/การเรนเดอร์ต้องมีคุณภาพเพียงพอตามขนาดจริง; รักษาเวกเตอร์เมื่อเทคโนโลยีที่ใช้รองรับ มิฉะนั้นแจ้งว่ามีการ Rasterize  
**FR-02.4** รองรับ `.ai` เฉพาะไฟล์ที่อ่านได้อย่างปลอดภัย เช่น PDF-compatible; หากไม่รองรับให้แจ้งชัดและแนะนำแปลงเป็น PDF หรือ SVG  
**FR-02.5** แสดงชื่อ, ประเภท, ขนาดพิกเซล (ถ้ามี), ขนาดจริง/ที่กำหนด, DPI ประเมิน ณ ขนาดพิมพ์  
**FR-02.6** ไม่จำกัดจำนวนแบบในตรรกะ แต่ต้องจัดการการใช้หน่วยความจำและแจ้งเมื่อทรัพยากรไม่พอ  
**FR-02.7** ป้องกันไฟล์เสีย/ไฟล์อันตราย, จัดการ error โดยไม่ทำให้โปรเจกต์เสียหาย

### FR-03: วัตถุและจำนวนสำเนา
**FR-03.1** มี Master Object ต่อกราฟิกหนึ่งแบบ และกำหนดจำนวน Instance เป็นเลขจำนวนเต็ม ≥ 0  
**FR-03.2** ใช้ปุ่ม + / − และช่องกรอกตัวเลข เปลี่ยนจำนวนได้  
**FR-03.3** แก้ไขขนาด Width/Height mm โดยมี Lock Aspect Ratio, หมุน, เคลื่อนย้าย และจัดลำดับได้  
**FR-03.4** แต่ละแบบเก็บค่า Contour, Offset, Bleed, Spacing ที่เกี่ยวข้อง โดย Instance ใช้ข้อมูลร่วมกันได้  
**FR-03.5** รองรับเลือกหลายชิ้น, Duplicate, Delete, Align และ Undo/Redo  
**FR-03.6** เมื่อลดจำนวนต้องจัดการ Instance ที่ถูกลบอย่างคาดเดาได้และสามารถ Undo ได้

### FR-04: เครื่องมือสร้างเส้นตัดเวกเตอร์
**FR-04.1** PNG โปร่งใสให้ตรวจ Contour จาก Alpha Channel (Threshold ปรับได้)  
**FR-04.2** JPG/ภาพพื้นหลังทึบ ให้มีการเลือกสีพื้นหลัง/Threshold หรือวิธี Mask เพื่อช่วยแยกวัตถุ และมี Preview ตรวจสอบ  
**FR-04.3** รองรับเลือกเส้นขอบรอบนอกสุด (Outer Silhouette), รวมชิ้นส่วนที่แยกกันเป็นเส้นเดียวเมื่อเลือกโหมดดังกล่าว, และเลือกให้มีหลาย Contour ตามที่ภาพเหมาะสม  
**FR-04.4** ลด Noise, Smooth, Simplify และแปลงเป็น SVG Path ปิด โดยรักษารายละเอียดสำคัญ  
**FR-04.5** Offset บวก/ลบเป็น mm (ค่าเริ่มต้น +2 mm) และแสดง Preview สี Magenta; Offset ต้องคำนวณจาก Geometry ของ Contour ไม่ใช่ Scale  
**FR-04.6** รองรับรีเซ็ต/สร้างใหม่/ปรับ Threshold/ตรวจปัญหาเส้นตัดซ้อนตัวเองและ Path ที่ใช้ตัดไม่ได้  
**FR-04.7** มีเครื่องมือแก้ไข Contour ขั้นพื้นฐานเมื่อระบบอัตโนมัติผิดพลาด; แจ้งเตือนเมื่อรูปทรง/คุณภาพภาพทำให้ผลไม่แน่นอน  
**FR-04.8** อัลกอริทึมต้องแปลงพิกัดจากพิกเซลไป mm ตามขนาดงานจริงอย่างถูกต้อง และรองรับแก้ขนาดแล้วคำนวณผลใหม่

### FR-05: Auto Layout / Nesting
**FR-05.1** Standard Layout: เรียงจากซ้ายไปขวา/บนลงล่างตามแถวและคอลัมน์ หรือขั้นตอนที่คาดเดาได้; เลือกลำดับรายการ/ขนาด และกำหนดระยะห่าง  
**FR-05.2** Smart Nesting: ใช้ Polygon Shape ของภาพ/เส้นตัดจริง, ทดลองหมุนมุมที่ผู้ใช้กำหนด (เช่น step 15°/30°), ลดพื้นที่ว่างโดยประมาณ  
**FR-05.3** จัดเรียงเฉพาะในพื้นที่ที่อนุญาตหลัง Margin และ Keep-out Zone; ห้ามขอบภาพ, Bleed, Cutline ที่เกี่ยวข้องทับซ้อนพื้นที่ที่ห้ามวาง  
**FR-05.4** ระหว่างชิ้นงานทุกคู่ต้องมีช่องว่างขั้นต่ำตาม FR-09; เมื่อใช้เส้นตัดให้คิดจากรูปทรง Cutline ที่ Offset แล้ว  
**FR-05.5** รองรับงานหลายหน้าและแจ้งจำนวนชิ้นที่วางได้, จำนวนที่ยังวางไม่ได้, พื้นที่ใช้/พื้นที่ว่าง  
**FR-05.6** ห้ามปรับขนาดชิ้นงานอัตโนมัติเพื่อยัดลงหน้าโดยไม่ได้รับอนุญาต  
**FR-05.7** มีสถานะกำลังประมวลผล/ปุ่ม Cancel และสามารถสั่งคำนวณใหม่ได้  
**FR-05.8** ไม่ต้องรับประกัน Global Optimum แต่ต้องส่งผลที่ไม่ละเมิดเงื่อนไขและรายงานเมื่อไม่สามารถวางครบ

### FR-06: โหมดการแสดงผล
**FR-06.1** สลับ Artwork + Cutlines, Artwork Only, Cutlines Only  
**FR-06.2** การซ่อน Layer เป็นแค่การแสดงผล ไม่ลบข้อมูล  
**FR-06.3** เส้นตัดสี Preview แยกจากภาพชัดเจน และเปิด/ปิด Guides/Marks ได้อิสระ

### FR-07: ส่งออกไฟล์
**FR-07.1** ส่งออก PNG สำหรับพิมพ์ โดยไม่มี Cutlines; เลือก 150/300/600 DPI และพื้นหลังโปร่งใส/ขาวตามชนิดไฟล์  
**FR-07.2** ส่งออก JPG สำหรับภาพพิมพ์โดยไม่มี Cutlines พื้นหลังสีขาว และ PDF ตามขนาดหน้าจริง (mm)  
**FR-07.3** ส่งออก Cutline Only SVG เป็น Path เวกเตอร์จริงในกลุ่ม `CUT_LINES` โดย `width`, `height`, `viewBox` และพิกัดตรงกับเอกสาร  
**FR-07.4** ส่งออก Combined SVG (ARTWORK / CUT_LINES / REG_MARKS เป็นคนละกลุ่ม) โดยไม่บังคับให้เครื่องตัดตีความ Artwork เป็นเส้นตัด  
**FR-07.5** ส่งออก Print + Marks (Artwork และ Registration Marks เท่านั้น)  
**FR-07.6** เมื่อหลายหน้า ให้แยกไฟล์ตามเลขหน้า/บรรจุใน Zip พร้อมชื่อสม่ำเสมอ และอ้างอิงตำแหน่งเดียวกันต่อหน้า  
**FR-07.7** ห้าม Re-layout ระหว่าง Export; ต้องใช้ Geometry/Transform ที่ผ่านการยืนยันใน Editor  
**FR-07.8** มี Preflight Check ขนาดจริง, Margins, Overlap, Spacing, Keep-out, DPI และ Marks ก่อน Export  
**FR-07.9** ให้เลือกส่งออก Marks ใน SVG เป็นเพียง Reference Layer ที่ระบุชัดว่า **ไม่ใช่เส้นตัด** เพื่อป้องกันเครื่องสั่งตัดมาร์คโดยไม่ตั้งใจ

### FR-08: Page Margins แยก 4 ด้าน
**FR-08.1** ตั้งค่า Top, Right, Bottom, Left แยกอิสระ หน่วย mm ค่าเริ่มต้น 5 mm ต่อด้าน  
**FR-08.2** มีตัวเลือก Link Margins (ตั้งเท่ากันทั้งสี่ด้าน)  
**FR-08.3** ขอบเขตวางงาน = พื้นที่กระดาษหัก Margins และพื้นที่ Keep-out โดยชิ้นงานที่รวม Artwork/Bleed/Cutline ต้องอยู่ภายในทั้งหมด  
**FR-08.4** ลากชิ้นงานข้ามขอบเขตไม่ได้; ใช้ Clamp หรือ Reject พร้อม Feedback  
**FR-08.5** เปลี่ยนกระดาษ/Margins แล้วตรวจสอบทุก Instance และแจ้งชิ้นที่ไม่ถูกต้อง โดยไม่ Scale อัตโนมัติ  
**FR-08.6** ป้องกันการตั้งค่าที่ทำให้ขนาดพื้นที่ใช้งานติดลบหรือเป็นศูนย์โดยไม่แจ้งเตือน

### FR-09: ระยะห่างระหว่างชิ้นงาน
**FR-09.1** ตั้งระยะห่างขั้นต่ำเป็น mm (ค่าควรกรอกได้อิสระ ค่าเริ่มต้นเสนอ 3 mm)  
**FR-09.2** เลือก `Image Spacing` วัดจากขอบ Artwork หรือ `Cutline Spacing` วัดจาก Contour หลัง Offset  
**FR-09.3** ถ้าเปิดใช้งาน Cutlines ให้โหมด Cutline Spacing เป็นค่าเริ่มต้น  
**FR-09.4** ใน Smart Nesting วัดระยะห่างของ Polygon จริง ไม่ใช่แค่ Bounding Box  
**FR-09.5** ตรวจเงื่อนไขระยะห่างทั้งตอน Auto Layout และ Manual Editing; งานที่ละเมิดต้องถูกป้องกันหรือแจ้งชัด  
**FR-09.6** คำนึงถึง Bleed และ Artwork เมื่อเป็นขอบนอกที่มีผลต่อการพิมพ์ โดยใช้ Envelope ที่เกี่ยวข้องที่กว้างที่สุดสำหรับการป้องกันการซ้อนทับ

### FR-10: Registration Marks และ Machine Profiles
**FR-10.1** มี Preset 3 กลุ่ม: (a) MicroCut 30Q-style 5 Round Dots, (b) Circular Marks แบบ 3/4 จุด, (c) Corner/L-Shaped Marks  
**FR-10.2** Preset หมายถึง Template ที่ปรับแต่งได้; ห้ามอ้างว่าเป็น Machine-Compatible โดยยังไม่ได้ตรวจจากเอกสารผู้ผลิตหรือทดสอบกับเครื่องจริง  
**FR-10.3** MicroCut 30Q: ต้องรองรับมาร์ควงกลมดำ 5 จุด แต่ **ขนาดและพิกัดจริงยังต้องยืนยันจากคู่มือ ตัวอย่างไฟล์ หรือทดสอบกับเครื่อง** ไม่กำหนดค่ามาตรฐานแบบเดาสุ่ม  
**FR-10.4** Custom Mark Objects รองรับ Circle, Square, Plus/Cross, L/Corner Symbol; กำหนด Fill/Stroke เท่าที่เหมาะสม  
**FR-10.5** เพิ่ม/ลบ/ซ้ำ/ย้าย/หมุน/ปรับขนาด/กำหนด X,Y เป็น mm/ล็อกตำแหน่ง/จัดแนวได้  
**FR-10.6** กำหนด Margin ของมาร์คเองและ Keep-out Zone รวมทั้งบันทึกเป็น User Profile  
**FR-10.7** เมื่อเปิด Registration Marks ต้องจัดสรร Keep-out ก่อน Auto Layout และห้ามชิ้นงานชนกับเขตดังกล่าว  
**FR-10.8** แยก Marks Layer จาก CUT_LINES และกำหนดการส่งออก Print + Marks vs Cut SVG อย่างชัดเจน  
**FR-10.9** ออกแบบ Machine Profile Data Model ให้เพิ่มเครื่องรุ่นอื่นได้ในอนาคต เช่น ขนาดจุด, ตำแหน่ง, ลำดับ, ทิศทาง, ข้อจำกัดหน้า และตัวเลือก Export

### FR-11: การจัดการโปรเจกต์
**FR-11.1** Save/Load Project ภายในเครื่องพร้อมไฟล์ต้นฉบับหรือข้อมูลอ้างอิงที่ไม่ทำให้ลิงก์ขาด  
**FR-11.2** โครงการเก็บ Paper/Margins/Masters/Instances/Cutlines/Transforms/Nesting/Marks/Profiles และค่าการส่งออก  
**FR-11.3** สนับสนุน IndexedDB หรือดาวน์โหลด Project File แล้วนำกลับมาเปิดใหม่; แจ้งถ้าระบบไม่สามารถเก็บข้อมูลขนาดใหญ่  
**FR-11.4** ควรเตือนก่อนปิดหรือเปลี่ยนโปรเจกต์ขณะมีการแก้ไขที่ยังไม่บันทึก

## 5. Data Model ขั้นต่ำ
- `Project`: id, version, paper, pages, masters, instances, marks, settings
- `Paper`: widthMm, heightMm, orientation, marginsMm{top,right,bottom,left}
- `MasterObject`: id, name, originalAsset, sourceType, naturalSize, desiredSizeMm, alphaMask/contours, cutlineConfig, bleedMm, quantity
- `Instance`: id, masterId, pageId, transform{xMm,yMm,rotationDeg,scaleX,scaleY}, placementStatus
- `Cutline`: sourceMasterId, closedPaths, offsetMm, contourParameters, geometryVersion
- `RegistrationMark`: id, shape, widthMm, heightMm, xMm, yMm, rotationDeg, fill/stroke, locked, keepoutMm
- `MachineProfile`: id, label, markDefinitions, coordinateConvention, keepoutRules, verificationStatus
- `ExportSettings`: dpi, outputTypes, includeMarks, background, multiPageNaming

**ข้อกำหนดข้อมูล:** ต้องระบุว่าพิกัดแต่ละ Object อ้างอิงจุดใด (เช่น Top-left) และ Transformation ลำดับใด เพื่อป้องกันไฟล์พิมพ์/ตัดเคลื่อน

## 6. Non-Functional Requirements
- **NFR-01:** UI ทั้งหมดภาษาไทย; ออกแบบสำหรับ Desktop และรองรับจอขนาดแตกต่างกัน
- **NFR-02:** ไม่ส่งไฟล์ขึ้นเซิร์ฟเวอร์โดยไม่มีการยินยอม; หากใช้ CDN ต้องแจ้งความจำเป็นในการเชื่อมต่ออินเทอร์เน็ต หรือมีแนวทาง Bundle Offline
- **NFR-03:** Browser อย่างน้อย Chrome/Edge รุ่นปัจจุบัน; Firefox ตามความสามารถ Library
- **NFR-04:** งาน Contour/Nesting ทำใน Web Worker เมื่อเหมาะสม เพื่อไม่ล็อก UI
- **NFR-05:** มีสถานะ Progress, Error และ Cancel สำหรับงานใช้เวลานาน
- **NFR-06:** ความละเอียดส่งออกขึ้นกับ DPI ที่เลือก และต้องแจ้งข้อจำกัดหน่วยความจำของไฟล์ใหญ่ เช่น A0 600 DPI
- **NFR-07:** Geometry ของ Print/Export ต้องสอดคล้องในหน่วย mm; กำหนดค่าความคลาดเคลื่อนเป้าหมายเชิงคำนวณ ≤0.1 mm ในการทดสอบเวกเตอร์ โดยการพิมพ์/เครื่องตัดจริงขึ้นอยู่กับฮาร์ดแวร์และ Calibration
- **NFR-08:** มี Undo/Redo และจัดการ Resource Cleanup (Object URLs, Canvas, Worker)
- **NFR-09:** บันทึกความล้มเหลวแบบอ่านเข้าใจได้ ไม่ให้ผลลัพธ์เทียมว่าเสร็จสมบูรณ์

## 7. แนวทางเทคโนโลยี (ไม่บังคับตายตัว)
- UI: HTML/CSS/JavaScript, component framework หากจำเป็น
- Editor: Konva.js หรือ Fabric.js
- PDF import: PDF.js
- Contour/mask: Canvas ImageData / OpenCV.js
- Cutline: contour tracing → polygon/path simplification → SVG generation
- Robust Offset: Clipper2 / geometry library ที่เชื่อถือได้ (อาจใช้ WASM)
- Smart Nesting: polygon-based placement, rotation search, collision detection, Web Worker
- Export: Canvas PNG/JPG, PDF library, SVG serialization
- Storage: IndexedDB + Portable Project Format

**หมายเหตุ:** AI Developer ต้องเสนอเหตุผลเลือก Library, License, ความเข้ากันได้, ขนาด Bundle และความสามารถทำงาน Offline ก่อนล็อก Architecture

## 8. ลำดับการทำงานของผู้ใช้
1. เปิดโปรแกรม → A4 แนวตั้ง
2. เลือกขนาดกระดาษและตั้ง Margin ทั้ง 4 ด้าน
3. เลือก Machine Profile/Registration Marks หากต้องใช้
4. ลากภาพเข้ามาหลายแบบและกำหนดขนาดกับจำนวน
5. สร้าง Cutlines และปรับ Offset; ตั้ง Bleed ตามงานพิมพ์
6. กำหนด Spacing โดยเลือกวัดจาก Artwork หรือ Cutline
7. เลือก Standard Layout / Smart Nesting และตรวจผล
8. Preview แยก Artwork, Cutlines, Marks; ตรวจ Preflight
9. ส่งออก Print Artwork (+ Marks ถ้าต้องใช้) และ Cutline SVG ให้ตำแหน่งตรงกัน
10. บันทึก Project เพื่อแก้ไขภายหลัง

## 9. Acceptance Criteria / Test Scenarios
**AC-01 Paper:** เปิดโปรแกรมแล้วเป็น A4 210×297 mm; เปลี่ยน A3+ 320×450 และ Custom ได้  
**AC-02 Margins:** ตั้ง Top 10, Right 15, Bottom 20, Left 5 mm แล้วลากวัตถุข้ามพื้นที่อนุญาตไม่ได้  
**AC-03 Import:** นำเข้า PNG โปร่งใส, JPG และ PDF หลายหน้าได้ตามข้อจำกัดที่ประกาศ; AI ไม่รองรับต้องแจ้งและไม่ทำโปรแกรมค้าง  
**AC-04 Quantity:** เพิ่มภาพ A เป็น 12 ชิ้นและ B เป็น 8 ชิ้น; จำนวนแสดงและ Export ตรงกัน  
**AC-05 Contour:** PNG ที่มีรูปร่างเว้าโค้งต้องสร้าง Path ติดตามรูปทรง ไม่ใช่สี่เหลี่ยมครอบ  
**AC-06 Offset:** เมื่อกำหนด +2 mm Cutline ต้องอยู่ห่าง Contour ตามระยะเรขาคณิตที่กำหนดโดยทดสอบกับรูปทรงมาตรฐาน (เช่น Circle/Square)  
**AC-07 Spacing:** Cutline Spacing 3 mm แล้วจัดเรียง 10 ชิ้น โดยเส้นตัดทุกคู่ไม่เข้าใกล้กันน้อยกว่า 3 mm  
**AC-08 Marks:** สร้างชุดวงกลม 5 จุดแบบกำหนดพิกัดเองได้; เปลี่ยนขนาด ย้าย ล็อก และบันทึก Profile ได้  
**AC-09 Keep-out:** Auto Layout และ Manual Drag ไม่ให้ Artwork/Cutline/Bleed ทับ Keep-out Zone  
**AC-10 Export:** Print PNG ไม่มี Cutlines, Print+Marks มี Marks, Cutline SVG มี Path จริง และไม่สั่งตัดมาร์ค  
**AC-11 Alignment:** ตรวจตำแหน่งและขนาดของ SVG เทียบ Artwork บนพิกัดเอกสารเดียวกันได้ตาม NFR-07  
**AC-12 Multi-page:** ชิ้นงานเกินหนึ่งหน้าแล้วเพิ่มหน้าโดยไม่สูญเสียจำนวนหรือสเกล  
**AC-13 Save:** บันทึก Project แล้วเปิดใหม่ได้พร้อมตำแหน่ง เส้นตัด และมาร์คครบ  
**AC-14 Error:** ภาพไม่มี Alpha/พื้นหลังซับซ้อนต้องมีวิธีปรับ Mask หรือแจ้งผลไม่แน่นอน ไม่อ้างว่าแม่นยำ 100%

## 10. แผนพัฒนาเป็น Milestones
1. **M1 Workspace & Object Editor:** Paper, Margins, PNG/JPG, Object Quantity, Manual Editing, Zoom, Undo/Redo
2. **M2 Cutline Engine:** Mask/Contour, SVG Path, Offset, Preview, Basic Editing, Geometry Tests
3. **M3 Layout & Nesting:** Standard Layout, Spacing, Keep-out, Multi-page, Polygon Nesting
4. **M4 Marks & Export:** 3 Templates, Custom Marks, Machine Profiles, Print/Mark/Vector Export, Preflight
5. **M5 Advanced Formats & QA:** PDF/AI compatible import, Save Project, Performance, Print/Cut Production Testing

**Definition of Done ต่อ Milestone:** มีโค้ดใช้งานจริง, ทดสอบส่วนที่เกี่ยวข้อง, บันทึกปัญหาที่ทราบ, README วิธีรัน และไม่มีฟังก์ชัน Mock ที่อ้างว่าเสร็จ

## 11. ประเด็นที่ต้องยืนยันก่อนการผลิตกับ MicroCut 30Q
1. ขนาดจริงของจุดกลมทั้ง 5 จุด
2. รูปแบบตำแหน่งและลำดับการอ่านจุด
3. ระยะขั้นต่ำจากขอบกระดาษและช่วงความยาว/กว้างที่เครื่องอ่านได้
4. รูปแบบสั่งงาน/ซอฟต์แวร์ที่ใช้อ่านไฟล์เส้นตัด
5. มาร์คจำเป็นต้องอยู่ในไฟล์ Cut หรือเฉพาะ Print และวิธีส่งข้อมูลพิกัดเข้าซอฟต์แวร์เครื่อง

จนกว่าจะยืนยันครบ ให้ตั้งชื่อ Profile ว่า **MicroCut 30Q - Custom 5 Dots (Unverified)** และอนุญาตให้ผู้ใช้กำหนดค่าจริงด้วยตนเอง **ห้ามอ้างว่าเป็น Preset มาตรฐานที่ใช้งานได้ทันที**

## 12. คำสั่งสำหรับ AI Developer
1. อ่าน SRS ทั้งฉบับและทำ Requirement Traceability Map (Requirement → Module → Test)
2. เสนอ Architecture, Libraries, Data Model และแนวทางรักษาพิกัด mm ก่อนเขียนโค้ด
3. แบ่งงานตาม Milestones และเริ่ม M1 ก่อน
4. เมื่อจบแต่ละ Milestone ให้รายงานสิ่งที่ทำได้, วิธีทดสอบ, ข้อจำกัด และงานค้างอย่างตรงไปตรงมา
5. ห้ามแทน Contour Offset ด้วย Scale, Polygon Nesting ด้วย Bounding Box เพียงอย่างเดียว หรือส่งออกภาพกับเส้นตัดโดยคำนวณตำแหน่งคนละรอบ
6. หาก SRS ยังไม่ชัด ให้กำหนดสมมติฐานที่สมเหตุสมผลและระบุไว้ โดยเฉพาะคุณลักษณะเฉพาะของเครื่องตัด

---
**End of SRS v1.1**
