const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Fonction utilitaire pour vérifier si une table existe
const tableExists = async (tableName) => {
  try {
    const result = await pool.query(
      `SELECT EXISTS (
        SELECT FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = $1
      )`,
      [tableName]
    );
    return result.rows[0].exists;
  } catch (error) {
    console.error(`❌ Erreur vérification table ${tableName}:`, error);
    return false;
  }
};

// Fonction utilitaire pour vérifier si une colonne existe dans une table
const columnExists = async (tableName, columnName) => {
  try {
    const result = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = $1 
        AND column_name = $2
      )`,
      [tableName, columnName]
    );
    return result.rows[0].exists;
  } catch (error) {
    console.error(`❌ Erreur vérification colonne ${tableName}.${columnName}:`, error);
    return false;
  }
};

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requis' });
  }

  try {
    const jwtSecret = process.env.JWT_SECRET;
    console.log('🔑 JWT Secret défini:', !!jwtSecret);
    
    const decoded = jwt.verify(token, jwtSecret);
    console.log('✅ Token décodé, userId:', decoded.userId);
    
    const userQuery = `SELECT id, first_name, last_name, email, phone, status FROM collaborators WHERE id = $1`;
    const userResult = await pool.query(userQuery, [decoded.userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }
    
    const user = userResult.rows[0];
    req.user = {
      userId: user.id,
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone,
      status: user.status
    };
    
    console.log('✅ Auth réussie pour:', user.email);
    next();
    
  } catch (error) {
    console.error('❌ Erreur auth:', error.name, error.message);
    return res.status(403).json({
      error: 'Token invalide',
      type: error.name,
      details: error.message
    });
  }
};

// 📊 NOUVEAU: Statistiques personnelles par initiative
router.get('/personal-stats', authenticateToken, async (req, res) => {
  try {
    console.log('📊 === DEMANDE STATS PERSONNELLES ===');
    console.log('User ID:', req.user.id);

    // Vérifier que l'utilisateur existe
    const user = await pool.query(
      'SELECT id, first_name, last_name FROM collaborators WHERE id = $1',
      [req.user.id]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }

    console.log('✅ Utilisateur trouvé:', user.rows[0]);

    // Récupérer les statistiques personnelles par initiative
    const personalStats = await pool.query(`
      SELECT 
        initiative,
        COUNT(*) as scan_count,
        SUM(signatures) as total_personal_signatures,
        AVG(quality) as avg_quality,
        MIN(scan_date) as first_scan,
        MAX(scan_date) as last_scan
      FROM scans 
      WHERE collaborator_id = $1 
        AND signatures > 0
      GROUP BY initiative
      ORDER BY total_personal_signatures DESC
    `, [req.user.id]);

    console.log('📈 Stats personnelles trouvées:', personalStats.rows);

    // Formater les résultats
    const initiatives = personalStats.rows.map(stat => ({
      name: stat.initiative || 'Initiative Inconnue',
      personalSignatures: parseInt(stat.total_personal_signatures) || 0,
      scanCount: parseInt(stat.scan_count) || 0,
      avgQuality: parseFloat(stat.avg_quality) || 0,
      firstScan: stat.first_scan,
      lastScan: stat.last_scan
    }));

    // Calculer le total personnel
    const totalPersonal = initiatives.reduce((sum, init) => sum + init.personalSignatures, 0);

    // Statistiques globales personnelles
    const globalPersonalStats = await pool.query(`
      SELECT 
        COUNT(*) as total_scans,
        SUM(signatures) as total_signatures,
        AVG(quality) as avg_quality,
        COUNT(DISTINCT initiative) as initiative_count,
        MIN(scan_date) as first_scan,
        MAX(scan_date) as last_scan
      FROM scans 
      WHERE collaborator_id = $1
    `, [req.user.id]);

    const globalStats = globalPersonalStats.rows[0];

    console.log('🎯 Réponse stats personnelles:', {
      totalPersonal,
      initiatives: initiatives.length,
      totalScans: globalStats.total_scans
    });

    res.json({
      success: true,
      message: 'Statistiques personnelles récupérées',
      userId: req.user.id,
      userName: `${user.rows[0].first_name} ${user.rows[0].last_name}`,
      totalPersonalSignatures: totalPersonal,
      initiatives: initiatives,
      globalStats: {
        totalScans: parseInt(globalStats.total_scans) || 0,
        totalSignatures: parseInt(globalStats.total_signatures) || 0,
        avgQuality: parseFloat(globalStats.avg_quality) || 0,
        initiativeCount: parseInt(globalStats.initiative_count) || 0,
        firstScan: globalStats.first_scan,
        lastScan: globalStats.last_scan
      }
    });

  } catch (error) {
    console.error('❌ Erreur stats personnelles:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur lors de la récupération des statistiques personnelles',
      details: error.message
    });
  }
});

// 📅 NOUVEAU: Historique personnel quotidien
router.get('/personal-history', authenticateToken, async (req, res) => {
  try {
    console.log('📅 === DEMANDE HISTORIQUE PERSONNEL ===');
    console.log('User ID:', req.user.id);

    // Récupérer l'historique des 30 derniers jours pour cet utilisateur
    const personalHistory = await pool.query(`
      SELECT 
        DATE(scan_date) as scan_day,
        COUNT(*) as scan_count,
        SUM(signatures) as daily_signatures,
        AVG(quality) as avg_quality,
        STRING_AGG(DISTINCT initiative, ', ') as initiatives
      FROM scans 
      WHERE collaborator_id = $1 
        AND scan_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(scan_date)
      ORDER BY scan_day DESC
      LIMIT 30
    `, [req.user.id]);

    console.log('📊 Historique personnel trouvé:', personalHistory.rows.length, 'jours');

    // Formater les données d'historique
    const history = personalHistory.rows.map(day => ({
      date: day.scan_day,
      scanDate: day.scan_day, // Alias pour compatibilité
      scanCount: parseInt(day.scan_count) || 0,
      personalSignatures: parseInt(day.daily_signatures) || 0,
      signatures: parseInt(day.daily_signatures) || 0, // Alias pour compatibilité
      avgQuality: parseFloat(day.avg_quality) || 0,
      initiatives: day.initiatives || ''
    }));

    // Statistiques de la période
    const periodStats = await pool.query(`
      SELECT 
        COUNT(DISTINCT DATE(scan_date)) as active_days,
        COUNT(*) as total_scans,
        SUM(signatures) as total_signatures,
        AVG(signatures) as avg_signatures_per_scan,
        MAX(signatures) as max_signatures_in_one_scan,
        MIN(scan_date) as period_start,
        MAX(scan_date) as period_end
      FROM scans 
      WHERE collaborator_id = $1 
        AND scan_date >= CURRENT_DATE - INTERVAL '30 days'
    `, [req.user.id]);

    const stats = periodStats.rows[0];

    console.log('✅ Statistiques période:', {
      activeDays: stats.active_days,
      totalScans: stats.total_scans,
      totalSignatures: stats.total_signatures
    });

    res.json({
      success: true,
      message: 'Historique personnel récupéré',
      userId: req.user.id,
      periodDays: 30,
      history: history,
      periodStats: {
        activeDays: parseInt(stats.active_days) || 0,
        totalScans: parseInt(stats.total_scans) || 0,
        totalSignatures: parseInt(stats.total_signatures) || 0,
        avgSignaturesPerScan: parseFloat(stats.avg_signatures_per_scan) || 0,
        maxSignaturesInOneScan: parseInt(stats.max_signatures_in_one_scan) || 0,
        periodStart: stats.period_start,
        periodEnd: stats.period_end
      }
    });

  } catch (error) {
    console.error('❌ Erreur historique personnel:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur lors de la récupération de l\'historique personnel',
      details: error.message
    });
  }
});

// 🔍 NOUVEAU: Détails scan personnel
router.get('/personal-details/:scanId', authenticateToken, async (req, res) => {
  try {
    const { scanId } = req.params;
    console.log('🔍 === DÉTAILS SCAN PERSONNEL ===');
    console.log('User ID:', req.user.id, 'Scan ID:', scanId);

    // Vérifier que le scan appartient bien à cet utilisateur
    const scan = await pool.query(`
      SELECT 
        s.*,
        c.first_name,
        c.last_name
      FROM scans s
      JOIN collaborators c ON s.collaborator_id = c.id
      WHERE s.id = $1 AND s.collaborator_id = $2
    `, [scanId, req.user.id]);

    if (scan.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Scan non trouvé ou non autorisé'
      });
    }

    const scanData = scan.rows[0];

    console.log('✅ Scan trouvé:', {
      id: scanData.id,
      initiative: scanData.initiative,
      signatures: scanData.signatures
    });

    res.json({
      success: true,
      message: 'Détails du scan récupérés',
      scan: {
        id: scanData.id,
        initiative: scanData.initiative,
        signaturesDetected: scanData.signatures,
        qualityScore: scanData.quality,
        confidence: scanData.confidence,
        scanDate: scanData.scan_date,
        photoCount: scanData.photo_count || 1,
        location: scanData.location,
        notes: scanData.notes,
        collaborator: {
          id: scanData.collaborator_id,
          firstName: scanData.first_name,
          lastName: scanData.last_name
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur détails scan:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur lors de la récupération des détails du scan',
      details: error.message
    });
  }
});

// 🗑️ NOUVEAU: Supprimer un scan personnel
router.delete('/personal/:scanId', authenticateToken, async (req, res) => {
  try {
    const { scanId } = req.params;
    console.log('🗑️ === SUPPRESSION SCAN PERSONNEL ===');
    console.log('User ID:', req.user.id, 'Scan ID:', scanId);

    // Vérifier que le scan appartient à l'utilisateur
    const scan = await pool.query(
      'SELECT * FROM scans WHERE id = $1 AND collaborator_id = $2',
      [scanId, req.user.id]
    );

    if (scan.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Scan non trouvé ou non autorisé'
      });
    }

    // Supprimer le scan
    await pool.query('DELETE FROM scans WHERE id = $1', [scanId]);

    console.log('✅ Scan supprimé avec succès');

    res.json({
      success: true,
      message: 'Scan supprimé avec succès',
      deletedScanId: scanId
    });

  } catch (error) {
    console.error('❌ Erreur suppression scan:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur lors de la suppression du scan',
      details: error.message
    });
  }
});

// 📝 NOUVEAU: Modifier les notes d'un scan personnel
router.put('/personal/:scanId/notes', authenticateToken, async (req, res) => {
  try {
    const { scanId } = req.params;
    const { notes, location } = req.body;
    
    console.log('📝 === MODIFICATION NOTES SCAN ===');
    console.log('User ID:', req.user.id, 'Scan ID:', scanId);

    // Vérifier que le scan appartient à l'utilisateur
    const scan = await pool.query(
      'SELECT * FROM scans WHERE id = $1 AND collaborator_id = $2',
      [scanId, req.user.id]
    );

    if (scan.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Scan non trouvé ou non autorisé'
      });
    }

    // Mettre à jour les notes
    const updated = await pool.query(`
      UPDATE scans 
      SET 
        notes = $1,
        location = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND collaborator_id = $4
      RETURNING *
    `, [notes, location, scanId, req.user.id]);

    console.log('✅ Notes mises à jour');

    res.json({
      success: true,
      message: 'Notes mises à jour avec succès',
      scan: {
        id: updated.rows[0].id,
        notes: updated.rows[0].notes,
        location: updated.rows[0].location,
        updatedAt: updated.rows[0].updated_at
      }
    });

  } catch (error) {
    console.error('❌ Erreur modification notes:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur lors de la modification des notes',
      details: error.message
    });
  }
});

// 📊 NOUVEAU: Statistiques rapides post-scan
router.get('/quick-stats', authenticateToken, async (req, res) => {
  try {
    console.log('⚡ === STATS RAPIDES POST-SCAN ===');
    console.log('User ID:', req.user.id);

    const quickStats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE scan_date >= CURRENT_DATE) as scans_today,
        SUM(signatures) FILTER (WHERE scan_date >= CURRENT_DATE) as signatures_today,
        COUNT(*) FILTER (WHERE scan_date >= CURRENT_DATE - INTERVAL '7 days') as scans_this_week,
        SUM(signatures) FILTER (WHERE scan_date >= CURRENT_DATE - INTERVAL '7 days') as signatures_this_week,
        COUNT(*) FILTER (WHERE scan_date >= DATE_TRUNC('month', CURRENT_DATE)) as scans_this_month,
        SUM(signatures) FILTER (WHERE scan_date >= DATE_TRUNC('month', CURRENT_DATE)) as signatures_this_month,
        MAX(scan_date) as last_scan_date
      FROM scans 
      WHERE collaborator_id = $1
    `, [req.user.id]);

    const stats = quickStats.rows[0];

    res.json({
      success: true,
      message: 'Statistiques rapides récupérées',
      quickStats: {
        today: {
          scans: parseInt(stats.scans_today) || 0,
          signatures: parseInt(stats.signatures_today) || 0
        },
        thisWeek: {
          scans: parseInt(stats.scans_this_week) || 0,
          signatures: parseInt(stats.signatures_this_week) || 0
        },
        thisMonth: {
          scans: parseInt(stats.scans_this_month) || 0,
          signatures: parseInt(stats.signatures_this_month) || 0
        },
        lastScanDate: stats.last_scan_date
      }
    });

  } catch (error) {
    console.error('❌ Erreur stats rapides:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur lors de la récupération des statistiques rapides',
      details: error.message
    });
  }
});

