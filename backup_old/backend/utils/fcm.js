const admin = require("firebase-admin");
const path = require("path");

// Ruta al archivo .json con las credenciales
const serviceAccount = require(path.join(__dirname, "../ema-geoapp-ec4ee88497fd.json"));

// Inicializar Firebase solo una vez
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

/**
 * Envía una notificación push FCM
 * @param {string} token - Token FCM del dispositivo
 * @param {string} titulo - Título de la notificación
 * @param {string} mensaje - Cuerpo de la notificación
 * @param {object} dataExtra - Datos opcionales (key-value)
 */
const enviarNotificacion = async (token, titulo, mensaje, dataExtra = {}) => {
  const payload = {
    notification: {
      title: titulo,
      body: mensaje,
    },
    data: dataExtra, // Opcional: útil para navegar en app
    token: token,
  };

  try {
    const response = await admin.messaging().send(payload);
    console.log("✅ Notificación enviada:", response);
    return response;
  } catch (error) {
    console.error("❌ Error al enviar notificación:", error);
    throw error;
  }
};

module.exports = { enviarNotificacion };
