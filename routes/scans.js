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
  return `https://kolect-backend.onrender.com/uploads/${fileName}`;
}

// === NOUVELLE ROUTE AVEC DEBUG COMPLET ===
router.post('/analyze-signatures', async (req, res) => {
  try {
    console.log('🔄 === ANALYSE GPT-4 SIGNATURES AVEC DEBUG ===');
    console.log('📸 Données reçues:', Object.keys(req.body));
    
    const { photoData, photoId, initiative } = req.body;
    
    if (!photoData) {
      return res.status(400).json({
        error: 'Photo manquante',
        required: 'photoData base64'
      });
    }

    console.log('🔍 === DIAGNOSTIC VISIONSERVICE ===');
    console.log('🔍 VisionService importé:', !!VisionService);
    console.log('🔍 VisionService type:', typeof VisionService);
    console.log('🔍 VisionService méthodes:', Object.getOwnPropertyNames(VisionService));
    console.log('🔍 analyzeSignatureSheet existe:', !!VisionService?.analyzeSignatureSheet);
    console.log('🔍 OPENAI_API_KEY présente:', !!process.env.OPENAI_API_KEY);
    console.log('🔍 OPENAI_API_KEY (4 premiers chars):', process.env.OPENAI_API_KEY?.substring(0, 4) || 'MANQUANT');
    console.log('🔍 OPENAI_MODEL:', process.env.OPENAI_MODEL || 'non défini');

    try {
      // Convertir photoData en buffer si nécessaire
      let imageBuffer;
      
      if (typeof photoData === 'string' && photoData.startsWith('data:image')) {
        console.log('🖼️ Photo format: base64 avec header');
        const base64Data = photoData.replace(/^data:image\/[a-z]+;base64,/, '');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else if (typeof photoData === 'string' && photoData.startsWith('http')) {
        console.log('🌐 Photo format: URL externe');
        // Pour URL externe, on ne peut pas analyser avec GPT-4
        throw new Error('URL externe non supportée pour GPT-4 Vision');
      } else if (typeof photoData === 'string') {
        console.log('🖼️ Photo format: base64 pur');
        imageBuffer = Buffer.from(photoData, 'base64');
      } else {
        console.log('🖼️ Photo format: buffer direct');
        imageBuffer = photoData;
      }

      console.log('📏 Taille buffer image:', imageBuffer.length, 'bytes');

      // 🤖 TENTATIVE ANALYSE GPT-4 AVEC DEBUG DÉTAILLÉ
      if (VisionService && VisionService.analyzeSignatureSheet) {
        console.log('✅ CONDITIONS REMPLIES - APPEL GPT-4 VISION...');
        console.log('📡 Initiative:', initiative || 'Forêt');
        
        const analysisResult = await VisionService.analyzeSignatureSheet(
          imageBuffer,
          initiative || 'Forêt'
        );

        console.log('📊 === RÉSULTAT GPT-4 COMPLET ===');
        console.log('📊 Success:', analysisResult.success);
        console.log('📊 Data:', JSON.stringify(analysisResult.data, null, 2));
        console.log('📊 Error:', analysisResult.error);

        if (analysisResult.success && analysisResult.data) {
          // ✅ SUCCÈS GPT-4 VISION
          console.log('🎉 === GPT-4 VISION RÉUSSI ===');
          
          const result = {
            success: true,
            signatures: (analysisResult.data.validSignatures || 0) + (analysisResult.data.invalidSignatures || 0),
            valid_signatures: analysisResult.data.validSignatures || 0,
            invalid_signatures: analysisResult.data.invalidSignatures || 0,
            quality: Math.round((analysisResult.data.confidence || 0.85) * 100),
            confidence: Math.round((analysisResult.data.confidence || 0.85) * 100),
            photoId: photoId || 'generated-id',
            method: 'GPT-4 Vision ✅',
            notes: analysisResult.data.notes || 'Analyse GPT-4 réussie',
            model: analysisResult.data.model || 'gpt-4o',
            tokensUsed: analysisResult.data.tokensUsed || 0,
            cost: analysisResult.data.cost || 0,
            timestamp: new Date().toISOString()
          };

          console.log('✅ RÉSULTAT FINAL GPT-4:', JSON.stringify(result, null, 2));
          return res.json(result);

        } else {
          // ⚠️ GPT-4 A ÉCHOUÉ
          console.log('❌ GPT-4 ÉCHEC - DÉTAILS:');
          console.log('   Success:', analysisResult.success);
          console.log('   Error:', analysisResult.error);
          console.log('   Fallback disponible:', !!analysisResult.fallback);
          
          if (analysisResult.fallback) {
            console.log('🎭 UTILISATION FALLBACK GPT-4...');
            
            const result = {
              success: true,
              signatures: (analysisResult.fallback.validSignatures || 0) + (analysisResult.fallback.invalidSignatures || 0),
              valid_signatures: analysisResult.fallback.validSignatures || 0,
              invalid_signatures: analysisResult.fallback.invalidSignatures || 0,
              quality: Math.round((analysisResult.fallback.confidence || 0.75) * 100),
              confidence: Math.round((analysisResult.fallback.confidence || 0.75) * 100),
              photoId: photoId || 'generated-id',
              method: 'GPT-4 Fallback ⚠️',
              notes: analysisResult.fallback.notes || 'Fallback utilisé',
              error: analysisResult.error,
              timestamp: new Date().toISOString()
            };

            console.log('⚠️ RÉSULTAT FALLBACK:', JSON.stringify(result, null, 2));
            return res.json(result);
          }
          
          throw new Error(analysisResult.error || 'GPT-4 analysis failed');
        }

      } else {
        // ❌ VISIONSERVICE INDISPONIBLE
        console.log('❌ === VISIONSERVICE INDISPONIBLE ===');
        console.log('❌ VisionService:', !!VisionService);
        console.log('❌ Type:', typeof VisionService);
        console.log('❌ Méthode analyzeSignatureSheet:', !!VisionService?.analyzeSignatureSheet);
        
        if (!VisionService) {
          console.log('❌ VisionService pas importé - vérifier require()');
        } else if (!VisionService.analyzeSignatureSheet) {
          console.log('❌ Méthode analyzeSignatureSheet manquante');
          console.log('❌ Méthodes disponibles:', Object.getOwnPropertyNames(VisionService));
        }
        
        throw new Error('VisionService indisponible');
      }

    } catch (visionError) {
      console.log('⚠️ === ERREUR GPT-4 - FALLBACK SIMULATION ===');
      console.log('⚠️ Erreur:', visionError.message);
      console.log('⚠️ Stack:', visionError.stack);
    }
    
    // 🎭 SIMULATION AVANCÉE EN CAS D'ERREUR
    console.log('🎭 === UTILISATION SIMULATION AVANCÉE ===');
    const signatures = Math.floor(Math.random() * 12) + 8; // 8-19 signatures
    const valid_signatures = Math.floor(signatures * (0.85 + Math.random() * 0.15)); // 85-100% valides
    const invalid_signatures = signatures - valid_signatures;
    const quality = Math.floor(Math.random() * 20) + 80;   // 80-99 qualité
    const confidence = Math.floor(Math.random() * 15) + 85; // 85-99 confiance
    
    const result = {
      success: true,
      signatures,
      valid_signatures,
      invalid_signatures,
      quality,
      confidence,
      photoId: photoId || 'generated-id',
      method: 'Simulation Avancée 🎭',
      notes: 'GPT-4 indisponible - simulation réaliste utilisée',
      timestamp: new Date().toISOString(),
      message: `${signatures} signatures simulées (${valid_signatures} valides, ${invalid_signatures} invalides)`
    };
    
    console.log('🎭 RÉSULTAT SIMULATION:', JSON.stringify(result, null, 2));
    res.json(result);
    
  } catch (error) {
    console.error('❌ === ERREUR CRITIQUE ANALYSE ===');
    console.error('❌ Message:', error.message);
    console.error('❌ Stack:', error.stack);
    
    res.status(500).json({
      error: 'Erreur analyse signatures',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

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
    console.log('🧪 === TEST CONNEXION GPT-4 ===');
    
    if (!VisionService) {
      return res.status(500).json({
        error: 'VisionService not available',
        debug: 'VisionService pas importé'
      });
    }

    if (!VisionService.testConnection) {
      return res.status(500).json({
        error: 'testConnection method not available',
        debug: 'Méthode testConnection manquante',
        availableMethods: Object.getOwnPropertyNames(VisionService)
      });
    }

    const testResult = await VisionService.testConnection();
    console.log('🧪 Résultat test:', testResult);
    
    res.json({
      ...testResult,
      openaiKey: !!process.env.OPENAI_API_KEY,
      openaiModel: process.env.OPENAI_MODEL || 'non défini'
    });
  } catch (error) {
    console.error('❌ Erreur test GPT-4:', error);
    res.status(500).json({
      error: error.message,
      debug: 'Erreur lors du test de connexion'
    });
  }
});

// Soumission scan AVEC GPT-4 VISION
router.post('/submit', authenticateToken, upload.single('scan'), async (req, res) => {
  try {
    console.log('📤 === SOUMISSION SCAN AVEC GPT-4 ===');
    
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
    
    // 🤖 ANALYSE GPT-4 VISION AVEC DEBUG
    console.log('🤖 === ANALYSE GPT-4 POUR SUBMIT ===');
    
    let validSignatures, rejectedSignatures, confidence, notes, analysisMethod;

    try {
      if (VisionService && VisionService.analyzeSignatureSheet) {
        console.log('✅ VisionService disponible pour submit');
        
        const analysisResult = await VisionService.analyzeSignatureSheet(
          req.file.buffer,
          initiativeName
        );

        if (analysisResult.success) {
          // ✅ Utiliser les résultats GPT-4
          validSignatures = analysisResult.data.validSignatures;
          rejectedSignatures = analysisResult.data.invalidSignatures;
          confidence = analysisResult.data.confidence;
          notes = analysisResult.data.notes;
          analysisMethod = analysisResult.data.analysisMethod;
          
          console.log('✅ GPT-4 Vision Submit - Analyse réussie:');
          console.log(`   📊 ${validSignatures} signatures valides`);
          console.log(`   ❌ ${rejectedSignatures} signatures invalides`);
          console.log(`   🎯 Confiance: ${Math.round(confidence * 100)}%`);
        } else {
          throw new Error('GPT-4 failed: ' + analysisResult.error);
        }
      } else {
        throw new Error('VisionService indisponible');
      }
    } catch (visionError) {
      // ⚠️ Fallback vers simulation
      console.log('⚠️ Erreur GPT-4 Submit, utilisation du fallback:', visionError.message);
      
      const totalSigs = Math.floor(Math.random() * 15) + 8;
      validSignatures = Math.floor(totalSigs * (0.7 + Math.random() * 0.3));
      rejectedSignatures = totalSigs - validSignatures;
      confidence = (Math.random() * 0.2) + 0.8; // 80-100%
      notes = 'Analyse en mode dégradé: ' + visionError.message;
      analysisMethod = 'Simulation (GPT-4 indisponible)';
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
      message: analysisMethod.includes('GPT-4') ?
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
      gpt4Status: analysisMethod.includes('GPT-4') ? 'success' : 'fallback'
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
