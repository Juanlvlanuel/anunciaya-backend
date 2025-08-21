// routes/geoRoutes.js
const express = require("express");
const { verifyCity, reverseCity } = require("../controllers/geoController");

const router = express.Router();

router.get("/verify-city", verifyCity);   // ?q=nombre[&country=mx]
router.get("/reverse", reverseCity);      // ?lat=..&lon=..

module.exports = router;
