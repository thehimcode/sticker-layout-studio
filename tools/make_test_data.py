#!/usr/bin/env python3
"""สร้างชุดข้อมูลทดสอบ: ภาพรู้ขนาดและ DPI แน่นอน และไฟล์ผิดรูปแบบ (ต้องมี Pillow)"""
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parent.parent / "test-data"
out.mkdir(exist_ok=True)

# วงกลมโปร่งใส 600×600 px @300 DPI = 50.8 × 50.8 มม.
circle = Image.new("RGBA", (600, 600), (0, 0, 0, 0))
ImageDraw.Draw(circle).ellipse((30, 30, 570, 570), fill=(0, 140, 150, 255))
circle.save(out / "circle-50.8mm-300dpi.png", dpi=(300, 300))

# ดาวโปร่งใส 1200×600 px @600 DPI = 50.8 × 25.4 มม.
shape = Image.new("RGBA", (1200, 600), (0, 0, 0, 0))
draw = ImageDraw.Draw(shape)
draw.rounded_rectangle((20, 20, 1180, 580), 120, fill=(230, 120, 30, 255))
draw.polygon([(600, 60), (680, 300), (600, 540), (520, 300)], fill=(255, 255, 255, 255))
shape.save(out / "badge-50.8x25.4mm-600dpi.png", dpi=(600, 600))

# JPEG 1000×500 px @200 DPI = 127 × 63.5 มม.
photo = Image.new("RGB", (1000, 500), (240, 200, 60))
ImageDraw.Draw(photo).rectangle((100, 100, 900, 400), fill=(40, 90, 160))
photo.save(out / "label-127x63.5mm-200dpi.jpg", dpi=(200, 200), quality=90)

# PNG ไม่มี DPI 300×150 px โปรแกรมต้องใช้ 300 DPI = 25.4 × 12.7 มม.
Image.new("RGB", (300, 150), (120, 60, 160)).save(out / "no-dpi-300x150px.png")

# ภาพใหญ่เกิน A4 ต้องถูกย่อ
Image.new("RGB", (4000, 4000), (60, 160, 90)).save(out / "oversized-4000px-72dpi.png", dpi=(72, 72))

# ไฟล์ผิดรูปแบบ
(out / "corrupt.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"not really a png")
(out / "not-an-image.txt.png").write_bytes(b"hello")
(out / "not-yet.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")

# M2: รูปเว้า โปร่งใส 720×720 px @300 DPI = 60.96 มม.
import math
star = Image.new("RGBA", (720, 720), (0, 0, 0, 0))
points = []
for i in range(10):
    r = 330 if i % 2 == 0 else 140
    a = -math.pi / 2 + i * math.pi / 5
    points.append((360 + r * math.cos(a), 360 + r * math.sin(a)))
ImageDraw.Draw(star).polygon(points, fill=(220, 40, 60, 255))
star.save(out / "star-concave-300dpi.png", dpi=(300, 300))

# M2: ภาพพื้นขาวไม่มี Alpha วงรีกลางภาพ
jpg = Image.new("RGB", (800, 600), (255, 255, 255))
ImageDraw.Draw(jpg).ellipse((100, 100, 700, 500), fill=(20, 110, 190))
jpg.save(out / "oval-on-white-300dpi.jpg", dpi=(300, 300), quality=95)

# M2: สองชิ้นแยกกัน โปร่งใส
two = Image.new("RGBA", (900, 400), (0, 0, 0, 0))
d = ImageDraw.Draw(two)
d.ellipse((30, 50, 330, 350), fill=(90, 60, 170, 255))
d.rectangle((570, 80, 870, 320), fill=(30, 150, 110, 255))
two.save(out / "two-parts-300dpi.png", dpi=(300, 300))

# M2: วงแหวนมีรู โปร่งใส
ring = Image.new("RGBA", (600, 600), (0, 0, 0, 0))
d = ImageDraw.Draw(ring)
d.ellipse((30, 30, 570, 570), fill=(200, 120, 20, 255))
d.ellipse((180, 180, 420, 420), fill=(0, 0, 0, 0))
ring.save(out / "ring-hole-300dpi.png", dpi=(300, 300))

# M2: ตัวการ์ตูนความละเอียดต่ำ พื้นขาว มีรอยเว้าและรายละเอียดตามขอบ ใช้ตรวจความโค้งของเส้น
toon = Image.new("RGB", (400, 560), (255, 255, 255))
d = ImageDraw.Draw(toon)
d.ellipse((40, 110, 360, 500), fill=(235, 185, 120), outline=(20, 20, 20), width=8)
d.ellipse((60, 40, 150, 130), fill=(235, 185, 120), outline=(20, 20, 20), width=8)
d.ellipse((250, 40, 340, 130), fill=(235, 185, 120), outline=(20, 20, 20), width=8)
d.rounded_rectangle((270, 380, 340, 548), 30, fill=(235, 185, 120), outline=(20, 20, 20), width=8)
d.rounded_rectangle((70, 400, 140, 548), 30, fill=(235, 185, 120), outline=(20, 20, 20), width=8)
d.polygon([(360, 300), (395, 280), (395, 330)], fill=(200, 60, 60))
toon.save(out / "toon-lowres-133dpi.jpg", dpi=(133, 133), quality=92)
