const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// Configuration PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// =====================================
// 🔐 ENDPOINTS PERSONNELS AVEC user_id
// =====================================

// 📊 ENDPOINT: Statistiques personnelles par initiative
router.get('/personal-stats', authenticateToken, async (req, res) => {
  try {
    console.log('📊 === STATS PERSONNELLES ===');
    console.log('🔍 User ID:', req.user.id);

    // Récupérer les statistiques personnelles par initiative
    const personalStats = await pool.query(`
      SELECT 
        initiative,
        COUNT(*) as scan_count,
        SUM(signatures) as total_signatures,
        AVG(quality) as avg_quality,
        MAX(created_at) as last_scan
      FROM scans 
      WHERE user_id = $1 
      GROUP BY initiative
      ORDER BY total_signatures DESC
    `, [req.user.id]);

    // Statistiques globales personnelles
    const globalPersonalStats = await pool.query(`
      SELECT 
        COUNT(*) as total_scans,
        SUM(signatures) as total_signatures,
        AVG(quality) as avg_quality,
        COUNT(DISTINCT initiative) as initiatives_count,
        MAX(created_at) as last_activity
      FROM scans 
      WHERE user_id = $1
    `, [req.user.id]);

    const globalStats = globalPersonalStats.rows[0] || {
      total_scans: 0,
      total_signatures: 0,
      avg_quality: 0,
      initiatives_count: 0,
      last_activity: null
    };

    // Statistiques par initiative formatées
    const initiativeStats = personalStats.rows.map(stat => ({
      initiative: stat.initiative,
      scan_count: parseInt(stat.scan_count),
      total_signatures: parseInt(stat.total_signatures) || 0,
      avg_quality: Math.round(parseFloat(stat.avg_quality) || 0),
      last_scan: stat.last_scan
    }));

    console.log('✅ Stats personnelles calculées:', {
      total_signatures: globalStats.total_signatures,
      initiatives: initiativeStats.length
    });

    res.json({
      success: true,
      message: 'Statistiques personnelles récupérées',
      personal_stats: {
        global: {
          total_scans: parseInt(globalStats.total_scans),
          total_signatures: parseInt(globalStats.total_signatures) || 0,
          avg_quality: Math.round(parseFloat(globalStats.avg_quality) || 0),
          initiatives_count: parseInt(globalStats.initiatives_count),
          last_activity: globalStats.last_activity
        },
        by_initiative: initiativeStats
      },
      user_id: req.user.id,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur stats personnelles:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des statistiques personnelles',
      details: error.message
    });
  }
});

// 📅 ENDPOINT: Historique personnel des 30 derniers jours
router.get('/personal-history', authenticateToken, async (req, res) => {
  try {
    console.log('📅 === HISTORIQUE PERSONNEL ===');
    console.log('🔍 User ID:', req.user.id);

    // Récupérer l'historique des 30 derniers jours pour cet utilisateur
    const personalHistory = await pool.query(`
      SELECT 
        DATE(created_at) as scan_day,
        COUNT(*) as scan_count,
        SUM(signatures) as daily_signatures,
        AVG(quality) as avg_quality,
        STRING_AGG(DISTINCT initiative, ', ') as initiatives
      FROM scans 
      WHERE user_id = $1 
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY scan_day DESC
    `, [req.user.id]);

    // Statistiques de la période
    const periodStats = await pool.query(`
      SELECT 
        COUNT(DISTINCT DATE(created_at)) as active_days,
        COUNT(*) as total_scans,
        SUM(signatures) as total_signatures,
        AVG(signatures) as avg_signatures_per_scan,
        MAX(signatures) as best_day_signatures
      FROM scans 
      WHERE user_id = $1 
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
    `, [req.user.id]);

    const periodData = periodStats.rows[0] || {
      active_days: 0,
      total_scans: 0,
      total_signatures: 0,
      avg_signatures_per_scan: 0,
      best_day_signatures: 0
    };

    // Formatage des données historiques
    const historyData = personalHistory.rows.map(day => ({
      date: day.scan_day,
      scan_count: parseInt(day.scan_count),
      signatures: parseInt(day.daily_signatures) || 0,
      avg_quality: Math.round(parseFloat(day.avg_quality) || 0),
      initiatives: day.initiatives
    }));

    console.log('✅ Historique personnel calculé:', {
      days: historyData.length,
      total_signatures: periodData.total_signatures
    });

    res.json({
      success: true,
      message: 'Historique personnel récupéré',
      personal_history: {
        period_stats: {
          active_days: parseInt(periodData.active_days),
          total_scans: parseInt(periodData.total_scans),
          total_signatures: parseInt(periodData.total_signatures) || 0,
          avg_signatures_per_scan: Math.round(parseFloat(periodData.avg_signatures_per_scan) || 0),
          best_day_signatures: parseInt(periodData.best_day_signatures) || 0
        },
        daily_history: historyData
      },
      user_id: req.user.id,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur historique personnel:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération de l\'historique personnel',
      details: error.message
    });
  }
});

