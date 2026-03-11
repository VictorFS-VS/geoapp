// middlewares/uploadPoi.js
const multer = require('multer');
const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { id_proyecto, id_tramo } = req.body;
    if (!id_proyecto || !id_tramo) {
      return cb(new Error('id_proyecto e id_tramo son requeridos'), null);
    }
    const dest = path.join(
      __dirname, '..', 'uploads', 'poi',
      `proyecto_${id_proyecto}`, `tramo_${id_tramo}`
    );
    ensureDir(dest);
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_\-]+/gi, '_');
    cb(null, `${base}_${Date.now()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) return cb(null, true);
  cb(new Error('Formato no permitido. Use PNG, JPG/JPEG o WEBP'));
};

const uploadPoi = multer({
  storage,
  fileFilter,
  limits: { fileSize: 6 * 1024 * 1024 } // 6 MB
});

// ⬅️ IMPORTANTE: exporta la INSTANCIA, NO llames .single aquí
module.exports = uploadPoi;
