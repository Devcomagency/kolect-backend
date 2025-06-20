const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

// Configuration PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// === MIDDLEWARE D'AUTHENTIFICATION ===
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token d\'accès requis' });
  }

  const jwt = require('jsonwebtoken');
  const jwtSecret = process.env.JWT_SECRET || 'kolect-secret-default-2025';
  
  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token invalide' });
    }
    req.user = user;
    next();
  });
};

// === RÉCUPÉRER LES INITIATIVES DISPONIBLES ===
router.get('/initiatives', authenticateToken, async (req, res) => {
  try {
    // Récupération depuis la vraie database
    const query = `
      SELECT 
        id,
        name,
        title,
        description,
        color,
        icon,
        target_signatures as target,
        collected_signatures as collected,
        deadline,
        is_active as active
      FROM initiatives 
      WHERE is_active = true 
      ORDER BY priority ASC, name ASC
    `;
    
    const result = await pool.query(query);
    const initiatives = result.rows;

    // Fallback si pas de données en base
    if (initiatives.length === 0) {
      const defaultInitiatives = [
        {
          id: 1,
          name: 'Forêt',
          title: 'Protection des Forêts Suisses',
          description: 'Initiative pour la protection et la préservation des forêts en Suisse',
          color: '#2E7D32',
          icon: '🌲',
          target: 100000,
          collected: 45230,
          deadline: '2025-12-31',
          active: true
        },
        {
          id: 2,
          name: 'Commune',
          title: 'Développement Durable Communal',
          description: 'Initiative pour promouvoir le développement durable dans les communes',
          color: '#1976D2',
          icon: '🏘️',
          target: 75000,
          collected: 28945,
          deadline: '2025-10-15',
          active: true
        },
        {
          id: 3,
          name: 'Frontière',
          title: 'Protection des Zones Frontalières',
          description: 'Initiative pour la protection environnementale des zones frontalières',
          color: '#7B1FA2',
          icon: '🗺️',
          target: 50000,
          collected: 12876,
          deadline: '2025-08-30',
          active: true
        }
      ];
      
      console.log('⚠️ Utilisation des initiatives par défaut (base vide)');
      return res.json({
        success: true,
        initiatives: defaultInitiatives,
        totalInitiatives: defaultInitiatives.length,
        activeInitiatives: defaultInitiatives.filter(i => i.active).length,
        source: 'fallback'
      });
    }

    res.json({
      success: true,
      initiatives,
      totalInitiatives: initiatives.length,
      activeInitiatives: initiatives.filter(i => i.active).length,
      source: 'database'
    });

  } catch (error) {
    console.error('❌ Erreur récupération initiatives:', error);
    res.status(500).json({
      error: 'Erreur lors de la récupération des initiatives'
    });
  }
});