// 🔍 ENDPOINT: Détails d'un scan personnel
router.get('/personal-details/:scanId', authenticateToken, async (req, res) => {
  try {
    const { scanId } = req.params;
    console.log('🔍 === DÉTAILS SCAN PERSONNEL ===');
    console.log('🔍 User ID:', req.user.id, 'Scan ID:', scanId);

    // Vérifier que le scan appartient bien à cet utilisateur
    const scan = await pool.query(`
      SELECT 
        s.*,
        c.first_name,
        c.last_name,
        i.name as initiative_name,
        i.description as initiative_description
      FROM scans s
      LEFT JOIN collaborators c ON s.user_id = c.id
      LEFT JOIN initiatives i ON s.initiative_id = i.id
      WHERE s.id = $1 AND s.user_id = $2
    `, [scanId, req.user.id]);

    if (scan.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Scan non trouvé ou vous n\'avez pas accès à ce scan'
      });
    }

    const scanData = scan.rows[0];

    console.log('✅ Scan personnel trouvé:', {
      id: scanData.id,
      signatures: scanData.signatures,
      user_id: scanData.user_id
    });

    res.json({
      success: true,
      message: 'Détails du scan personnel récupérés',
      scan_details: {
        id: scanData.id,
        signatures: scanData.signatures,
        quality: scanData.quality,
        confidence: scanData.confidence,
        initiative: scanData.initiative,
        initiative_name: scanData.initiative_name,
        initiative_description: scanData.initiative_description,
        location: scanData.location,
        notes: scanData.notes,
        created_at: scanData.created_at,
        collaborator: {
          id: scanData.user_id,
          firstName: scanData.first_name,
          lastName: scanData.last_name
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur détails scan personnel:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des détails du scan',
      details: error.message
    });
  }
});

// 🗑️ ENDPOINT: Supprimer un scan personnel
router.delete('/personal/:scanId', authenticateToken, async (req, res) => {
  try {
    const { scanId } = req.params;
    console.log('🗑️ === SUPPRESSION SCAN PERSONNEL ===');
    console.log('🔍 User ID:', req.user.id, 'Scan ID:', scanId);

    // Vérifier que le scan appartient à l'utilisateur
    const scan = await pool.query(
      'SELECT * FROM scans WHERE id = $1 AND user_id = $2',
      [scanId, req.user.id]
    );

    if (scan.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Scan non trouvé ou vous n\'avez pas le droit de le supprimer'
      });
    }

    // Supprimer le scan
    await pool.query('DELETE FROM scans WHERE id = $1 AND user_id = $2', [scanId, req.user.id]);

    console.log('✅ Scan personnel supprimé:', scanId);

    res.json({
      success: true,
      message: 'Scan supprimé avec succès',
      deleted_scan_id: parseInt(scanId),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur suppression scan personnel:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la suppression du scan',
      details: error.message
    });
  }
});

// ✏️ ENDPOINT: Modifier les notes d'un scan personnel
router.put('/personal/:scanId/notes', authenticateToken, async (req, res) => {
  try {
    const { scanId } = req.params;
    const { notes, location } = req.body;
    console.log('✏️ === MODIFICATION NOTES SCAN PERSONNEL ===');
    console.log('🔍 User ID:', req.user.id, 'Scan ID:', scanId);

    // Vérifier que le scan appartient à l'utilisateur
    const scan = await pool.query(
      'SELECT * FROM scans WHERE id = $1 AND user_id = $2',
      [scanId, req.user.id]
    );

    if (scan.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Scan non trouvé ou vous n\'avez pas le droit de le modifier'
      });
    }

    // Mettre à jour les notes
    const result = await pool.query(`
      UPDATE scans 
      SET notes = $1, location = $2, updated_at = NOW()
      WHERE id = $3 AND user_id = $4
      RETURNING *
    `, [notes, location, scanId, req.user.id]);

    const updatedScan = result.rows[0];

    console.log('✅ Notes scan personnel mises à jour:', scanId);

    res.json({
      success: true,
      message: 'Notes du scan mises à jour avec succès',
      updated_scan: {
        id: updatedScan.id,
        notes: updatedScan.notes,
        location: updatedScan.location,
        updated_at: updatedScan.updated_at
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur modification notes scan personnel:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la modification des notes',
      details: error.message
    });
  }
});

// ========================================
// 🔄 ENDPOINTS EXISTANTS MODIFIÉS (user_id)
// ========================================

