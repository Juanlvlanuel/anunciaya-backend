// routes/geoRoutes-1.js
const express = require("express");
const { verifyCity, reverseCity, autocomplete } = require("../controllers/geoController");

const router = express.Router();

router.get("/verify-city", verifyCity);   // ?q=nombre[&country=mx]
router.get("/reverse", reverseCity);      // ?lat=..&lon=..
router.get("/autocomplete", autocomplete);// ?q=pa&country=mx

module.exports = router;