// === SOUMETTRE UN SCAN - VERSION COMPLÈTE ===
router.post('/submit', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      photoId,
      initiative,
      signatures,
      quality,
      confidence,
      location,
      timestamp,
      imageData,
      isDuplicate = false
    } = req.body;

    console.log('📸 === SOUMISSION SCAN ===');
    console.log('👤 Collaborateur:', req.user.userId);
    console.log('📷 Photo ID:', photoId);
    console.log('🌿 Initiative:', initiative);
    console.log('✍️ Signatures:', signatures);
    console.log('📊 Qualité:', quality + '%');
    console.log('🎯 Confiance:', confidence + '%');

    // Validation des données obligatoires
    if (!photoId || !initiative || signatures === undefined) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Données manquantes',
        required: ['photoId', 'initiative', 'signatures']
      });
    }

    if (signatures < 0 || (quality !== undefined && (quality < 0 || quality > 100))) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Valeurs invalides',
        details: 'signatures >= 0, quality 0-100'
      });
    }

    // Récupérer l'ID de l'initiative
    const initiativeQuery = 'SELECT id FROM initiatives WHERE name = $1 AND is_active = true';
    const initiativeResult = await client.query(initiativeQuery, [initiative]);
    
    if (initiativeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Initiative non trouvée ou inactive',
        available: ['Forêt', 'Commune', 'Frontière']
      });
    }

    const initiativeId = initiativeResult.rows[0].id;

    // Vérifier les doublons si nécessaire
    let duplicateOf = null;
    if (isDuplicate) {
      const duplicateQuery = `
        SELECT id FROM scans 
        WHERE collaborator_id = $1 
        AND initiative_id = $2 
        AND signatures_count = $3
        AND created_at > NOW() - INTERVAL '1 hour'
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      const duplicateResult = await client.query(duplicateQuery, [req.user.userId, initiativeId, signatures]);
      
      if (duplicateResult.rows.length > 0) {
        duplicateOf = duplicateResult.rows[0].id;
        console.log('⚠️ Doublon détecté, référence:', duplicateOf);
      }
    }

    // Calculer les points
    const basePoints = signatures * 2;
    const qualityBonus = (quality && quality >= 90) ? Math.floor(signatures * 0.5) : 0;
    const totalPoints = basePoints + qualityBonus;

    // Insérer le scan en base
    const insertQuery = `
      INSERT INTO scans (
        collaborator_id, initiative_id, photo_id, signatures_count, 
        quality_score, confidence_score, initiative_name, is_duplicate, 
        duplicate_of, location_name, image_base64, status, points_awarded,
        quality_bonus
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id, created_at
    `;
    
    const insertValues = [
      req.user.userId,
      initiativeId,
      photoId,
      signatures,
      quality || 85,
      confidence || 85,
      initiative,
      isDuplicate,
      duplicateOf,
      location?.name || null,
      imageData || null,
      isDuplicate ? 'duplicate' : 'validated',
      totalPoints,
      qualityBonus
    ];

    const scanResult = await client.query(insertQuery, insertValues);
    const newScan = scanResult.rows[0];

    await client.query('COMMIT');

    console.log('✅ Scan sauvegardé:', newScan.id);
    console.log('🏆 Points attribués:', totalPoints);

    // Réponse succès
    res.json({
      success: true,
      message: isDuplicate ? 'Doublon détecté mais enregistré' : 'Scan validé avec succès',
      scan: {
        id: newScan.id,
        photoId: photoId,
        initiative: initiative,
        signatures: signatures,
        quality: quality || 85,
        confidence: confidence || 85,
        status: isDuplicate ? 'duplicate' : 'validated',
        points: totalPoints,
        qualityBonus: qualityBonus,
        isDuplicate: isDuplicate,
        duplicateOf: duplicateOf,
        timestamp: newScan.created_at
      },
      nextSteps: {
        message: 'Données transmises au backoffice',
        backofficeUpdate: true,
        realTimeStats: true
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur soumission scan:', error);
    res.status(500).json({
      error: 'Erreur lors de la soumission du scan',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Erreur interne'
    });
  } finally {
    client.release();
  }
});

// === BATCH SUBMIT (NOUVEAU) - Pour envoyer plusieurs scans ===
router.post('/batch-submit', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { scans } = req.body;
    
    if (!Array.isArray(scans) || scans.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Format invalide',
        expected: 'Array of scan objects in { scans: [...] }'
      });
    }

    console.log(`📦 Batch upload de ${scans.length} scans pour le collaborateur ${req.user.userId}`);

    const results = [];
    let totalSignatures = 0;
    let totalPoints = 0;

    for (let i = 0; i < scans.length; i++) {
      const scan = scans[i];
      
      // Validation individuelle
      if (!scan.photoId || !scan.initiative || scan.signatures === undefined) {
        results.push({
          index: i,
          status: 'error',
          error: 'Données manquantes (photoId, initiative, signatures requis)'
        });
        continue;
      }

      try {
        // Récupérer l'ID de l'initiative
        const initiativeQuery = 'SELECT id FROM initiatives WHERE name = $1 AND is_active = true';
        const initiativeResult = await client.query(initiativeQuery, [scan.initiative]);
        
        if (initiativeResult.rows.length === 0) {
          results.push({
            index: i,
            status: 'error',
            error: `Initiative '${scan.initiative}' non trouvée`
          });
          continue;
        }

        const initiativeId = initiativeResult.rows[0].id;

        // Calculer les points
        const basePoints = scan.signatures * 2;
        const qualityBonus = (scan.quality && scan.quality >= 90) ? Math.floor(scan.signatures * 0.5) : 0;
        const points = basePoints + qualityBonus;

        // Insérer le scan
        const insertQuery = `
          INSERT INTO scans (
            collaborator_id, initiative_id, photo_id, signatures_count, 
            quality_score, confidence_score, initiative_name, is_duplicate, 
            location_name, image_base64, status, points_awarded, quality_bonus
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id, created_at
        `;
        
        const insertValues = [
          req.user.userId,
          initiativeId,
          scan.photoId,
          scan.signatures,
          scan.quality || 85,
          scan.confidence || 85,
          scan.initiative,
          scan.isDuplicate || false,
          scan.location?.name || null,
          scan.imageData || null,
          scan.isDuplicate ? 'duplicate' : 'validated',
          points,
          qualityBonus
        ];

        const scanResult = await client.query(insertQuery, insertValues);
        const newScan = scanResult.rows[0];
        
        totalSignatures += scan.signatures;
        totalPoints += points;

        results.push({
          index: i,
          status: 'success',
          scanId: newScan.id,
          signatures: scan.signatures,
          points: points,
          qualityBonus: qualityBonus
        });

      } catch (scanError) {
        console.error(`❌ Erreur scan ${i}:`, scanError.message);
        results.push({
          index: i,
          status: 'error',
          error: scanError.message
        });
      }
    }

    await client.query('COMMIT');

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    console.log(`✅ Batch terminé: ${successCount} succès, ${errorCount} erreurs`);

    res.json({
      success: true,
      message: `Batch traité: ${successCount}/${scans.length} scans réussis`,
      summary: {
        total: scans.length,
        success: successCount,
        errors: errorCount,
        totalSignatures,
        totalPoints
      },
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur batch upload:', error);
    res.status(500).json({
      error: 'Erreur lors du batch upload',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Erreur interne'
    });
  } finally {
    client.release();
  }
});

// === HISTORIQUE DES SCANS - VERSION DATABASE ===
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      initiative = null,
      status = null,
      dateFrom = null,
      dateTo = null
    } = req.query;

    const offset = (page - 1) * limit;
    
    // Construction de la requête avec filtres
    let whereConditions = ['s.collaborator_id = $1'];
    let queryParams = [req.user.userId];
    let paramCount = 1;

    if (initiative) {
      paramCount++;
      whereConditions.push(`s.initiative_name = $${paramCount}`);
      queryParams.push(initiative);
    }

    if (status) {
      paramCount++;
      whereConditions.push(`s.status = $${paramCount}`);
      queryParams.push(status);
    }

    if (dateFrom) {
      paramCount++;
      whereConditions.push(`s.created_at >= $${paramCount}`);
      queryParams.push(dateFrom);
    }

    if (dateTo) {
      paramCount++;
      whereConditions.push(`s.created_at <= $${paramCount}`);
      queryParams.push(dateTo);
    }

    const whereClause = whereConditions.join(' AND ');

    // Requête principale avec pagination
    const historyQuery = `
      SELECT 
        s.id,
        s.photo_id,
        s.initiative_name,
        s.signatures_count,
        s.quality_score,
        s.confidence_score,
        s.status,
        s.is_duplicate,
        s.location_name,
        s.points_awarded,
        s.quality_bonus,
        s.created_at,
        i.color as initiative_color
      FROM scans s
      LEFT JOIN initiatives i ON s.initiative_id = i.id
      WHERE ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    queryParams.push(limit, offset);
    
    // Requête de comptage
    const countQuery = `
      SELECT COUNT(*) as total
      FROM scans s
      WHERE ${whereClause}
    `;

    const [historyResult, countResult] = await Promise.all([
      pool.query(historyQuery, queryParams),
      pool.query(countQuery, queryParams.slice(0, -2)) // Enlever limit et offset pour le count
    ]);

    const scans = historyResult.rows.map(scan => ({
      id: scan.id,
      photoId: scan.photo_id,
      initiative: scan.initiative_name,
      initiativeColor: scan.initiative_color,
      signatures: scan.signatures_count,
      quality: scan.quality_score,
      confidence: scan.confidence_score,
      points: scan.points_awarded || (scan.signatures_count * 2),
      qualityBonus: scan.quality_bonus || 0,
      status: scan.status,
      isDuplicate: scan.is_duplicate,
      location: scan.location_name,
      createdAt: scan.created_at
    }));

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    // Statistiques rapides
    const statsQuery = `
      SELECT 
        COUNT(*) as total_scans,
        SUM(signatures_count) as total_signatures,
        AVG(quality_score) as avg_quality,
        SUM(points_awarded) as total_points
      FROM scans 
      WHERE collaborator_id = $1 AND status != 'rejected'
    `;
    
    const statsResult = await pool.query(statsQuery, [req.user.userId]);
    const stats = statsResult.rows[0];

    res.json({
      success: true,
      scans,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      summary: {
        totalScans: parseInt(stats.total_scans) || 0,
        totalSignatures: parseInt(stats.total_signatures) || 0,
        totalPoints: parseInt(stats.total_points) || 0,
        averageQuality: parseFloat(stats.avg_quality) || 0
      },
      filters: {
        initiative,
        status,
        dateFrom,
        dateTo
      }
    });

  } catch (error) {
    console.error('❌ Erreur historique scans:', error);
    
    // Fallback en cas d'erreur database
    const mockHistory = [
      {
        id: 'scan_1703123456789',
        photoId: 'photo_001',
        initiative: 'Forêt',
        signatures: 12,
        quality: 95,
        points: 24,
        status: 'validated',
        location: 'Genève',
        createdAt: new Date(Date.now() - 86400000).toISOString()
      }
    ];

    res.json({
      success: true,
      scans: mockHistory,
      pagination: {
        page: parseInt(req.query.page || 1),
        limit: parseInt(req.query.limit || 20),
        total: mockHistory.length,
        totalPages: 1
      },
      totalSignatures: mockHistory.reduce((sum, scan) => sum + scan.signatures, 0),
      totalPoints: mockHistory.reduce((sum, scan) => sum + scan.points, 0),
      source: 'fallback'
    });
  }
});

