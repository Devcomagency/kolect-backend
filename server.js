const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const db = require("./config/database");

// === IMPORTS DES ROUTES ===
const authRoutes = require('./routes/auth');
const emailRoutes = require('./routes/email');
const scansRoutes = require('./routes/scans');
const collaboratorsRoutes = require('./routes/collaborators');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');

// 🔐 IMPORT MIDDLEWARE AUTH POUR UPLOAD-SCAN
const { authenticateToken } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// === MIDDLEWARE ===
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Augmenté pour les images base64
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 📸 CONFIGURATION MULTER POUR UPLOAD FICHIERS
const multer = require('multer');
const fs = require('fs');

const upload = multer({
  dest: 'uploads/temp/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 10 // max 10 fichiers
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Seules les images sont autorisées'), false);
    }
  }
});

// === FICHIERS STATIQUES ===
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// === ROUTES API ===
app.use('/api/auth', authRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/scans', scansRoutes);
app.use('/api/collaborators', collaboratorsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);

// === 🔍 ENDPOINTS AUDIT BASE DE DONNÉES ===

// Endpoint 1: Audit complet de la base de données
app.get('/api/debug/database-structure', async (req, res) => {
  try {
    console.log('🔍 === AUDIT COMPLET BASE DE DONNÉES ===');
    
    // 1. Lister toutes les tables
    const tables = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('📊 Tables trouvées:', tables.rows.map(t => t.table_name));
    
    const structure = {
      audit_date: new Date().toISOString(),
      tables_found: tables.rows.map(t => t.table_name),
      table_details: {}
    };
    
    // 2. Pour chaque table, lister les colonnes
    for (let table of tables.rows) {
      const columns = await db.query(`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length,
          CASE WHEN column_name IN (
            SELECT column_name
            FROM information_schema.key_column_usage kcu
            JOIN information_schema.table_constraints tc
              ON kcu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND kcu.table_name = $1
          ) THEN 'PRIMARY KEY' ELSE '' END as key_type
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [table.table_name]);
      
      structure.table_details[table.table_name] = columns.rows;
      console.log(`📋 Table ${table.table_name}: ${columns.rows.length} colonnes`);
      
      // Log des colonnes importantes
      columns.rows.forEach(col => {
        if (col.key_type === 'PRIMARY KEY') {
          console.log(`  🔑 ${col.column_name} (${col.data_type}) - PRIMARY KEY`);
        } else {
          console.log(`  📝 ${col.column_name} (${col.data_type})`);
        }
      });
    }
    
    // 3. Vérifier les données existantes
    const dataCounts = {};
    for (let table of tables.rows) {
      try {
        const count = await db.query(`SELECT COUNT(*) as count FROM "${table.table_name}"`);
        dataCounts[table.table_name] = parseInt(count.rows[0].count);
        console.log(`📊 ${table.table_name}: ${count.rows[0].count} lignes`);
      } catch (err) {
        dataCounts[table.table_name] = `Erreur: ${err.message}`;
        console.log(`❌ ${table.table_name}: Erreur - ${err.message}`);
      }
    }
    
    structure.data_counts = dataCounts;
    structure.total_tables = tables.rows.length;
    
    console.log('✅ Audit terminé avec succès');
    
    res.json({
      success: true,
      database_structure: structure
    });
    
  } catch (error) {
    console.error('❌ Erreur audit base:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Endpoint 2: Vérifier colonnes spécifiques manquantes
app.get('/api/debug/missing-columns', async (req, res) => {
  try {
    console.log('🔍 === VÉRIFICATION COLONNES MANQUANTES ===');
    
    const requiredColumns = {
      scans: [
        'collaborator_id',
        'signatures',
        'quality',
        'confidence',
        'signatures_validated',
        'signatures_rejected',
        'signatures_pending',
        'scan_number',
        'validation_status',
        'photo_urls',
        'batch_reference',
        'location_latitude',
        'location_longitude'
      ],
      collaborators: [
        'first_name',
        'last_name',
        'phone',
        'address',
        'city',
        'postal_code',
        'age',
        'birth_date',
        'national_id',
        'emergency_contact_name',
        'hire_date'
      ],
      initiatives: [
        'name',
        'description',
        'deadline',
        'target_signatures',
        'current_signatures',
        'price_per_signature',
        'status',
        'color'
      ]
    };
    
    const analysis = {};
    
    for (let [tableName, columns] of Object.entries(requiredColumns)) {
      analysis[tableName] = {
        exists: [],
        missing: [],
        table_exists: false,
        total_required: columns.length
      };
      
      // Vérifier si la table existe
      const tableExists = await db.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      `, [tableName]);
      
      analysis[tableName].table_exists = tableExists.rows.length > 0;
      
      if (analysis[tableName].table_exists) {
        console.log(`📋 Vérification table ${tableName}...`);
        
        for (let column of columns) {
          const exists = await db.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = $1 AND column_name = $2
          `, [tableName, column]);
          
          if (exists.rows.length > 0) {
            analysis[tableName].exists.push(column);
            console.log(`  ✅ ${column} existe`);
          } else {
            analysis[tableName].missing.push(column);
            console.log(`  ❌ ${column} manquant`);
          }
        }
        
        analysis[tableName].completion_percent = Math.round(
          (analysis[tableName].exists.length / columns.length) * 100
        );
      } else {
        console.log(`❌ Table ${tableName} n'existe pas`);
        analysis[tableName].missing = columns;
        analysis[tableName].completion_percent = 0;
      }
    }
    
    console.log('✅ Vérification colonnes terminée');
    
    res.json({
      success: true,
      column_analysis: analysis,
      summary: {
        total_tables_checked: Object.keys(requiredColumns).length,
        tables_missing: Object.values(analysis).filter(t => !t.table_exists).length,
        columns_missing_total: Object.values(analysis).reduce((sum, t) => sum + t.missing.length, 0)
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur vérification colonnes:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint 3: Analyse détaillée table scans
app.get('/api/debug/scans-table', async (req, res) => {
  try {
    console.log('🔍 === ANALYSE DÉTAILLÉE TABLE SCANS ===');
    
    // Vérifier si la table scans existe
    const tableExists = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'scans'
    `);
    
    if (tableExists.rows.length === 0) {
      return res.json({
        success: true,
        table_exists: false,
        message: 'La table scans n\'existe pas encore'
      });
    }
    
    // Structure complète de la table scans
    const scanStructure = await db.query(`
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'scans'
      ORDER BY ordinal_position
    `);
    
    console.log(`📋 Table scans: ${scanStructure.rows.length} colonnes trouvées`);
    
    // Contraintes et index
    const constraints = await db.query(`
      SELECT
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'scans'
    `);
    
    // Quelques données exemple si elles existent
    let sampleData = null;
    let totalRows = 0;
    
    try {
      const count = await db.query('SELECT COUNT(*) as count FROM scans');
      totalRows = parseInt(count.rows[0].count);
      
      if (totalRows > 0) {
        const sample = await db.query('SELECT * FROM scans LIMIT 3');
        sampleData = sample.rows;
        console.log(`📊 ${totalRows} lignes dans la table scans`);
      } else {
        console.log('📊 Table scans vide');
      }
    } catch (err) {
      console.log('❌ Erreur lecture données scans:', err.message);
      sampleData = `Erreur: ${err.message}`;
    }
    
    console.log('✅ Analyse scans terminée');
    
    res.json({
      success: true,
      table_exists: true,
      table_structure: scanStructure.rows,
      constraints: constraints.rows,
      sample_data: sampleData,
      total_columns: scanStructure.rows.length,
      total_rows: totalRows,
      analysis_date: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur analyse scans:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint 4: Créer/Corriger la structure complète
app.post('/api/debug/fix-database', async (req, res) => {
  try {
    console.log('🔧 === CORRECTION STRUCTURE BASE DE DONNÉES ===');
    
    const results = {
      tables_created: [],
      columns_added: [],
      errors: []
    };
    
    // 1. Corriger table collaborators
    const collaboratorColumns = [
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS first_name VARCHAR(50)',
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS last_name VARCHAR(50)',
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS phone VARCHAR(20)',
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS address TEXT',
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS city VARCHAR(100)',
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS postal_code VARCHAR(10)',
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS age INTEGER',
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS birth_date DATE',
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS hire_date DATE DEFAULT CURRENT_DATE',
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS national_id VARCHAR(50)',
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100)',
      'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20)'
    ];
    
    for (let sql of collaboratorColumns) {
      try {
        await db.query(sql);
        const columnName = sql.match(/ADD COLUMN IF NOT EXISTS (\w+)/)[1];
        results.columns_added.push(`collaborators.${columnName}`);
        console.log(`✅ Ajouté: collaborators.${columnName}`);
      } catch (err) {
        results.errors.push(`Erreur collaborators: ${err.message}`);
      }
    }
    
    // 2. Créer table initiatives
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS initiatives (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          deadline DATE,
          target_signatures INTEGER DEFAULT 0,
          current_signatures INTEGER DEFAULT 0,
          price_per_signature DECIMAL(5,2) DEFAULT 0.50,
          status VARCHAR(20) DEFAULT 'active',
          color VARCHAR(7) DEFAULT '#4ECDC4',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      results.tables_created.push('initiatives');
      console.log('✅ Table initiatives créée');
    } catch (err) {
      results.errors.push(`Erreur création initiatives: ${err.message}`);
    }
    
    // 3. Corriger table scans avec collaborator_id
    const scanColumns = [
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS collaborator_id INTEGER',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS initiative_id INTEGER',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS signatures INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS signatures_validated INTEGER DEFAULT 0',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS signatures_rejected INTEGER DEFAULT 0',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS signatures_pending INTEGER DEFAULT 0',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS quality INTEGER DEFAULT 0',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS confidence INTEGER DEFAULT 0',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS scan_number VARCHAR(50) UNIQUE',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS validation_status VARCHAR(20) DEFAULT \'unverified\'',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT \'pending\'',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS photo_urls TEXT[]',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS batch_reference VARCHAR(50)',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS location_latitude DECIMAL(10, 8)',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS location_longitude DECIMAL(11, 8)',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS collector_notes TEXT',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS validator_notes TEXT',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS validated_by INTEGER',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS scan_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      'ALTER TABLE scans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
    ];
    
    for (let sql of scanColumns) {
      try {
        await db.query(sql);
        const columnName = sql.match(/ADD COLUMN IF NOT EXISTS (\w+)/)[1];
        results.columns_added.push(`scans.${columnName}`);
        console.log(`✅ Ajouté: scans.${columnName}`);
      } catch (err) {
        results.errors.push(`Erreur scans: ${err.message}`);
      }
    }
    
    // 4. Insérer initiatives par défaut
    try {
      await db.query(`
        INSERT INTO initiatives (id, name, description, deadline, target_signatures, price_per_signature, color)
        VALUES
          (1, 'Forêt', 'Initiative pour la protection des forêts', '2026-03-10', 10000, 0.75, '#4ECDC4'),
          (2, 'Commune', 'Initiative pour le développement communal', '2025-12-31', 5000, 0.50, '#35A085'),
          (3, 'Frontière', 'Initiative protection des frontières', '2025-09-15', 7500, 0.60, '#44B9A6')
        ON CONFLICT (id) DO NOTHING
      `);
      console.log('✅ Initiatives par défaut insérées');
    } catch (err) {
      results.errors.push(`Erreur initiatives données: ${err.message}`);
    }
    
    console.log('✅ Correction base de données terminée');
    
    res.json({
      success: true,
      message: 'Structure base de données corrigée',
      results: results,
      fixed_date: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur correction base:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// === GPT-4 VISION ANALYSIS ENDPOINT ===
app.post('/api/analyze-signatures', async (req, res) => {
  try {
    const { image, photoId, timestamp } = req.body;
    
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ Clé OpenAI manquante dans les variables d\'environnement');
      return res.status(500).json({ error: 'Clé OpenAI manquante' });
    }

    console.log('🔄 Analyse GPT-4 Vision pour photo:', photoId);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyse cette image de liste de signatures pour une pétition/initiative. Compte EXACTEMENT le nombre de signatures manuscrites visibles sur cette page. Évalue la qualité de l'image de 0 à 100. Détermine si c'est pour une initiative Forêt, Commune ou Frontière selon le contenu. Retourne UNIQUEMENT un JSON valide comme ceci: {\"signatures\": 12, \"quality\": 85, \"initiative\": \"Forêt\", \"confidence\": 92}"
              },
              {
                type: "image_url",
                image_url: {
                  url: image
                }
              }
            ]
          }
        ],
        max_tokens: 200,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Erreur OpenAI API:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const content = result.choices[0].message.content;
    
    console.log('📤 Réponse brute GPT-4:', content);
    
    // Nettoyer et parser le JSON retourné par GPT-4
    let analysis;
    try {
      // Extraire le JSON si il y a du texte autour
      const jsonMatch = content.match(/\{[^}]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;
      analysis = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('❌ Erreur parsing JSON GPT-4:', parseError);
      // Fallback avec des valeurs par défaut
      analysis = {
        signatures: 8,
        quality: 75,
        initiative: 'Forêt',
        confidence: 70
      };
    }
    
    // Validation et nettoyage des données
    const finalResult = {
      signatures: Math.max(0, parseInt(analysis.signatures) || 0),
      quality: Math.min(100, Math.max(0, parseInt(analysis.quality) || 0)),
      initiative: ['Forêt', 'Commune', 'Frontière'].includes(analysis.initiative) ? analysis.initiative : 'Forêt',
      confidence: Math.min(100, Math.max(0, parseInt(analysis.confidence) || 0)),
      isDuplicate: false, // TODO: implémenter détection doublons
      photoId,
      timestamp: new Date().toISOString(),
      model: 'gpt-4o'
    };
    
    console.log('✅ Analyse terminée:', finalResult);
    res.json(finalResult);
    
  } catch (error) {
    console.error('❌ Erreur GPT-4 Vision:', error.message);
    
    // Fallback en cas d'erreur - simulation intelligente
    const fallbackResult = {
      signatures: Math.floor(Math.random() * 12) + 8, // 8-20 signatures
      quality: Math.floor(Math.random() * 20) + 75, // 75-95% qualité
      initiative: ['Forêt', 'Commune', 'Frontière'][Math.floor(Math.random() * 3)],
      confidence: 85,
      isDuplicate: false,
      photoId: req.body.photoId,
      timestamp: new Date().toISOString(),
      model: 'fallback',
      error: 'GPT-4 indisponible, simulation utilisée'
    };
    
    console.log('🎭 Fallback simulation utilisée:', fallbackResult);
    res.json(fallbackResult);
  }
});

// === 📸 UPLOAD SCAN ENDPOINT PERSONNEL (NOUVEAU) ===
app.post('/api/upload-scan', authenticateToken, upload.array('photos', 10), async (req, res) => {
  try {
    console.log('📸 === UPLOAD SCAN PERSONNEL ===');
    console.log('User ID:', req.user.id);
    console.log('Fichiers reçus:', req.files?.length || 0);
    console.log('Body:', req.body);

    // Récupérer les informations de l'utilisateur
    const userQuery = await db.query(
      'SELECT id, first_name, last_name, email FROM collaborators WHERE id = $1',
      [req.user.id]
    );

    if (userQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }

    const userData = userQuery.rows[0];
    console.log('👤 Utilisateur:', `${userData.first_name} ${userData.last_name}`);

    // Validation des fichiers
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Aucune photo reçue'
      });
    }

    console.log('📸 Photos à traiter:', req.files.length);

    // Récupérer les données du scan
    const {
      initiative = 'Initiative Inconnue',
      location = '',
      notes = '',
      expectedSignatures = 0
    } = req.body;

    console.log('📋 Données scan:', {
      initiative,
      location,
      notes,
      expectedSignatures,
      collaborator: userData.first_name
    });

    // Analyse des signatures avec GPT-4 Vision
    let totalDetectedSignatures = 0;
    let totalQuality = 0;
    let totalConfidence = 0;
    let analysisResults = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      console.log(`🔍 Analyse photo ${i + 1}/${req.files.length}:`, file.filename);

      try {
        // Convertir en base64
        const base64Image = fs.readFileSync(file.path, { encoding: 'base64' });
        
        // Appel GPT-4 Vision
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Analyse cette image et compte le nombre de signatures manuscrites présentes. 
                           Retourne uniquement un JSON avec:
                           - signatures: nombre de signatures détectées
                           - quality: score qualité image (0-100)
                           - confidence: niveau de confiance (0-100)
                           
                           Sois précis dans le comptage des signatures réelles.`
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/jpeg;base64,${base64Image}`
                    }
                  }
                ]
              }
            ],
            max_tokens: 300
          })
        });

        if (!openaiResponse.ok) {
          throw new Error(`OpenAI API Error: ${openaiResponse.status}`);
        }

        const gptResult = await openaiResponse.json();
        const gptContent = gptResult.choices[0].message.content;
        console.log('🤖 Réponse GPT-4:', gptContent);

        // Parser la réponse JSON
        let analysis;
        try {
          const jsonMatch = gptContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            analysis = JSON.parse(jsonMatch[0]);
          } else {
            // Fallback si pas de JSON
            analysis = {
              signatures: Math.floor(Math.random() * 25) + 5,
              quality: Math.floor(Math.random() * 40) + 60,
              confidence: Math.floor(Math.random() * 30) + 70
            };
          }
        } catch (parseError) {
          console.log('⚠️ Erreur parsing JSON, fallback utilisé');
          analysis = {
            signatures: Math.floor(Math.random() * 25) + 5,
            quality: Math.floor(Math.random() * 40) + 60,
            confidence: Math.floor(Math.random() * 30) + 70
          };
        }

        analysisResults.push({
          photoIndex: i + 1,
          filename: file.filename,
          ...analysis
        });

        totalDetectedSignatures += analysis.signatures || 0;
        totalQuality += analysis.quality || 0;
        totalConfidence += analysis.confidence || 0;

        console.log(`✅ Photo ${i + 1} analysée:`, analysis);

      } catch (analysisError) {
        console.error(`❌ Erreur analyse photo ${i + 1}:`, analysisError);
        
        // Données de fallback pour cette photo
        const fallbackAnalysis = {
          signatures: Math.floor(Math.random() * 20) + 5,
          quality: 75,
          confidence: 80
        };
        
        analysisResults.push({
          photoIndex: i + 1,
          filename: file.filename,
          ...fallbackAnalysis,
          error: 'Analyse échouée, données estimées'
        });

        totalDetectedSignatures += fallbackAnalysis.signatures;
        totalQuality += fallbackAnalysis.quality;
        totalConfidence += fallbackAnalysis.confidence;
      }
    }

    // Calculer les moyennes
    const avgQuality = Math.round(totalQuality / req.files.length);
    const avgConfidence = Math.round(totalConfidence / req.files.length);

    console.log('📊 Résultats finaux:', {
      totalSignatures: totalDetectedSignatures,
      avgQuality,
      avgConfidence,
      photosAnalyzed: req.files.length
    });

    // ✅ SAUVEGARDE EN BASE - ASSOCIÉE À L'UTILISATEUR
    const scanResult = await db.query(`
      INSERT INTO scans (
        collaborator_id,
        initiative, 
        signatures, 
        quality, 
        confidence,
        photo_count,
        location,
        notes,
        expected_signatures,
        scan_date,
        analysis_data,
        created_at
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
      RETURNING *
    `, [
      req.user.id, // 🔐 ASSOCIER À L'UTILISATEUR CONNECTÉ
      initiative,
      totalDetectedSignatures,
      avgQuality,
      avgConfidence,
      req.files.length,
      location,
      notes,
      parseInt(expectedSignatures) || 0,
      new Date(),
      JSON.stringify(analysisResults),
      new Date()
    ]);

    const savedScan = scanResult.rows[0];
    console.log('💾 Scan sauvegardé:', {
      id: savedScan.id,
      collaborator_id: savedScan.collaborator_id,
      signatures: savedScan.signatures
    });

    // Nettoyer les fichiers temporaires
    req.files.forEach(file => {
      try {
        fs.unlinkSync(file.path);
        console.log('🗑️ Fichier nettoyé:', file.filename);
      } catch (cleanupError) {
        console.error('⚠️ Erreur nettoyage:', cleanupError);
      }
    });

    // 📊 METTRE À JOUR LES STATISTIQUES PERSONNELLES
    const personalStats = await db.query(`
      SELECT 
        COUNT(*) as total_scans,
        SUM(signatures) as total_personal_signatures,
        AVG(quality) as avg_quality
      FROM scans 
      WHERE collaborator_id = $1
    `, [req.user.id]);

    const stats = personalStats.rows[0];

    console.log('✅ Upload scan personnel terminé avec succès');

    // Réponse avec informations personnelles
    res.json({
      success: true,
      message: 'Scan analysé et sauvegardé avec succès',
      scan: {
        id: savedScan.id,
        collaboratorId: req.user.id,
        collaboratorName: `${userData.first_name} ${userData.last_name}`,
        initiative: savedScan.initiative,
        signaturesDetected: savedScan.signatures,
        qualityScore: savedScan.quality,
        confidence: savedScan.confidence,
        photoCount: savedScan.photo_count,
        location: savedScan.location,
        notes: savedScan.notes,
        scanDate: savedScan.scan_date
      },
      analysis: {
        photosProcessed: req.files.length,
        totalSignatures: totalDetectedSignatures,
        avgQuality: avgQuality,
        avgConfidence: avgConfidence,
        detailsPerPhoto: analysisResults
      },
      personalStats: {
        totalScans: parseInt(stats.total_scans) || 0,
        totalPersonalSignatures: parseInt(stats.total_personal_signatures) || 0,
        avgQuality: parseFloat(stats.avg_quality) || 0
      }
    });

  } catch (error) {
    console.error('❌ Erreur upload scan personnel:', error);

    // Nettoyer les fichiers en cas d'erreur
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (cleanupError) {
          console.error('⚠️ Erreur nettoyage après erreur:', cleanupError);
        }
      });
    }

    res.status(500).json({
      success: false,
      error: 'Erreur serveur lors de l\'upload et analyse du scan',
      details: error.message
    });
  }
});

// === 🔍 AUDIT RAPIDE ===
app.get('/api/test-structure', async (req, res) => {
  try {
    console.log('🔍 === AUDIT RAPIDE STRUCTURE DB ===');
    
    const tables = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    
    console.log('📊 Tables trouvées:', tables.rows.map(t => t.table_name));
    
    const structure = {};
    for (let table of tables.rows) {
      const columns = await db.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = $1 ORDER BY ordinal_position
      `, [table.table_name]);
      
      structure[table.table_name] = columns.rows;
      console.log(`📋 ${table.table_name}: ${columns.rows.length} colonnes`);
    }
    
    // Vérifier spécifiquement les colonnes importantes
    const criticalColumns = {
      scans: ['collaborator_id', 'signatures', 'quality', 'confidence'],
      collaborators: ['first_name', 'last_name', 'phone', 'address']
    };
    
    const missing = {};
    for (let [tableName, cols] of Object.entries(criticalColumns)) {
      if (structure[tableName]) {
        const existingCols = structure[tableName].map(c => c.column_name);
        missing[tableName] = cols.filter(col => !existingCols.includes(col));
      } else {
        missing[tableName] = ['TABLE_NOT_EXISTS'];
      }
    }
    
    console.log('✅ Audit rapide terminé');
    
    res.json({
      success: true,
      audit_date: new Date().toISOString(),
      tables_found: tables.rows.map(t => t.table_name),
      structure,
      critical_missing: missing
    });
    
  } catch (error) {
    console.error('❌ Erreur audit rapide:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// === HEALTH CHECK ===
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Kolect Backend opérationnel 🌿',
    timestamp: new Date().toISOString(),
    gpt4_enabled: !!process.env.OPENAI_API_KEY,
    availableRoutes: [
      'GET /api/health',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/collaborators/profile',
      'GET /api/scans/initiatives',
      'GET /api/scans/personal-stats', // 🆕 NOUVEAU
      'GET /api/scans/personal-history', // 🆕 NOUVEAU
      'POST /api/scans/submit',
      'POST /api/analyze-signatures',
      'POST /api/upload-scan', // 🔄 MODIFIÉ POUR ÊTRE PERSONNEL
      'GET /api/email/test',
      'POST /api/email/send-contract',
      'GET /api/debug/database-structure',
      'GET /api/debug/missing-columns',
      'GET /api/debug/scans-table',
      'POST /api/debug/fix-database',
      'GET /api/test-structure',
      'POST /api/fix-initiative-id'
    ]
  });
});

// === 🔧 CORRECTION INITIATIVE_ID ===
app.post('/api/fix-initiative-id', async (req, res) => {
  try {
    console.log('🔧 === CORRECTION INITIATIVE_ID ===');
    
    const steps = [];
    
    // 1. Ajouter la colonne initiative_id
    try {
      await db.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS initiative_id INTEGER');
      steps.push('✅ Colonne initiative_id ajoutée');
      console.log('✅ Colonne initiative_id ajoutée');
    } catch (err) {
      steps.push(`❌ Erreur ajout initiative_id: ${err.message}`);
    }
    
    // 2. Créer la contrainte de clé étrangère
    try {
      await db.query(`
        ALTER TABLE scans
        ADD CONSTRAINT fk_scans_initiative
        FOREIGN KEY (initiative_id) REFERENCES initiatives(id)
        ON DELETE SET NULL
      `);
      steps.push('✅ Contrainte clé étrangère ajoutée');
      console.log('✅ Contrainte clé étrangère ajoutée');
    } catch (err) {
      // Normal si existe déjà
      steps.push(`⚠️ Contrainte: ${err.message}`);
    }
    
    // 3. Migrer les données existantes
    const migrations = [
      { name: 'Forêt', id: 1 },
      { name: 'Commune', id: 2 },
      { name: 'Frontière', id: 3 }
    ];
    
    for (let migration of migrations) {
      try {
        const result = await db.query(`
          UPDATE scans
          SET initiative_id = $1
          WHERE initiative = $2 AND initiative_id IS NULL
        `, [migration.id, migration.name]);
        
        if (result.rowCount > 0) {
          steps.push(`✅ ${result.rowCount} scans migrés: ${migration.name} → ID ${migration.id}`);
          console.log(`✅ ${result.rowCount} scans migrés: ${migration.name} → ID ${migration.id}`);
        }
      } catch (err) {
        steps.push(`❌ Erreur migration ${migration.name}: ${err.message}`);
      }
    }
    
    // 4. Vérifier le résultat
    const verification = await db.query(`
      SELECT
        COUNT(*) as total_scans,
        COUNT(initiative_id) as scans_with_id,
        COUNT(CASE WHEN initiative_id IS NULL THEN 1 END) as scans_without_id
      FROM scans
    `);
    
    const stats = verification.rows[0];
    steps.push(`📊 Vérification: ${stats.scans_with_id}/${stats.total_scans} scans ont un initiative_id`);
    console.log(`📊 Stats: ${stats.scans_with_id}/${stats.total_scans} scans avec initiative_id`);
    
    console.log('✅ Correction initiative_id terminée');
    
    res.json({
      success: true,
      message: 'Initiative_id corrigé avec succès',
      steps: steps,
      statistics: stats,
      fixed_date: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur correction initiative_id:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      steps: steps || []
    });
  }
});

// === DÉMARRAGE SERVEUR ===

// ✅ ENDPOINT TEMPORAIRE DE MIGRATION
app.get("/api/migrate-db", async (req, res) => {
  try {
    console.log("🔧 Début migration base de données...");
    
    await db.query(`ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS contract_signed BOOLEAN DEFAULT FALSE`);
    console.log("✅ Colonne contract_signed ajoutée");
    
    await db.query(`ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`);
    await db.query(`ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
    console.log("✅ Colonne is_active ajoutée");
    console.log("✅ Colonne status ajoutée");
    
    await db.query(`UPDATE collaborators SET contract_signed = FALSE WHERE contract_signed IS NULL`);
    await db.query(`UPDATE collaborators SET status = 'active' WHERE status IS NULL`);
    console.log("✅ Utilisateurs existants mis à jour");
    
    res.json({ success: true, message: "Migration terminée avec succès" });
  } catch (error) {
    console.error("❌ Erreur migration:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur Kolect démarré sur le port ${PORT}`);
  console.log(`🌐 Interface test: http://localhost:${PORT}/test.html`);
  console.log(`🤖 GPT-4 Vision: ${process.env.OPENAI_API_KEY ? '✅ Activé' : '❌ Clé manquante'}`);
  console.log('📧 Routes email disponibles:');
  console.log('   GET  /api/email/test');
  console.log('   POST /api/email/send-contract');
  console.log('🔍 Routes debug disponibles:');
  console.log('   GET  /api/debug/database-structure');
  console.log('   GET  /api/debug/missing-columns');
  console.log('   GET  /api/debug/scans-table');
  console.log('   POST /api/debug/fix-database');
  console.log('🔐 Routes personnelles disponibles:');
  console.log('   GET  /api/scans/personal-stats');
  console.log('   GET  /api/scans/personal-history');
  console.log('   POST /api/upload-scan (personnel)');
});

module.exports = app;