// 🔄 MODIFIÉ: GET /api/scans/initiatives - Maintenant personnel
router.get('/initiatives', authenticateToken, async (req, res) => {
  try {
    console.log('📊 === INITIATIVES PERSONNELLES ===');
    console.log('User ID:', req.user.id);

    const personalInitiatives = await pool.query(`
      SELECT 
        initiative,
        COUNT(*) as scan_count,
        SUM(signatures) as total_signatures,
        AVG(quality) as avg_quality
      FROM scans 
      WHERE collaborator_id = $1 
        AND signatures > 0
      GROUP BY initiative
      ORDER BY total_signatures DESC
    `, [req.user.id]);

    console.log('📈 Initiatives personnelles trouvées:', personalInitiatives.rows);

    const initiatives = personalInitiatives.rows.map(init => ({
      name: init.initiative || 'Initiative Inconnue',
      totalSignatures: parseInt(init.total_signatures) || 0,
      scanCount: parseInt(init.scan_count) || 0,
      avgQuality: parseFloat(init.avg_quality) || 0
    }));

    res.json({
      success: true,
      message: 'Initiatives personnelles récupérées',
      userId: req.user.id,
      initiatives: initiatives
    });

  } catch (error) {
    console.error('❌ Erreur initiatives personnelles:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur lors de la récupération des initiatives personnelles',
      details: error.message
    });
  }
});