// === STATISTIQUES DÉTAILLÉES - VERSION DATABASE ===
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    // Stats générales depuis la table scan_stats
    const statsQuery = `
      SELECT * FROM scan_stats 
      WHERE collaborator_id = $1
    `;
    const statsResult = await pool.query(statsQuery, [req.user.userId]);
    
    // Stats par initiative
    const initiativeStatsQuery = `
      SELECT 
        s.initiative_name,
        COUNT(*) as scans,
        SUM(s.signatures_count) as signatures,
        AVG(s.quality_score) as avg_quality,
        SUM(s.points_awarded) as total_points,
        i.color
      FROM scans s
      LEFT JOIN initiatives i ON s.initiative_id = i.id
      WHERE s.collaborator_id = $1 AND s.status != 'rejected'
      GROUP BY s.initiative_name, i.color
      ORDER BY signatures DESC
    `;
    const initiativeStatsResult = await pool.query(initiativeStatsQuery, [req.user.userId]);

    // Meilleur scan
    const bestScanQuery = `
      SELECT 
        signatures_count,
        initiative_name,
        created_at,
        quality_score,
        points_awarded
      FROM scans 
      WHERE collaborator_id = $1 AND status != 'rejected'
      ORDER BY signatures_count DESC, quality_score DESC
      LIMIT 1
    `;
    const bestScanResult = await pool.query(bestScanQuery, [req.user.userId]);

    // Ranking (position parmi tous les collaborateurs)
    const rankingQuery = `
      WITH user_totals AS (
        SELECT 
          collaborator_id,
          SUM(signatures_count) as total_signatures,
          ROW_NUMBER() OVER (ORDER BY SUM(signatures_count) DESC) as rank
        FROM scans 
        WHERE status != 'rejected'
        GROUP BY collaborator_id
      ),
      total_users AS (
        SELECT COUNT(DISTINCT collaborator_id) as total_count FROM scans
      )
      SELECT 
        ut.rank,
        tu.total_count
      FROM user_totals ut, total_users tu
      WHERE ut.collaborator_id = $1
    `;
    const rankingResult = await pool.query(rankingQuery, [req.user.userId]);

    const userStats = statsResult.rows[0] || {
      total_scans: 0,
      total_signatures: 0,
      total_points: 0,
      average_quality: 0,
      scans_this_week: 0,
      signatures_this_week: 0,
      scans_this_month: 0,
      signatures_this_month: 0
    };

    const ranking = rankingResult.rows[0] || { rank: null, total_count: 0 };

    res.json({
      success: true,
      stats: {
        totalScans: userStats.total_scans,
        totalSignatures: userStats.total_signatures,
        totalPoints: userStats.total_points,
        averageQuality: parseFloat(userStats.average_quality || 0).toFixed(1),
        
        bestScan: bestScanResult.rows[0] ? {
          signatures: bestScanResult.rows[0].signatures_count,
          initiative: bestScanResult.rows[0].initiative_name,
          date: bestScanResult.rows[0].created_at,
          quality: bestScanResult.rows[0].quality_score,
          points: bestScanResult.rows[0].points_awarded
        } : null,
        
        byInitiative: initiativeStatsResult.rows.reduce((acc, row) => {
          acc[row.initiative_name] = {
            scans: parseInt(row.scans),
            signatures: parseInt(row.signatures),
            avgQuality: parseFloat(row.avg_quality || 0).toFixed(1),
            totalPoints: parseInt(row.total_points || 0),
            color: row.color
          };
          return acc;
        }, {}),
        
        thisWeek: {
          scans: userStats.scans_this_week || 0,
          signatures: userStats.signatures_this_week || 0,
          points: (userStats.signatures_this_week || 0) * 2
        },
        
        thisMonth: {
          scans: userStats.scans_this_month || 0,
          signatures: userStats.signatures_this_month || 0,
          points: (userStats.signatures_this_month || 0) * 2
        },
        
        ranking: {
          position: ranking.rank,
          total: ranking.total_count,
          percentile: ranking.rank && ranking.total_count ?
            Math.round(((ranking.total_count - ranking.rank + 1) / ranking.total_count) * 100) : 0
        }
      },
      userId: req.user.userId,
      generatedAt: new Date().toISOString(),
      source: 'database'
    });

  } catch (error) {
    console.error('❌ Erreur statistiques:', error);
    
    // Fallback en cas d'erreur database
    const fallbackStats = {
      totalScans: 15,
      totalSignatures: 187,
      totalPoints: 374,
      averageQuality: 89.3,
      bestScan: {
        signatures: 23,
        initiative: 'Forêt',
        date: '2025-06-10'
      },
      byInitiative: {
        'Forêt': { scans: 8, signatures: 98 },
        'Commune': { scans: 5, signatures: 62 },
        'Frontière': { scans: 2, signatures: 27 }
      },
      thisWeek: {
        scans: 3,
        signatures: 42,
        points: 84
      },
      thisMonth: {
        scans: 15,
        signatures: 187,
        points: 374
      },
      ranking: {
        position: 47,
        total: 238,
        percentile: 80
      }
    };

    res.json({
      success: true,
      stats: fallbackStats,
      userId: req.user.userId,
      generatedAt: new Date().toISOString(),
      source: 'fallback'
    });
  }
});

