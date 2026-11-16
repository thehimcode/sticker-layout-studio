/** ข้อผิดพลาดที่ผู้ใช้แก้ได้ ข้อความเป็นภาษาไทยและแสดงบนหน้าจอได้ทันที */
export class UserError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UserError';
    this.code = code;
  }
}