// 🔄 MODIFIÉ: GET /api/scans/history - Maintenant personnel
router.get('/history', authenticateToken, async (req, res) => {
  try {
    console.log('📅 === HISTORIQUE PERSONNEL ===');
    console.log('User ID:', req.user.id);

    const personalHistory = await pool.query(`
      SELECT 
        DATE(scan_date) as date,
        COUNT(*) as scan_count,
        SUM(signatures) as signatures
      FROM scans 
      WHERE collaborator_id = $1
        AND scan_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(scan_date)
      ORDER BY date DESC
      LIMIT 15
    `, [req.user.id]);

    console.log('📊 Historique personnel trouvé:', personalHistory.rows.length, 'jours');

    const history = personalHistory.rows.map(day => ({
      date: day.date,
      scanDate: day.date,
      signatures: parseInt(day.signatures) || 0,
      totalSignatures: parseInt(day.signatures) || 0,
      scanCount: parseInt(day.scan_count) || 0
    }));

    res.json({
      success: true,
      message: 'Historique personnel récupéré',
      userId: req.user.id,
      history: history
    });

  } catch (error) {
    console.error('❌ Erreur historique personnel:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur lors de la récupération de l\'historique personnel',
      details: error.message
    });
  }
});

// POST /api/scans/submit - Soumettre un nouveau scan (INCHANGÉ)
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    console.log('📸 === SOUMISSION SCAN ===');
    const { initiative_id, signatures, quality, confidence, notes } = req.body;
    const userId = req.user.userId;

    if (!initiative_id || signatures === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Initiative et signatures requis'
      });
    }

    // Vérifier si les tables et colonnes existent
    const initiativesTableExists = await tableExists('initiatives');
    const scansTableExists = await tableExists('scans');
    const initiativeIdColumnExists = scansTableExists ? await columnExists('scans', 'initiative_id') : false;
    const collaboratorIdColumnExists = scansTableExists ? await columnExists('scans', 'collaborator_id') : false;
    
    if (!initiativesTableExists || !scansTableExists || !initiativeIdColumnExists || !collaboratorIdColumnExists) {
      return res.status(404).json({
        success: false,
        error: 'Tables ou colonnes manquantes',
        hint: 'Exécutez /api/scans/force-setup pour créer les tables'
      });
    }

    // Vérifier que l'initiative existe
    const initiativeCheck = await pool.query('SELECT name FROM initiatives WHERE id = $1', [initiative_id]);
    if (initiativeCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Initiative non trouvée'
      });
    }

    // Insérer le scan avec collaborator_id
    const insertQuery = `
      INSERT INTO scans (collaborator_id, initiative_id, signatures, quality, confidence, notes, scan_date, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(insertQuery, [
      userId,
      initiative_id,
      signatures,
      quality || 85,
      confidence || 85,
      notes || ''
    ]);

    const scan = result.rows[0];
    const initiativeName = initiativeCheck.rows[0].name;

    console.log(`✅ Scan créé: ID ${scan.id}, ${signatures} signatures pour ${initiativeName}`);

    res.json({
      success: true,
      message: `✅ Scan enregistré avec succès!`,
      scan: {
        id: scan.id,
        initiative: initiativeName,
        signatures: scan.signatures,
        quality: scan.quality,
        confidence: scan.confidence,
        timestamp: scan.scan_date
      },
      user: {
        userId: req.user.userId,
        firstName: req.user.firstName,
        email: req.user.email
      }
    });

  } catch (error) {
    console.error('❌ Erreur soumission scan:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/scans/force-setup - Configuration automatique de la base de données (INCHANGÉ)
router.get('/force-setup', async (req, res) => {
  try {
    console.log('🔧 === CONFIGURATION BASE DE DONNÉES ===');

    // 1. Créer table initiatives AVANT tout le reste
    console.log('🔧 Étape 1: Création table initiatives...');
    const createInitiativesTable = `
      CREATE TABLE IF NOT EXISTS initiatives (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        objective INTEGER DEFAULT 0,
        color VARCHAR(7) DEFAULT '#4ECDC4',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await pool.query(createInitiativesTable);
    console.log('✅ Table initiatives créée/vérifiée');

    // 2. Insérer les initiatives par défaut IMMÉDIATEMENT
    console.log('🔧 Étape 2: Insertion initiatives par défaut...');
    const existingInitiatives = await pool.query('SELECT COUNT(*) FROM initiatives');
    
    if (parseInt(existingInitiatives.rows[0].count) === 0) {
      const initiatives = [
        { name: 'Forêt', description: 'Protection des forêts', objective: 10000, color: '#2ECC71' },
        { name: 'Commune', description: 'Amélioration communale', objective: 5000, color: '#3498DB' },
        { name: 'Frontière', description: 'Gestion des frontières', objective: 7500, color: '#E74C3C' },
        { name: 'Santé', description: 'Système de santé', objective: 8000, color: '#F39C12' },
        { name: 'Éducation', description: 'Réforme éducation', objective: 6000, color: '#9B59B6' }
      ];

      for (const initiative of initiatives) {
        await pool.query(
          'INSERT INTO initiatives (name, description, objective, color) VALUES ($1, $2, $3, $4)',
          [initiative.name, initiative.description, initiative.objective, initiative.color]
        );
      }
      console.log(`✅ ${initiatives.length} initiatives créées`);
    } else {
      console.log('✅ Initiatives déjà existantes');
    }

    // 3. Maintenant créer table scans (qui référence initiatives)
    console.log('🔧 Étape 3: Création table scans...');
    const createScansTable = `
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        collaborator_id INTEGER REFERENCES collaborators(id),
        initiative_id INTEGER REFERENCES initiatives(id),
        signatures INTEGER NOT NULL DEFAULT 0,
        quality INTEGER DEFAULT 85,
        confidence INTEGER DEFAULT 85,
        notes TEXT,
        file_path VARCHAR(255),
        scan_date TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await pool.query(createScansTable);
    console.log('✅ Table scans créée/vérifiée');

    // 4. Attendre un peu pour que PostgreSQL reconnaisse la nouvelle structure
    console.log('🔧 Étape 4: Attente propagation schéma...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Attendre 2 secondes
    
    // 5. Vérifier que les colonnes existent vraiment
    console.log('🔧 Étape 5: Vérification des colonnes...');
    const initiativeIdExists = await columnExists('scans', 'initiative_id');
    const collaboratorIdExists = await columnExists('scans', 'collaborator_id');
    
    console.log(`🔍 Colonne initiative_id existe: ${initiativeIdExists}`);
    console.log(`🔍 Colonne collaborator_id existe: ${collaboratorIdExists}`);
    
    if (!initiativeIdExists || !collaboratorIdExists) {
      throw new Error('Les colonnes de la table scans n\'ont pas été créées correctement');
    }

    // 6. Créer des index pour optimiser les performances
    console.log('🔧 Étape 6: Création des index...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_scans_collaborator_id ON scans(collaborator_id)',
      'CREATE INDEX IF NOT EXISTS idx_scans_initiative_id ON scans(initiative_id)',
      'CREATE INDEX IF NOT EXISTS idx_scans_scan_date ON scans(scan_date)',
      'CREATE INDEX IF NOT EXISTS idx_initiatives_status ON initiatives(status)'
    ];

    for (const indexQuery of indexes) {
      await pool.query(indexQuery);
    }
    console.log('✅ Index créés/vérifiés');

    // 7. Maintenant on peut créer les scans de test en toute sécurité
    console.log('🔧 Étape 7: Insertion scans de test...');
    const existingScans = await pool.query('SELECT COUNT(*) FROM scans');
    
    if (parseInt(existingScans.rows[0].count) === 0) {
      // Récupérer les IDs des initiatives et utilisateurs APRÈS les avoir créées
      const initiativesIds = await pool.query('SELECT id FROM initiatives ORDER BY id ASC');
      const userIds = await pool.query('SELECT id FROM collaborators ORDER BY id DESC LIMIT 5');
      
      console.log(`🔍 Trouvé ${initiativesIds.rows.length} initiatives et ${userIds.rows.length} utilisateurs`);
      
      if (initiativesIds.rows.length > 0 && userIds.rows.length > 0) {
        console.log('🔧 Création de 30 scans de test...');
        
        // Créer les scans un par un pour éviter les problèmes de concurrence
        for (let i = 0; i < 30; i++) {
          const randomInitiative = initiativesIds.rows[Math.floor(Math.random() * initiativesIds.rows.length)];
          const randomUser = userIds.rows[Math.floor(Math.random() * userIds.rows.length)];
          const randomSignatures = Math.floor(Math.random() * 25) + 5; // Entre 5 et 30 signatures
          const randomQuality = Math.floor(Math.random() * 20) + 80; // Entre 80 et 100
          const daysAgo = Math.floor(Math.random() * 30); // Sur les 30 derniers jours
          
          try {
            await pool.query(`
              INSERT INTO scans (collaborator_id, initiative_id, signatures, quality, confidence, scan_date, created_at)
              VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '${daysAgo} days', NOW())
            `, [randomUser.id, randomInitiative.id, randomSignatures, randomQuality, randomQuality - 5]);
            
            if ((i + 1) % 10 === 0) {
              console.log(`🔧 ${i + 1}/30 scans créés...`);
            }
          } catch (error) {
            console.error(`❌ Erreur création scan ${i + 1}:`, error.message);
          }
        }
        console.log('✅ 30 scans de test créés');
      } else {
        console.log('⚠️ Pas d\'utilisateurs ou d\'initiatives pour créer des scans de test');
      }
    } else {
      console.log('✅ Scans déjà existants');
    }

    // 8. Statistiques finales
    console.log('🔧 Étape 8: Calcul des statistiques finales...');
    const stats = await Promise.all([
      pool.query('SELECT COUNT(*) FROM collaborators'),
      pool.query('SELECT COUNT(*) FROM initiatives'),
      pool.query('SELECT COUNT(*) FROM scans')
    ]);

    const collaboratorsCount = parseInt(stats[0].rows[0].count);
    const initiativesCount = parseInt(stats[1].rows[0].count);
    const scansCount = parseInt(stats[2].rows[0].count);

    console.log(`✅ Configuration terminée: ${collaboratorsCount} utilisateurs, ${initiativesCount} initiatives, ${scansCount} scans`);

    res.json({
      success: true,
      message: "🎉 Base de données KOLECT configurée avec succès!",
      tables: {
        created: ["initiatives", "scans"],
        indexed: ["collaborator_id", "initiative_id", "scan_date"],
        order: "1. initiatives → 2. données → 3. scans → 4. vérification → 5. index → 6. test data"
      },
      data: {
        collaborators: collaboratorsCount,
        initiatives: initiativesCount,
        scans: scansCount
      },
      verification: {
        initiative_id_column: await columnExists('scans', 'initiative_id'),
        collaborator_id_column: await columnExists('scans', 'collaborator_id'),
        initiatives_table: await tableExists('initiatives'),
        scans_table: await tableExists('scans')
      },
      initiatives: [
        "🌲 Forêt - Protection des forêts (10,000 signatures)",
        "🏘️ Commune - Amélioration communale (5,000 signatures)",
        "🚧 Frontière - Gestion des frontières (7,500 signatures)",
        "🏥 Santé - Système de santé (8,000 signatures)",
        "🎓 Éducation - Réforme éducation (6,000 signatures)"
      ],
      storage: {
        location: "/uploads/scans/",
        maxFileSize: "10MB",
        allowedTypes: ["JPG", "PNG", "WebP"],
        maxFiles: 5
      },
      endpoints: {
        debug: "/api/scans/debug/tables",
        admin: "/api/scans/admin",
        initiatives: "/api/scans/initiatives",
        history: "/api/scans/history",
        submit: "POST /api/scans/submit",
        personalStats: "GET /api/scans/personal-stats",
        personalHistory: "GET /api/scans/personal-history"
      },
      nextSteps: [
        "1. Tester l'interface debug: /api/scans/debug/tables",
        "2. Accéder à l'admin: /api/scans/admin",
        "3. Tester les endpoints API personnels",
        "4. Vérifier les données personnelles dans l'app mobile"
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur setup:', error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la configuration de la base de données",
      details: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/scans/debug/tables - Interface de debug sécurisée (INCHANGÉ)
router.get('/debug/tables', async (req, res) => {
  try {
    console.log('🔍 === DEBUG TABLES ===');

    // Récupérer les informations sur toutes les tables
    const tablesQuery = `
      SELECT 
        schemaname,
        tablename,
        tableowner
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

    const tablesResult = await pool.query(tablesQuery);
    const tablesList = [];

    // Pour chaque table, compter les entrées
    for (const table of tablesResult.rows) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) FROM ${table.tablename}`);
        tablesList.push({
          name: table.tablename,
          count: parseInt(countResult.rows[0].count),
          owner: table.tableowner
        });
      } catch (err) {
        tablesList.push({
          name: table.tablename,
          count: 'Erreur',
          owner: table.tableowner
        });
      }
    }

    // Récupérer des données spécifiques en vérifiant l'existence des tables
    const collaborators = [];
    const initiatives = [];
    const scans = [];

    try {
      const collabResult = await pool.query('SELECT id, first_name, last_name, email, status, created_at FROM collaborators ORDER BY id DESC LIMIT 10');
      collaborators.push(...collabResult.rows);
    } catch (err) {
      console.log('⚠️ Table collaborators non accessible');
    }

    // Vérifier si les tables existent avant les requêtes
    const initiativesExists = await tableExists('initiatives');
    const scansExists = await tableExists('scans');
    const initiativeIdExists = scansExists ? await columnExists('scans', 'initiative_id') : false;

    if (initiativesExists) {
      try {
        const initResult = await pool.query('SELECT * FROM initiatives ORDER BY id ASC');
        initiatives.push(...initResult.rows);
      } catch (err) {
        console.log('⚠️ Erreur lecture table initiatives:', err.message);
      }
    }

    if (scansExists && initiativesExists && initiativeIdExists) {
      try {
        const scansResult = await pool.query(`
          SELECT s.*, i.name as initiative_name, c.first_name, c.last_name 
          FROM scans s 
          LEFT JOIN initiatives i ON s.initiative_id = i.id 
          LEFT JOIN collaborators c ON s.collaborator_id = c.id 
          ORDER BY s.scan_date DESC 
          LIMIT 20
        `);
        scans.push(...scansResult.rows);
      } catch (err) {
        console.log('⚠️ Erreur lecture table scans:', err.message);
      }
    }

    // Créer une page HTML simple
    const debugHTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔍 KOLECT Debug</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: #4ECDC4; color: white; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 20px; }
        .section { background: white; padding: 20px; margin-bottom: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
        th { background: #35A085; color: white; }
        tr:nth-child(even) { background: #f9f9f9; }
        .stat { display: inline-block; background: #4ECDC4; color: white; padding: 10px 20px; margin: 5px; border-radius: 5px; font-weight: bold; }
        .alert { padding: 15px; margin: 10px 0; border-radius: 5px; }
        .alert-warning { background: #fff3cd; border: 1px solid #ffeeba; color: #856404; }
        .alert-success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
        .btn { padding: 10px 20px; margin: 5px; background: #4ECDC4; color: white; text-decoration: none; border-radius: 5px; display: inline-block; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 KOLECT Debug Interface</h1>
            <p>Base de données personnelles - ${new Date().toLocaleString('fr-FR')}</p>
        </div>

        ${!initiativesExists || !scansExists || !initiativeIdExists ? `
        <div class="alert alert-warning">
            <strong>⚠️ Problèmes détectés !</strong><br>
            ${!initiativesExists ? '❌ Table "initiatives" manquante<br>' : ''}
            ${!scansExists ? '❌ Table "scans" manquante<br>' : ''}
            ${scansExists && !initiativeIdExists ? '❌ Colonne "initiative_id" manquante dans table scans<br>' : ''}
            <a href="/api/scans/force-setup" class="btn">🔧 Corriger les problèmes</a>
        </div>
        ` : `
        <div class="alert alert-success">
            <strong>✅ Configuration parfaite !</strong><br>
            Toutes les tables et colonnes sont présentes pour les statistiques personnelles.
        </div>
        `}

        <div class="section">
            <h2>📊 Statistiques</h2>
            <div class="stat">👥 ${tablesList.find(t => t.name === 'collaborators')?.count || 0} Collaborateurs</div>
            <div class="stat">🎯 ${tablesList.find(t => t.name === 'initiatives')?.count || 0} Initiatives</div>
            <div class="stat">📸 ${tablesList.find(t => t.name === 'scans')?.count || 0} Scans personnels</div>
            <div class="stat">📋 ${tablesList.length} Tables</div>
        </div>

        <div class="section">
            <h2>📋 Tables de la Base</h2>
            <table>
                <thead>
                    <tr><th>Table</th><th>Entrées</th><th>Propriétaire</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${tablesList.map(table => `
                        <tr>
                            <td><strong>${table.name}</strong></td>
                            <td>${table.count}</td>
                            <td>${table.owner}</td>
                            <td>${['initiatives', 'scans'].includes(table.name) && table.count > 0 ? '✅ OK' : table.count === 0 ? '⚠️ Vide' : '📊 Données'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        ${initiatives.length > 0 ? `
        <div class="section">
            <h2>🎯 Initiatives Configurées</h2>
            <table>
                <thead>
                    <tr><th>ID</th><th>Nom</th><th>Description</th><th>Objectif</th><th>Couleur</th></tr>
                </thead>
                <tbody>
                    ${initiatives.map(init => `
                        <tr>
                            <td>${init.id}</td>
                            <td><strong>${init.name}</strong></td>
                            <td>${init.description || 'N/A'}</td>
                            <td>${init.objective || 0}</td>
                            <td style="background: ${init.color}; color: white; text-align: center;">${init.color}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}

        ${scans.length > 0 ? `
        <div class="section">
            <h2>📸 Scans Personnels Récents</h2>
            <table>
                <thead>
                    <tr><th>ID</th><th>Collecteur</th><th>Initiative</th><th>Signatures</th><th>Qualité</th><th>Date</th></tr>
                </thead>
                <tbody>
                    ${scans.map(scan => `
                        <tr>
                            <td>${scan.id}</td>
                            <td>${scan.first_name} ${scan.last_name}</td>
                            <td><strong>${scan.initiative_name}</strong></td>
                            <td><strong>${scan.signatures}</strong></td>
                            <td>${scan.quality}%</td>
                            <td>${new Date(scan.scan_date).toLocaleDateString('fr-FR')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}

        <div class="section">
            <h2>🔗 Actions Disponibles</h2>
            <div>
                <a href="/api/scans/force-setup" class="btn">🔧 Setup/Reconfigurer</a>
                <a href="/api/scans/admin" class="btn">🎯 Interface Admin</a>
                <a href="/api/health" class="btn">💚 Health Check</a>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    res.send(debugHTML);

  } catch (error) {
    console.error('❌ Erreur debug:', error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération des données de debug",
      details: error.message
    });
  }
});