// 📊 ENDPOINT: Initiatives avec données personnelles
router.get('/initiatives', authenticateToken, async (req, res) => {
  try {
    console.log('📊 === INITIATIVES PERSONNELLES ===');
    console.log('🔍 User ID:', req.user.id);

    // Statistiques personnelles globales
    const personalGlobalStats = await pool.query(`
      SELECT 
        COUNT(*) as total_scans,
        SUM(signatures) as total_signatures,
        AVG(quality) as avg_quality,
        MAX(created_at) as last_scan_date
      FROM scans 
      WHERE user_id = $1
    `, [req.user.id]);

    const globalStats = personalGlobalStats.rows[0] || {
      total_scans: 0,
      total_signatures: 0,
      avg_quality: 0,
      last_scan_date: null
    };

    // Statistiques par initiative personnelles
    const personalInitiatives = await pool.query(`
      SELECT 
        initiative,
        COUNT(*) as scan_count,
        SUM(signatures) as total_signatures,
        AVG(quality) as avg_quality
      FROM scans 
      WHERE user_id = $1 
      GROUP BY initiative
      ORDER BY total_signatures DESC
    `, [req.user.id]);

    const initiativeData = personalInitiatives.rows.map(init => ({
      name: init.initiative,
      count: parseInt(init.scan_count),
      signatures: parseInt(init.total_signatures) || 0,
      avgQuality: Math.round(parseFloat(init.avg_quality) || 0)
    }));

    console.log('✅ Initiatives personnelles calculées:', {
      total_signatures: globalStats.total_signatures,
      initiatives_count: initiativeData.length
    });

    res.json({
      success: true,
      message: 'Données d\'initiatives personnelles récupérées',
      personal_data: {
        global_stats: {
          total_scans: parseInt(globalStats.total_scans),
          total_signatures: parseInt(globalStats.total_signatures) || 0,
          avg_quality: Math.round(parseFloat(globalStats.avg_quality) || 0),
          last_scan_date: globalStats.last_scan_date
        },
        initiatives: initiativeData
      },
      user_id: req.user.id,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur initiatives personnelles:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des données d\'initiatives personnelles',
      details: error.message
    });
  }
});

