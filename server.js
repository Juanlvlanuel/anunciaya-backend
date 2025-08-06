require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const connectDB = require("./config/db");
const contenidoLocalRoutes = require("./routes/contenidoLocalRoutes");

const app = express();

// ✅ Habilitar CORS para permitir conexión con frontend
const allowedOrigins = [
  "http://localhost:5173",
  "https://anunciaya-frontend.vercel.app"
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));


// ✅ Middleware para interpretar JSON
app.use(express.json());

// ✅ Conectar a MongoDB
connectDB();

// ✅ Importar rutas de usuarios normales
const usuarioRoutes = require("./routes/usuarioRoutes");
app.use("/api/usuarios", usuarioRoutes);

// ✅ Registrar Administrador Manualmente
const adminRoutes = require("./routes/adminRoutes");
app.use("/api/admin", adminRoutes);

// ✅ Importar y usar rutas de logos
const logosCarouselRoutes = require("./routes/logosCarouselRoutes");
app.use("/api/logos-carousel", logosCarouselRoutes);

// ✅ Importar
const promocionesRoutes = require("./routes/promocionesRoutes");
app.use("/api/promociones", promocionesRoutes);

// ✅ Importar rutas de rifas
const rifasRoutes = require("./routes/rifasRoutes");
app.use("/api/rifas", rifasRoutes);


app.use("/api/contenido/local", contenidoLocalRoutes);

// ✅ Middleware para servir archivos públicos
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