// GET /api/scans/admin - Interface d'administration sécurisée (INCHANGÉ avec mention personnelles)
router.get('/admin', async (req, res) => {
  try {
    console.log('🎨 === INTERFACE ADMIN ===');

    // Vérifier les tables avant de faire les requêtes
    const initiativesExists = await tableExists('initiatives');
    const scansExists = await tableExists('scans');
    const collaboratorIdExists = scansExists ? await columnExists('scans', 'collaborator_id') : false;

    const adminHTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎯 KOLECT Admin</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1000px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; padding: 30px; border-radius: 15px; text-align: center; margin-bottom: 30px; }
        .section { background: white; padding: 20px; margin-bottom: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .btn { padding: 10px 20px; margin: 10px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; text-decoration: none; display: inline-block; }
        .btn-primary { background: #4ECDC4; color: white; }
        .btn-success { background: #27ae60; color: white; }
        .btn-danger { background: #e74c3c; color: white; }
        .actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .action-card { background: #f8f9fa; padding: 20px; border-radius: 10px; text-align: center; }
        .alert { padding: 15px; margin: 10px 0; border-radius: 5px; }
        .alert-warning { background: #fff3cd; border: 1px solid #ffeeba; color: #856404; }
        .alert-success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 KOLECT Admin</h1>
            <p>Interface d'administration - Statistiques Personnelles</p>
            <p style="font-size: 0.9rem;">Dernière mise à jour: ${new Date().toLocaleString('fr-FR')}</p>
        </div>

        ${!initiativesExists || !scansExists || !collaboratorIdExists ? `
        <div class="alert alert-warning">
            <h3>⚠️ Configuration Requise</h3>
            <p>Problèmes détectés :</p>
            <ul>
                ${!initiativesExists ? '<li>❌ Table "initiatives" non trouvée</li>' : ''}
                ${!scansExists ? '<li>❌ Table "scans" non trouvée</li>' : ''}
                ${scansExists && !collaboratorIdExists ? '<li>❌ Colonne "collaborator_id" manquante</li>' : ''}
            </ul>
            <p><strong>Action requise :</strong> Cliquez sur "Setup Database" pour corriger ces problèmes.</p>
        </div>
        ` : `
        <div class="alert alert-success">
            <h3>✅ Configuration Parfaite</h3>
            <p>Toutes les tables et colonnes sont présentes pour les statistiques personnelles !</p>
        </div>
        `}

        <div class="section">
            <h2>🔗 Interface de Gestion</h2>
            <div class="actions">
                <div class="action-card">
                    <h3>🔍 Debug Interface</h3>
                    <p>Voir toutes les données + diagnostic</p>
                    <a href="/api/scans/debug/tables" class="btn btn-primary">📊 Diagnostiquer</a>
                </div>
                
                <div class="action-card">
                    <h3>🔧 Setup Database</h3>
                    <p>Créer/corriger les tables et colonnes</p>
                    <a href="/api/scans/force-setup" class="btn btn-success">⚙️ Réparer</a>
                </div>
                
                <div class="action-card">
                    <h3>💚 Health Check</h3>
                    <p>Vérifier le statut du serveur</p>
                    <a href="/api/health" class="btn btn-primary">🩺 Status</a>
                </div>
                
                <div class="action-card">
                    <h3>📱 App Mobile</h3>
                    <p>Tester les endpoints API personnels</p>
                    <a href="/api/scans/personal-stats" class="btn btn-primary">🔗 Test API</a>
                    <small style="display: block; margin-top: 5px; color: #666;">
                        (Nécessite un token d'authentification)
                    </small>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>🔧 Diagnostic Technique</h2>
            <div style="text-align: left;">
                <h4>🔍 État actuel détecté :</h4>
                <ul>
                    <li>Table initiatives : ${initiativesExists ? '✅ Présente' : '❌ Manquante'}</li>
                    <li>Table scans : ${scansExists ? '✅ Présente' : '❌ Manquante'}</li>
                    <li>Colonne collaborator_id : ${collaboratorIdExists ? '✅ Présente' : '❌ Manquante'}</li>
                </ul>
                
                <h4>💡 Actions recommandées :</h4>
                <ol>
                    <li><strong>Setup Database</strong> → Corrige automatiquement tous les problèmes</li>
                    <li><strong>Debug Interface</strong> → Vérifie que tout fonctionne</li>
                    <li><strong>Test App Mobile</strong> → Confirme que les endpoints personnels marchent</li>
                </ol>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    res.send(adminHTML);

  } catch (error) {
    console.error('❌ Erreur interface admin:', error);
    res.status(500).json({
      success: false,
      error: "Erreur lors du chargement de l'interface admin",
      details: error.message
    });
  }
});

module.exports = router;
