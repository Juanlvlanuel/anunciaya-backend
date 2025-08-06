require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const connectDB = require("./config/db");
const contenidoLocalRoutes = require("./routes/contenidoLocalRoutes");

const app = express();

// ✅ CORS robusto para producción y desarrollo
const allowedOrigins = [
  "http://localhost:5173",
  "https://anunciaya-frontend.vercel.app"
];

app.use(cors({
  origin: function (origin, callback) {
    // Permite peticiones sin origen (como postman o curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS no permitido por este origen: " + origin));
  },
  credentials: true,
  optionsSuccessStatus: 200,
}));

// ✅ Middleware para interpretar JSON
app.use(express.json());

// ✅ Conectar a MongoDB
connectDB();

// ✅ Importar rutas
const usuarioRoutes = require("./routes/usuarioRoutes");
app.use("/api/usuarios", usuarioRoutes);

const adminRoutes = require("./routes/adminRoutes");
app.use("/api/admin", adminRoutes);

const logosCarouselRoutes = require("./routes/logosCarouselRoutes");
app.use("/api/logos-carousel", logosCarouselRoutes);

const promocionesRoutes = require("./routes/promocionesRoutes");
app.use("/api/promociones", promocionesRoutes);

const rifasRoutes = require("./routes/rifasRoutes");
app.use("/api/rifas", rifasRoutes);

app.use("/api/contenido/local", contenidoLocalRoutes);

// ✅ Servir archivos públicos
app.use("/uploads", express.static(path.join(__dirname, "uploads", "carousel-logos")));

// ✅ Ruta de prueba
app.get("/", (req, res) => {
  res.send("✅ Servidor y base de datos funcionando correctamente.");
});

// ✅ Puerto
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