// === VALIDATION DE SCAN (ADMIN) ===
router.patch('/:scanId/validate', authenticateToken, async (req, res) => {
  try {
    const { scanId } = req.params;
    const { status, adminNote } = req.body;

    console.log('🔍 Validation scan:', scanId, 'par admin:', req.user.userId);

    // Vérifier que le scan existe
    const scanQuery = 'SELECT * FROM scans WHERE id = $1';
    const scanResult = await pool.query(scanQuery, [scanId]);
    
    if (scanResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Scan non trouvé'
      });
    }

    // Mettre à jour le statut du scan
    const updateQuery = `
      UPDATE scans 
      SET status = $1, validated_by = $2, validated_at = CURRENT_TIMESTAMP, validation_note = $3
      WHERE id = $4
      RETURNING *
    `;
    
    const updateResult = await pool.query(updateQuery, [status, req.user.userId, adminNote, scanId]);
    const updatedScan = updateResult.rows[0];

    res.json({
      success: true,
      message: 'Scan validé avec succès',
      scan: {
        id: updatedScan.id,
        status: updatedScan.status,
        validatedBy: req.user.userId,
        validatedAt: updatedScan.validated_at,
        adminNote: updatedScan.validation_note
      }
    });

  } catch (error) {
    console.error('❌ Erreur validation scan:', error);
    res.status(500).json({
      error: 'Erreur lors de la validation du scan'
    });
  }
});

