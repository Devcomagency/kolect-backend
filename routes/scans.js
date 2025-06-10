const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const pool = require('../config/database');
const VisionService = require('../services/visionService');

const router = express.Router();

// Configuration upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Hash simple
function generateHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

// Upload simple local
async function saveFile(file) {
  const fs = require('fs').promises;
  const path = require('path');
  
  const uploadDir = path.join(process.cwd(), 'uploads');
  await fs.mkdir(uploadDir, { recursive: true });
  
  const fileName = `scan_${Date.now()}.jpg`;
  const filePath = path.join(uploadDir, fileName);
  
  await fs.writeFile(filePath, file.buffer);
  return `http://192.168.146.104:3000/uploads/${fileName}`;
}

// Liste initiatives
router.get('/initiatives', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM initiatives WHERE is_active = TRUE ORDER BY name');
    
    res.json({
      initiatives: result.rows.map(init => ({
        id: init.id,
        name: init.name,
        description: init.description,
        color: init.color
      }))
    });
  } catch (error) {
    console.error('Erreur initiatives:', error);
    res.status(500).json({ error: 'Erreur initiatives' });
  }
});

// Test GPT-4
router.get('/test-gpt4', authenticateToken, async (req, res) => {
  try {
    const testResult = await VisionService.testConnection();
    res.json(testResult);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Soumission scan AVEC GPT-4 VISION
router.post('/submit', authenticateToken, upload.single('scan'), async (req, res) => {
  try {
    console.log('📤 Réception scan...');
    
    if (!req.file) {
      return res.status(400).json({ error: 'Image requise' });
    }

    if (!req.body.initiativeId) {
      return res.status(400).json({ error: 'Initiative requise' });
    }

    console.log('📁 Taille fichier:', req.file.size);
    
    // Récupérer le nom de l'initiative
    const initiativeQuery = await pool.query(
      'SELECT name FROM initiatives WHERE id = $1',
      [req.body.initiativeId]
    );
    
    const initiativeName = initiativeQuery.rows[0]?.name || 'Initiative inconnue';
    console.log('🎯 Initiative:', initiativeName);

    // Anti-doublons
    const imageHash = generateHash(req.file.buffer);
    console.log('🔐 Hash généré:', imageHash.substring(0, 10) + '...');
    
    const duplicateCheck = await pool.query(
      'SELECT id, created_at FROM scans WHERE collaborator_id = $1 AND image_hash = $2',
      [req.user.id, imageHash]
    );
    
    if (duplicateCheck.rows.length > 0) {
      console.log('🚫 Doublon détecté!');
      return res.status(409).json({
        error: 'DOUBLON_DETECTE',
        message: 'Cette feuille a déjà été scannée ✋',
        duplicate: {
          id: duplicateCheck.rows[0].id,
          scannedAt: duplicateCheck.rows[0].created_at
        }
      });
    }

    // Sauvegarder fichier
    console.log('💾 Sauvegarde fichier...');
    const imageUrl = await saveFile(req.file);
    
    // 🤖 ANALYSE GPT-4 VISION
    console.log('🤖 Démarrage analyse GPT-4 Vision...');
    
    const analysisResult = await VisionService.analyzeSignatureSheet(
      req.file.buffer,
      initiativeName
    );

    let validSignatures, rejectedSignatures, confidence, notes, analysisMethod;

    if (analysisResult.success) {
      // ✅ Utiliser les résultats GPT-4
      validSignatures = analysisResult.data.validSignatures;
      rejectedSignatures = analysisResult.data.invalidSignatures;
      confidence = analysisResult.data.confidence;
      notes = analysisResult.data.notes;
      analysisMethod = analysisResult.data.analysisMethod;
      
      console.log('✅ GPT-4 Vision - Analyse réussie:');
      console.log(`   📊 ${validSignatures} signatures valides`);
      console.log(`   ❌ ${rejectedSignatures} signatures invalides`);
      console.log(`   🎯 Confiance: ${Math.round(confidence * 100)}%`);
    } else {
      // ⚠️ Fallback vers simulation
      console.log('⚠️ Erreur GPT-4, utilisation du fallback');
      
      validSignatures = analysisResult.fallback.validSignatures;
      rejectedSignatures = analysisResult.fallback.invalidSignatures;
      confidence = analysisResult.fallback.confidence;
      notes = analysisResult.fallback.notes;
      analysisMethod = analysisResult.fallback.analysisMethod;
    }

    // Insérer en base
    const insertQuery = `
      INSERT INTO scans (
        collaborator_id, initiative_id, image_url, image_hash,
        valid_signatures, rejected_signatures, total_signatures, 
        ocr_confidence, status, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9)
      RETURNING *
    `;
    
    const result = await pool.query(insertQuery, [
      req.user.id,
      req.body.initiativeId,
      imageUrl,
      imageHash,
      validSignatures,
      rejectedSignatures,
      validSignatures + rejectedSignatures,
      confidence,
      `${analysisMethod} | ${notes}`
    ]);

    console.log('✅ Scan enregistré avec ID:', result.rows[0].id);

    res.status(201).json({
      success: true,
      message: analysisResult.success ? 
        'Scan analysé par GPT-4 Vision ✅' : 
        'Scan traité (mode dégradé) ⚠️',
      scan: {
        id: result.rows[0].id,
        validSignatures: result.rows[0].valid_signatures,
        rejectedSignatures: result.rows[0].rejected_signatures,
        totalSignatures: result.rows[0].total_signatures,
        confidence: result.rows[0].ocr_confidence,
        analysisMethod: analysisMethod,
        createdAt: result.rows[0].created_at
      },
      gpt4Status: analysisResult.success ? 'success' : 'fallback'
    });

  } catch (error) {
    console.error('❌ Erreur scan complète:', error);
    res.status(500).json({ 
      error: 'Erreur traitement scan',
      details: error.message 
    });
  }
});

module.exports = router;
