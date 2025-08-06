import express from "express";
import { loginAdmin } from "../controllers/authAdminController.js";
const router = express.Router();

router.post("/login", loginAdmin);

module.exports = router;