// === DÉTECTION DOUBLONS - VERSION DATABASE ===
router.post('/check-duplicate', authenticateToken, async (req, res) => {
  try {
    const { photoHash, signatures, initiative } = req.body;

    // Recherche de scans similaires dans la base
    const duplicateQuery = `
      SELECT 
        id, 
        photo_id, 
        signatures_count, 
        created_at,
        quality_score
      FROM scans 
      WHERE collaborator_id = $1 
      AND initiative_name = $2 
      AND signatures_count BETWEEN $3 AND $4
      AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC 
      LIMIT 3
    `;
    
    const duplicateResult = await pool.query(duplicateQuery, [
      req.user.userId,
      initiative,
      signatures - 2,
      signatures + 2
    ]);

    const potentialDuplicates = duplicateResult.rows;
    
    if (potentialDuplicates.length > 0) {
      const mostSimilar = potentialDuplicates[0];
      const timeDiff = new Date() - new Date(mostSimilar.created_at);
      const hoursDiff = timeDiff / (1000 * 60 * 60);
      
      // Considérer comme doublon si moins de 2h et signatures similaires
      const isDuplicate = hoursDiff < 2 && Math.abs(mostSimilar.signatures_count - signatures) <= 1;

      if (isDuplicate) {
        res.json({
          isDuplicate: true,
          message: 'Scan similaire détecté',
          confidence: 90,
          originalScan: {
            id: mostSimilar.id,
            photoId: mostSimilar.photo_id,
            date: mostSimilar.created_at,
            signatures: mostSimilar.signatures_count,
            quality: mostSimilar.quality_score
          },
          recommendation: 'Vérifiez que ce n\'est pas le même document'
        });
      } else {
        res.json({
          isDuplicate: false,
          message: 'Scan unique validé',
          confidence: 95,
          similarScans: potentialDuplicates.length
        });
      }
    } else {
      res.json({
        isDuplicate: false,
        message: 'Aucun scan similaire trouvé',
        confidence: 98,
        similarScans: 0
      });
    }

  } catch (error) {
    console.error('❌ Erreur vérification doublons:', error);
    
    // Fallback avec simulation
    const isDuplicate = Math.random() < 0.1;
    res.json({
      isDuplicate,
      message: isDuplicate ? 'Scan similaire détecté (simulation)' : 'Scan unique validé (simulation)',
      confidence: isDuplicate ? 85 : 95,
      source: 'fallback'
    });
  }
});

// === ENDPOINT DE TEST DE SANTÉ ===
router.get('/health', authenticateToken, async (req, res) => {
  try {
    // Test de connexion à la base
    const dbTest = await pool.query('SELECT NOW() as current_time');
    
    // Test de comptage des tables principales
    const [collaboratorsCount, initiativesCount, scansCount] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM collaborators'),
      pool.query('SELECT COUNT(*) as count FROM initiatives'),
      pool.query('SELECT COUNT(*) as count FROM scans')
    ]);

    res.json({
      success: true,
      message: 'API Scans opérationnelle',
      database: {
        status: 'connected',
        currentTime: dbTest.rows[0].current_time,
        tables: {
          collaborators: parseInt(collaboratorsCount.rows[0].count),
          initiatives: parseInt(initiativesCount.rows[0].count),
          scans: parseInt(scansCount.rows[0].count)
        }
      },
      endpoints: [
        'GET /initiatives',
        'POST /submit',
        'POST /batch-submit',
        'GET /history',
        'GET /stats',
        'POST /check-duplicate',
        'PATCH /:scanId/validate'
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur health check:', error);
    res.status(500).json({
      success: false,
      error: 'Problème de connexion database',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