// 📅 ENDPOINT: Historique personnel (derniers 10 jours)
router.get('/history', authenticateToken, async (req, res) => {
  try {
    console.log('📅 === HISTORIQUE PERSONNEL ===');
    console.log('🔍 User ID:', req.user.id);

    // Historique personnel des 10 derniers jours
    const personalHistory = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as scan_count,
        SUM(signatures) as signatures
      FROM scans 
      WHERE user_id = $1
        AND created_at >= CURRENT_DATE - INTERVAL '10 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 10
    `, [req.user.id]);

    const historyData = personalHistory.rows.map(day => ({
      date: day.date,
      scans: parseInt(day.scan_count),
      signatures: parseInt(day.signatures) || 0
    }));

    // Compléter avec des jours à 0 si nécessaire
    const completeHistory = [];
    for (let i = 9; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayData = historyData.find(d => d.date === dateStr);
      completeHistory.push({
        date: dateStr,
        scans: dayData ? dayData.scans : 0,
        signatures: dayData ? dayData.signatures : 0
      });
    }

    console.log('✅ Historique personnel généré:', {
      days: completeHistory.length,
      total_signatures: completeHistory.reduce((sum, day) => sum + day.signatures, 0)
    });

    res.json({
      success: true,
      message: 'Historique personnel récupéré',
      personal_history: completeHistory,
      user_id: req.user.id,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur historique personnel:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération de l\'historique personnel',
      details: error.message
    });
  }
});

// ================================
// 📤 ENDPOINT SUBMIT CORRIGÉ
// ================================

// 📤 ENDPOINT: Submit scan (VERSION CORRIGÉE AVEC user_id)
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    console.log('📤 === SUBMIT SCAN AVEC user_id ===');
    console.log('🔍 User ID:', req.user.id);
    console.log('📦 Données reçues:', req.body);

    const { initiative_id, signatures, quality, confidence, location, notes } = req.body;
    
    // ✅ VALIDATION DES DONNÉES
    if (!initiative_id || signatures === undefined) {
      return res.status(400).json({
        success: false,
        error: 'initiative_id et signatures sont requis'
      });
    }

    // ✅ VÉRIFIER QUE L'INITIATIVE EXISTE
    const initiativeCheck = await pool.query(
      'SELECT id, name FROM initiatives WHERE id = $1',
      [initiative_id]
    );

    if (initiativeCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: `Initiative avec ID ${initiative_id} non trouvée`
      });
    }

    const initiative = initiativeCheck.rows[0];

    // ✅ INSÉRER LE SCAN AVEC user_id (PAS collaborator_id)
    const result = await pool.query(`
      INSERT INTO scans (
        user_id,           -- ✅ UTILISE user_id
        initiative_id, 
        initiative,        -- Pour compatibilité
        signatures, 
        quality, 
        confidence,
        location,
        notes,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `, [
      req.user.id,         // ✅ user_id depuis le token JWT
      initiative_id,
      initiative.name,     // Nom de l'initiative
      signatures,
      quality || 85,
      confidence || 85,
      location || 'Mobile App',
      notes
    ]);

    const savedScan = result.rows[0];

    // 📊 STATISTIQUES PERSONNELLES MISES À JOUR
    const personalStats = await pool.query(`
      SELECT 
        COUNT(*) as total_scans,
        SUM(signatures) as total_signatures,
        AVG(quality) as avg_quality
      FROM scans 
      WHERE user_id = $1
    `, [req.user.id]);

    const stats = personalStats.rows[0];

    console.log('✅ Scan sauvegardé avec user_id:', {
      scan_id: savedScan.id,
      user_id: savedScan.user_id,
      signatures: savedScan.signatures,
      total_personal_signatures: stats.total_signatures
    });

    // ✅ RÉPONSE SUCCÈS
    res.json({
      success: true,
      message: 'Scan soumis avec succès',
      scan: {
        id: savedScan.id,
        user_id: savedScan.user_id,
        initiative: savedScan.initiative,
        initiative_id: savedScan.initiative_id,
        signatures: savedScan.signatures,
        quality: savedScan.quality,
        confidence: savedScan.confidence,
        created_at: savedScan.created_at
      },
      personal_stats: {
        total_scans: parseInt(stats.total_scans),
        total_signatures: parseInt(stats.total_signatures) || 0,
        avg_quality: Math.round(parseFloat(stats.avg_quality) || 0)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur submit scan:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la soumission du scan',
      details: error.message
    });
  }
});

// =======================================
// 🔧 UTILITAIRES ET ENDPOINTS DE SETUP
// =======================================

// Fonction utilitaire pour vérifier l'existence d'une table
async function tableExists(tableName) {
  try {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error(`Erreur vérification table ${tableName}:`, error);
    return false;
  }
}

// Fonction utilitaire pour vérifier l'existence d'une colonne
async function columnExists(tableName, columnName) {
  try {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = $1 AND column_name = $2`,
      [tableName, columnName]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error(`Erreur vérification colonne ${tableName}.${columnName}:`, error);
    return false;
  }
}

// 🚀 ENDPOINT: Configuration forcée de la base de données
router.post('/force-setup', async (req, res) => {
  try {
    console.log('🚀 === CONFIGURATION FORCÉE BASE DE DONNÉES ===');
    
    const steps = [];
    const errors = [];

    // Vérifier les prérequis
    const scansTableExists = await tableExists('scans');
    const initiativesTableExists = await tableExists('initiatives');
    const initiativeIdColumnExists = scansTableExists ? await columnExists('scans', 'initiative_id') : false;
    const userIdColumnExists = scansTableExists ? await columnExists('scans', 'user_id') : false;
    
    if (!initiativesTableExists || !scansTableExists || !userIdColumnExists) {
      throw new Error('Les tables de base ou les colonnes user_id n\'existent pas. Exécutez d\'abord /api/debug/fix-database');
    }

    steps.push('✅ Vérification des prérequis: Tables et colonnes user_id existent');

    // Si initiative_id n'existe pas, l'ajouter
    if (!initiativeIdColumnExists) {
      await pool.query('ALTER TABLE scans ADD COLUMN initiative_id INTEGER');
      steps.push('✅ Colonne initiative_id ajoutée à la table scans');
    }

    // Créer la contrainte de clé étrangère si elle n'existe pas
    try {
      await pool.query(`
        ALTER TABLE scans 
        ADD CONSTRAINT fk_scans_initiative 
        FOREIGN KEY (initiative_id) REFERENCES initiatives(id) 
        ON DELETE SET NULL
      `);
      steps.push('✅ Contrainte de clé étrangère ajoutée');
    } catch (constraintError) {
      if (constraintError.message.includes('already exists')) {
        steps.push('⚠️ Contrainte de clé étrangère existe déjà');
      } else {
        errors.push(`Erreur contrainte: ${constraintError.message}`);
      }
    }

    console.log('✅ Configuration forcée terminée avec succès');

    res.json({
      success: true,
      message: 'Configuration de la base de données terminée',
      steps: steps,
      errors: errors.length > 0 ? errors : null,
      verification: {
        initiatives_table: await tableExists('initiatives'),
        scans_table: await tableExists('scans'),
        user_id_column: await columnExists('scans', 'user_id'),
        initiative_id_column: await columnExists('scans', 'initiative_id')
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur configuration forcée:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la configuration de la base de données',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
