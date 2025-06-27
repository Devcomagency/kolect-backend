const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { verifyAdmin } = require('../../middleware/adminAuth');

// GET /api/admin/activity/detailed - Activité détaillée avec filtres avancés
router.get('/detailed', verifyAdmin, async (req, res) => {
    try {
        const {
            collaborator_id,
            date_from,
            date_to,
            initiative,
            group_by = 'day', // day, week, month
            limit = 100,
            offset = 0
        } = req.query;

        console.log('📊 Récupération activité détaillée avec filtres:', {
            collaborator_id, date_from, date_to, initiative, group_by
        });

        // Configuration du groupement temporel
        let dateGroupBy, dateFormat;
        switch(group_by) {
            case 'week':
                dateGroupBy = "DATE_TRUNC('week', s.created_at)";
                dateFormat = "TO_CHAR(DATE_TRUNC('week', s.created_at), 'YYYY-\"W\"WW')";
                break;
            case 'month':
                dateGroupBy = "DATE_TRUNC('month', s.created_at)";
                dateFormat = "TO_CHAR(DATE_TRUNC('month', s.created_at), 'YYYY-MM')";
                break;
            default: // day
                dateGroupBy = "DATE(s.created_at)";
                dateFormat = "TO_CHAR(DATE(s.created_at), 'YYYY-MM-DD')";
        }

        // Construction des conditions WHERE
        let whereConditions = ['1=1'];
        let queryParams = [];
        let paramCount = 0;

        if (collaborator_id && collaborator_id !== 'all') {
            paramCount++;
            whereConditions.push(`(s.collaborator_id = $${paramCount} OR s.user_id = $${paramCount})`);
            queryParams.push(collaborator_id);
        }

        if (date_from) {
            paramCount++;
            whereConditions.push(`s.created_at >= $${paramCount}`);
            queryParams.push(date_from);
        }

        if (date_to) {
            paramCount++;
            whereConditions.push(`s.created_at <= $${paramCount}::date + INTERVAL '1 day'`);
            queryParams.push(date_to);
        }

        if (initiative && initiative !== 'all') {
            paramCount++;
            whereConditions.push(`s.initiative = $${paramCount}`);
            queryParams.push(initiative);
        }

        // Requête principale pour l'activité détaillée
        const activity = await pool.query(`
            SELECT 
                ${dateGroupBy} as period,
                ${dateFormat} as period_formatted,
                s.initiative,
                c.id as collaborator_id,
                COALESCE(c.first_name || ' ' || c.last_name, c.email, 'Collaborateur #' || c.id) as collaborator_name,
                c.email as collaborator_email,
                COUNT(s.id) as total_scans,
                COALESCE(SUM(s.signatures), 0) as total_signatures,
                ROUND(AVG(s.quality), 1) as avg_quality,
                ROUND(AVG(s.confidence), 1) as avg_confidence,
                MIN(s.created_at) as first_scan_time,
                MAX(s.created_at) as last_scan_time,
                COUNT(s.id) FILTER (WHERE s.verified = TRUE) as verified_scans,
                COUNT(s.id) FILTER (WHERE EXISTS(
                    SELECT 1 FROM doubtful_scans ds WHERE ds.id = s.id
                )) as doubtful_scans
            FROM scans s
            LEFT JOIN collaborators c ON c.id = COALESCE(s.collaborator_id, s.user_id)
            WHERE ${whereConditions.join(' AND ')}
            GROUP BY ${dateGroupBy}, s.initiative, c.id, c.first_name, c.last_name, c.email
            ORDER BY period DESC, total_signatures DESC
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `, [...queryParams, parseInt(limit), parseInt(offset)]);

        // Totaux globaux par période
        const totals = await pool.query(`
            SELECT 
                ${dateGroupBy} as period,
                ${dateFormat} as period_formatted,
                COUNT(s.id) as total_scans,
                COALESCE(SUM(s.signatures), 0) as total_signatures,
                COUNT(DISTINCT COALESCE(s.collaborator_id, s.user_id)) as active_collaborators,
                COUNT(DISTINCT s.initiative) as active_initiatives,
                ROUND(AVG(s.quality), 1) as avg_quality,
                ROUND(AVG(s.confidence), 1) as avg_confidence
            FROM scans s
            LEFT JOIN collaborators c ON c.id = COALESCE(s.collaborator_id, s.user_id)
            WHERE ${whereConditions.join(' AND ')}
            GROUP BY ${dateGroupBy}
            ORDER BY period DESC
        `, queryParams);

        // Compter le total pour pagination
        const countResult = await pool.query(`
            SELECT COUNT(DISTINCT (${dateGroupBy}, s.initiative, COALESCE(s.collaborator_id, s.user_id))) as total
            FROM scans s
            LEFT JOIN collaborators c ON c.id = COALESCE(s.collaborator_id, s.user_id)
            WHERE ${whereConditions.join(' AND ')}
        `, queryParams);

        const formattedActivity = activity.rows.map(row => ({
            period: row.period,
            periodFormatted: row.period_formatted,
            initiative: row.initiative || 'Non définie',
            collaboratorId: row.collaborator_id,
            collaboratorName: row.collaborator_name,
            collaboratorEmail: row.collaborator_email,
            totalScans: parseInt(row.total_scans),
            totalSignatures: parseInt(row.total_signatures),
            avgQuality: parseFloat(row.avg_quality) || 0,
            avgConfidence: parseFloat(row.avg_confidence) || 0,
            firstScanTime: row.first_scan_time,
            lastScanTime: row.last_scan_time,
            verifiedScans: parseInt(row.verified_scans),
            doubtfulScans: parseInt(row.doubtful_scans),
            reliability: row.total_scans > 0 ?
                Math.round((parseInt(row.verified_scans) / parseInt(row.total_scans)) * 100) : 0
        }));

        const formattedTotals = totals.rows.map(row => ({
            period: row.period,
            periodFormatted: row.period_formatted,
            totalScans: parseInt(row.total_scans),
            totalSignatures: parseInt(row.total_signatures),
            activeCollaborators: parseInt(row.active_collaborators),
            activeInitiatives: parseInt(row.active_initiatives),
            avgQuality: parseFloat(row.avg_quality) || 0,
            avgConfidence: parseFloat(row.avg_confidence) || 0
        }));

        console.log(`✅ Activité récupérée: ${formattedActivity.length} entrées`);
        res.json({
            activity: formattedActivity,
            totals: formattedTotals,
            pagination: {
                total: parseInt(countResult.rows[0].total),
                limit: parseInt(limit),
                offset: parseInt(offset)
            },
            filters: {
                collaborator_id: collaborator_id || 'all',
                date_from,
                date_to,
                initiative: initiative || 'all',
                group_by
            }
        });

    } catch (error) {
        console.error('❌ Erreur activité détaillée:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// GET /api/admin/activity/summary - Résumé performance par collaborateur
router.get('/summary', verifyAdmin, async (req, res) => {
    try {
        const { period = 'month', limit = 20 } = req.query; // week, month, year

        console.log(`📊 Résumé activité période: ${period}`);

        let intervalClause;
        switch(period) {
            case 'week':
                intervalClause = "INTERVAL '1 week'";
                break;
            case 'year':
                intervalClause = "INTERVAL '1 year'";
                break;
            default:
                intervalClause = "INTERVAL '1 month'";
        }

        const summary = await pool.query(`
            SELECT 
                c.id,
                COALESCE(c.first_name || ' ' || c.last_name, c.email, 'Collaborateur #' || c.id) as name,
                c.first_name,
                c.last_name,
                c.email,
                c.phone,
                c.status,
                c.suspended,
                
                -- Stats période actuelle
                COUNT(s.id) as total_scans,
                COALESCE(SUM(s.signatures), 0) as total_signatures,
                ROUND(AVG(s.quality), 1) as avg_quality,
                ROUND(AVG(s.confidence), 1) as avg_confidence,
                MAX(s.created_at) as last_scan_date,
                COUNT(DISTINCT s.initiative) as initiatives_worked,
                
                -- Performance
                RANK() OVER (ORDER BY SUM(s.signatures) DESC) as ranking_signatures,
                RANK() OVER (ORDER BY COUNT(s.id) DESC) as ranking_scans,
                RANK() OVER (ORDER BY AVG(s.quality) DESC) as ranking_quality,
                
                -- Fiabilité
                COUNT(s.id) FILTER (WHERE s.verified = TRUE) as verified_scans,
                COUNT(s.id) FILTER (WHERE EXISTS(
                    SELECT 1 FROM doubtful_scans ds WHERE ds.id = s.id
                )) as doubtful_scans,
                
                -- Tendance (comparaison avec période précédente)
                (
                    SELECT COUNT(*) 
                    FROM scans s2 
                    WHERE (s2.collaborator_id = c.id OR s2.user_id = c.id)
                    AND s2.created_at >= CURRENT_DATE - ${intervalClause} * 2
                    AND s2.created_at < CURRENT_DATE - ${intervalClause}
                ) as previous_period_scans,
                
                (
                    SELECT COALESCE(SUM(signatures), 0)
                    FROM scans s2 
                    WHERE (s2.collaborator_id = c.id OR s2.user_id = c.id)
                    AND s2.created_at >= CURRENT_DATE - ${intervalClause} * 2
                    AND s2.created_at < CURRENT_DATE - ${intervalClause}
                ) as previous_period_signatures
                
            FROM collaborators c
            LEFT JOIN scans s ON (c.id = s.collaborator_id OR c.id = s.user_id)
                AND s.created_at >= CURRENT_DATE - ${intervalClause}
            WHERE (c.is_active = TRUE OR c.is_active IS NULL)
                AND (c.status != 'deleted' OR c.status IS NULL)
            GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.status, c.suspended
            ORDER BY total_signatures DESC
            LIMIT $1
        `, [parseInt(limit)]);

        const formattedSummary = summary.rows.map(collab => {
            const currentScans = parseInt(collab.total_scans) || 0;
            const currentSignatures = parseInt(collab.total_signatures) || 0;
            const previousScans = parseInt(collab.previous_period_scans) || 0;
            const previousSignatures = parseInt(collab.previous_period_signatures) || 0;
            const verifiedScans = parseInt(collab.verified_scans) || 0;
            const doubtfulScans = parseInt(collab.doubtful_scans) || 0;

            return {
                id: collab.id,
                name: collab.name,
                firstName: collab.first_name,
                lastName: collab.last_name,
                email: collab.email,
                phone: collab.phone,
                status: collab.status,
                suspended: collab.suspended || false,
                
                // Stats période
                totalScans: currentScans,
                totalSignatures: currentSignatures,
                avgQuality: parseFloat(collab.avg_quality) || 0,
                avgConfidence: parseFloat(collab.avg_confidence) || 0,
                lastScanDate: collab.last_scan_date,
                initiativesWorked: parseInt(collab.initiatives_worked) || 0,
                
                // Rankings
                rankingSignatures: parseInt(collab.ranking_signatures),
                rankingScans: parseInt(collab.ranking_scans),
                rankingQuality: parseInt(collab.ranking_quality),
                
                // Fiabilité
                reliabilityScore: currentScans > 0 ?
                    Math.round((verifiedScans / currentScans) * 100) : 100,
                doubtfulRate: currentScans > 0 ?
                    Math.round((doubtfulScans / currentScans) * 100) : 0,
                
                // Tendances
                scansTrend: previousScans > 0 ?
                    Math.round(((currentScans - previousScans) / previousScans) * 100) :
                    (currentScans > 0 ? 100 : 0),
                signaturesTrend: previousSignatures > 0 ?
                    Math.round(((currentSignatures - previousSignatures) / previousSignatures) * 100) :
                    (currentSignatures > 0 ? 100 : 0),
                
                // Moyennes journalières
                dailyAvgScans: currentScans > 0 ?
                    Math.round((currentScans / getDaysInPeriod(period)) * 10) / 10 : 0,
                dailyAvgSignatures: currentSignatures > 0 ?
                    Math.round((currentSignatures / getDaysInPeriod(period)) * 10) / 10 : 0
            };
        });

        console.log(`✅ Résumé activité généré pour ${formattedSummary.length} collaborateurs`);
        res.json({
            summary: formattedSummary,
            period,
            periodDays: getDaysInPeriod(period)
        });

    } catch (error) {
        console.error('❌ Erreur résumé activité:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// GET /api/admin/activity/initiatives - Performance par initiative
router.get('/initiatives', verifyAdmin, async (req, res) => {
    try {
        const {
            date_from,
            date_to,
            group_by = 'day',
            limit = 50
        } = req.query;

        console.log('🎯 Performance initiatives avec filtres:', { date_from, date_to, group_by });

        // Configuration du groupement temporel
        let dateGroupBy, dateFormat;
        switch(group_by) {
            case 'week':
                dateGroupBy = "DATE_TRUNC('week', s.created_at)";
                dateFormat = "TO_CHAR(DATE_TRUNC('week', s.created_at), 'YYYY-\"W\"WW')";
                break;
            case 'month':
                dateGroupBy = "DATE_TRUNC('month', s.created_at)";
                dateFormat = "TO_CHAR(DATE_TRUNC('month', s.created_at), 'YYYY-MM')";
                break;
            default: // day
                dateGroupBy = "DATE(s.created_at)";
                dateFormat = "TO_CHAR(DATE(s.created_at), 'YYYY-MM-DD')";
        }

        let whereConditions = ['s.initiative IS NOT NULL'];
        let queryParams = [];
        let paramCount = 0;

        if (date_from) {
            paramCount++;
            whereConditions.push(`s.created_at >= $${paramCount}`);
            queryParams.push(date_from);
        }

        if (date_to) {
            paramCount++;
            whereConditions.push(`s.created_at <= $${paramCount}::date + INTERVAL '1 day'`);
            queryParams.push(date_to);
        }

        const initiativePerformance = await pool.query(`
            SELECT 
                ${dateGroupBy} as period,
                ${dateFormat} as period_formatted,
                s.initiative,
                i.id as initiative_id,
                i.target_signatures,
                i.deadline,
                i.status as initiative_status,
                
                COUNT(s.id) as total_scans,
                COALESCE(SUM(s.signatures), 0) as total_signatures,
                COUNT(DISTINCT COALESCE(s.collaborator_id, s.user_id)) as active_collaborators,
                ROUND(AVG(s.quality), 1) as avg_quality,
                ROUND(AVG(s.confidence), 1) as avg_confidence,
                
                MIN(s.created_at) as first_scan,
                MAX(s.created_at) as last_scan,
                
                -- Progression vers l'objectif
                CASE 
                    WHEN i.target_signatures > 0 
                    THEN ROUND((SUM(s.signatures)::float / i.target_signatures * 100), 1)
                    ELSE 0 
                END as progress_percentage,
                
                -- Scans problématiques
                COUNT(s.id) FILTER (WHERE EXISTS(
                    SELECT 1 FROM doubtful_scans ds WHERE ds.id = s.id
                )) as doubtful_scans,
                
                COUNT(s.id) FILTER (WHERE s.verified = TRUE) as verified_scans
                
            FROM scans s
            LEFT JOIN initiatives i ON (
                i.name = s.initiative 
                OR LOWER(i.name) = LOWER(s.initiative)
            )
            WHERE ${whereConditions.join(' AND ')}
            GROUP BY ${dateGroupBy}, s.initiative, i.id, i.target_signatures, i.deadline, i.status
            ORDER BY period DESC, total_signatures DESC
            LIMIT $${paramCount + 1}
        `, [...queryParams, parseInt(limit)]);

        const formattedPerformance = initiativePerformance.rows.map(row => ({
            period: row.period,
            periodFormatted: row.period_formatted,
            initiative: row.initiative,
            initiativeId: row.initiative_id,
            targetSignatures: parseInt(row.target_signatures) || 0,
            deadline: row.deadline,
            initiativeStatus: row.initiative_status,
            
            totalScans: parseInt(row.total_scans),
            totalSignatures: parseInt(row.total_signatures),
            activeCollaborators: parseInt(row.active_collaborators),
            avgQuality: parseFloat(row.avg_quality) || 0,
            avgConfidence: parseFloat(row.avg_confidence) || 0,
            
            firstScan: row.first_scan,
            lastScan: row.last_scan,
            
            progressPercentage: parseFloat(row.progress_percentage) || 0,
            doubtfulScans: parseInt(row.doubtful_scans) || 0,
            verifiedScans: parseInt(row.verified_scans) || 0,
            reliabilityRate: row.total_scans > 0 ?
                Math.round((parseInt(row.verified_scans) / parseInt(row.total_scans)) * 100) : 0,
            
            // Calculs supplémentaires
            avgSignaturesPerScan: row.total_scans > 0 ?
                Math.round((parseInt(row.total_signatures) / parseInt(row.total_scans)) * 10) / 10 : 0,
            avgScansPerCollaborator: row.active_collaborators > 0 ?
                Math.round((parseInt(row.total_scans) / parseInt(row.active_collaborators)) * 10) / 10 : 0
        }));

        // Totaux généraux
        const globalTotals = await pool.query(`
            SELECT 
                ${dateGroupBy} as period,
                ${dateFormat} as period_formatted,
                COUNT(s.id) as total_scans,
                COALESCE(SUM(s.signatures), 0) as total_signatures,
                COUNT(DISTINCT s.initiative) as total_initiatives,
                COUNT(DISTINCT COALESCE(s.collaborator_id, s.user_id)) as total_collaborators
            FROM scans s
            WHERE ${whereConditions.join(' AND ')}
            GROUP BY ${dateGroupBy}
            ORDER BY period DESC
        `, queryParams);

        console.log(`✅ Performance initiatives: ${formattedPerformance.length} entrées`);
        res.json({
            performance: formattedPerformance,
            totals: globalTotals.rows,
            filters: {
                date_from,
                date_to,
                group_by
            }
        });

    } catch (error) {
        console.error('❌ Erreur performance initiatives:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// GET /api/admin/activity/charts - Données pour graphiques
router.get('/charts', verifyAdmin, async (req, res) => {
    try {
        const {
            type = 'signatures_evolution', // signatures_evolution, quality_trend, collaborators_activity
            days = 30,
            collaborator_id,
            initiative
        } = req.query;

        console.log(`📈 Génération graphique: ${type} (${days} jours)`);

        let chartData = {};

        switch(type) {
            case 'signatures_evolution':
                chartData = await getSignaturesEvolution(days, collaborator_id, initiative);
                break;
            case 'quality_trend':
                chartData = await getQualityTrend(days, collaborator_id, initiative);
                break;
            case 'collaborators_activity':
                chartData = await getCollaboratorsActivity(days, initiative);
                break;
            case 'initiatives_comparison':
                chartData = await getInitiativesComparison(days);
                break;
            default:
                return res.status(400).json({ error: 'Type de graphique non supporté' });
        }

        res.json(chartData);

    } catch (error) {
        console.error('❌ Erreur données graphiques:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Fonctions utilitaires pour les graphiques
async function getSignaturesEvolution(days, collaboratorId, initiative) {
    let whereConditions = ['1=1'];
    let queryParams = [parseInt(days)];
    let paramCount = 1;

    if (collaboratorId && collaboratorId !== 'all') {
        paramCount++;
        whereConditions.push(`(s.collaborator_id = $${paramCount} OR s.user_id = $${paramCount})`);
        queryParams.push(collaboratorId);
    }

    if (initiative && initiative !== 'all') {
        paramCount++;
        whereConditions.push(`s.initiative = $${paramCount}`);
        queryParams.push(initiative);
    }

    const result = await pool.query(`
        SELECT 
            DATE(s.created_at) as date,
            COUNT(s.id) as scans,
            COALESCE(SUM(s.signatures), 0) as signatures,
            COUNT(DISTINCT COALESCE(s.collaborator_id, s.user_id)) as collaborators
        FROM scans s
        WHERE s.created_at >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'
            AND ${whereConditions.join(' AND ')}
        GROUP BY DATE(s.created_at)
        ORDER BY date ASC
    `, queryParams);

    return {
        type: 'signatures_evolution',
        data: result.rows.map(row => ({
            date: row.date,
            scans: parseInt(row.scans),
            signatures: parseInt(row.signatures),
            collaborators: parseInt(row.collaborators)
        }))
    };
}

async function getQualityTrend(days, collaboratorId, initiative) {
    let whereConditions = ['s.quality IS NOT NULL'];
    let queryParams = [parseInt(days)];
    let paramCount = 1;

    if (collaboratorId && collaboratorId !== 'all') {
        paramCount++;
        whereConditions.push(`(s.collaborator_id = $${paramCount} OR s.user_id = $${paramCount})`);
        queryParams.push(collaboratorId);
    }

    if (initiative && initiative !== 'all') {
        paramCount++;
        whereConditions.push(`s.initiative = $${paramCount}`);
        queryParams.push(initiative);
    }

    const result = await pool.query(`
        SELECT 
            DATE(s.created_at) as date,
            ROUND(AVG(s.quality), 1) as avg_quality,
            ROUND(AVG(s.confidence), 1) as avg_confidence,
            COUNT(s.id) as scans_count
        FROM scans s
        WHERE s.created_at >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'
            AND ${whereConditions.join(' AND ')}
        GROUP BY DATE(s.created_at)
        ORDER BY date ASC
    `, queryParams);

    return {
        type: 'quality_trend',
        data: result.rows.map(row => ({
            date: row.date,
            avgQuality: parseFloat(row.avg_quality) || 0,
            avgConfidence: parseFloat(row.avg_confidence) || 0,
            scansCount: parseInt(row.scans_count)
        }))
    };
}

async function getCollaboratorsActivity(days, initiative) {
    let whereConditions = ['1=1'];
    let queryParams = [parseInt(days)];
    let paramCount = 1;

    if (initiative && initiative !== 'all') {
        paramCount++;
        whereConditions.push(`s.initiative = $${paramCount}`);
        queryParams.push(initiative);
    }

    const result = await pool.query(`
        SELECT 
            COALESCE(c.first_name || ' ' || c.last_name, c.email, 'Collaborateur #' || c.id) as name,
            COUNT(s.id) as scans,
            SUM(s.signatures) as signatures,
            ROUND(AVG(s.quality), 1) as avg_quality
        FROM scans s
        LEFT JOIN collaborators c ON c.id = COALESCE(s.collaborator_id, s.user_id)
        WHERE s.created_at >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'
            AND ${whereConditions.join(' AND ')}
        GROUP BY c.id, c.first_name, c.last_name, c.email
        ORDER BY signatures DESC
        LIMIT 10
    `, queryParams);

    return {
        type: 'collaborators_activity',
        data: result.rows.map(row => ({
            name: row.name,
            scans: parseInt(row.scans),
            signatures: parseInt(row.signatures) || 0,
            avgQuality: parseFloat(row.avg_quality) || 0
        }))
    };
}

async function getInitiativesComparison(days) {
    const result = await pool.query(`
        SELECT 
            s.initiative,
            COUNT(s.id) as scans,
            SUM(s.signatures) as signatures,
            COUNT(DISTINCT COALESCE(s.collaborator_id, s.user_id)) as collaborators,
            ROUND(AVG(s.quality), 1) as avg_quality,
            i.target_signatures,
            CASE 
                WHEN i.target_signatures > 0 
                THEN ROUND((SUM(s.signatures)::float / i.target_signatures * 100), 1)
                ELSE 0 
            END as progress
        FROM scans s
        LEFT JOIN initiatives i ON i.name = s.initiative
        WHERE s.created_at >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'
            AND s.initiative IS NOT NULL
        GROUP BY s.initiative, i.target_signatures
        ORDER BY signatures DESC
        LIMIT 10
    `, [parseInt(days)]);

    return {
        type: 'initiatives_comparison',
        data: result.rows.map(row => ({
            initiative: row.initiative,
            scans: parseInt(row.scans),
            signatures: parseInt(row.signatures) || 0,
            collaborators: parseInt(row.collaborators),
            avgQuality: parseFloat(row.avg_quality) || 0,
            targetSignatures: parseInt(row.target_signatures) || 0,
            progress: parseFloat(row.progress) || 0
        }))
    };
}

// Fonction utilitaire pour calculer les jours dans une période
function getDaysInPeriod(period) {
    switch(period) {
        case 'week': return 7;
        case 'month': return 30;
        case 'year': return 365;
        default: return 30;
    }
}

module.exports = router;
