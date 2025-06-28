const db = require('../config/database');
const stringSimilarity = require('string-similarity');
const fuzzball = require('fuzzball');

class MatchingService {
    
    async analyzeAndMatch(validationImageBuffer, extractedData) {
        try {
            console.log('🔍 [MatchingService] Démarrage matching automatique...');
            
            this.validateInputData(extractedData);
            
            const candidates = await this.findCandidateScans(extractedData);
            console.log(`🎯 [MatchingService] ${candidates.length} candidats trouvés`);
            
            if (candidates.length === 0) {
                return {
                    success: false,
                    reason: 'Aucun scan terrain correspondant trouvé',
                    confidence: 0,
                    candidates: []
                };
            }
            
            const scoredCandidates = candidates.map(scan => {
                const score = this.calculateMatchingScore(scan, extractedData);
                return { scan, score, criteria: score.criteria || {} };
            });
            
            scoredCandidates.sort((a, b) => b.score - a.score);
            
            const bestMatch = scoredCandidates[0];
            console.log(`🏆 [MatchingService] Meilleur match: ${bestMatch.score}% de confiance`);
            
            if (bestMatch.score >= 90) {
                return {
                    success: true,
                    fieldScan: bestMatch.scan,
                    confidence: bestMatch.score,
                    reason: 'Match automatique avec haute confiance',
                    criteria: bestMatch.criteria
                };
            } else if (bestMatch.score >= 70) {
                return {
                    success: false,
                    reason: 'Confiance insuffisante - Validation manuelle requise',
                    confidence: bestMatch.score,
                    suggestedMatch: bestMatch.scan,
                    allCandidates: scoredCandidates.slice(0, 3),
                    criteria: bestMatch.criteria
                };
            } else {
                return {
                    success: false,
                    reason: 'Aucun match fiable trouvé',
                    confidence: bestMatch.score,
                    allCandidates: scoredCandidates.slice(0, 5)
                };
            }
            
        } catch (error) {
            console.error('❌ [MatchingService] Erreur matching:', error);
            throw new Error(`Erreur matching: ${error.message}`);
        }
    }
    
    validateInputData(data) {
        const required = ['initiative', 'total_signatures'];
        for (const field of required) {
            if (!data[field]) {
                throw new Error(`Champ requis manquant: ${field}`);
            }
        }
        
        if (typeof data.total_signatures !== 'number' || data.total_signatures <= 0) {
            throw new Error('total_signatures doit être un nombre positif');
        }
    }
    
    async findCandidateScans(extractedData) {
        const { collaborator_name, initiative, total_signatures } = extractedData;
        
        try {
            const query = `
                SELECT s.*, c.first_name, c.last_name,
                       CONCAT(c.first_name, ' ', c.last_name) as full_name,
                       c.email
                FROM scans s
                LEFT JOIN collaborators c ON s.user_id = c.id
                WHERE s.scan_type = 'FIELD_COLLECTION'
                AND s.status = 'PENDING_VALIDATION'
                AND s.initiative = $1
                AND s.signatures BETWEEN $2 AND $3
                AND s.created_at >= NOW() - INTERVAL '60 days'
                ORDER BY s.created_at DESC
                LIMIT 20
            `;
            
            const signaturesMin = Math.max(1, total_signatures - 2);
            const signaturesMax = total_signatures + 2;
            
            const result = await db.query(query, [initiative, signaturesMin, signaturesMax]);
            
            if (collaborator_name && collaborator_name.trim()) {
                return result.rows.filter(scan => {
                    const fullName = scan.full_name || '';
                    const nameScore = this.calculateNameSimilarity(fullName, collaborator_name);
                    scan.nameScore = nameScore;
                    return nameScore > 40;
                });
            }
            
            return result.rows;
            
        } catch (error) {
            console.error('❌ [MatchingService] Erreur recherche candidats:', error);
            throw new Error(`Erreur recherche candidats: ${error.message}`);
        }
    }
    
    calculateMatchingScore(fieldScan, validationData) {
        let score = 0;
        const criteria = {};
        
        try {
            // Nom collaborateur (35% du score)
            if (fieldScan.full_name && validationData.collaborator_name) {
                const nameScore = this.calculateNameSimilarity(
                    fieldScan.full_name,
                    validationData.collaborator_name
                );
                score += nameScore * 0.35;
                criteria.nameScore = nameScore;
                criteria.nameMatch = `${fieldScan.full_name} vs ${validationData.collaborator_name}`;
            } else {
                criteria.nameScore = 0;
                criteria.nameMatch = 'Nom manquant';
            }
            
            // Initiative exacte (25% du score)
            if (fieldScan.initiative === validationData.initiative) {
                score += 25;
                criteria.initiativeMatch = true;
            } else {
                criteria.initiativeMatch = false;
            }
            
            // Nombre signatures (25% du score avec tolérance)
            const signatureDiff = Math.abs(fieldScan.signatures - validationData.total_signatures);
            if (signatureDiff === 0) {
                score += 25;
                criteria.signatureMatch = 'exact';
            } else if (signatureDiff <= 2) {
                score += 25 - (signatureDiff * 5);
                criteria.signatureMatch = `tolérance_${signatureDiff}`;
            } else {
                criteria.signatureMatch = `écart_trop_grand_${signatureDiff}`;
            }
            
            // Fenêtre temporelle (15% du score)
            const daysDiff = this.calculateDaysDifference(fieldScan.created_at, new Date());
            if (daysDiff <= 7) {
                score += 15;
                criteria.timeScore = 'excellent';
            } else if (daysDiff <= 30) {
                const timeScore = 15 * (1 - daysDiff / 30);
                score += timeScore;
                criteria.timeScore = `good_${Math.round(timeScore)}`;
            } else {
                criteria.timeScore = 'poor';
            }
            
            const finalScore = Math.round(score);
            criteria.finalScore = finalScore;
            
            return finalScore;
            
        } catch (error) {
            console.error('❌ [MatchingService] Erreur calcul score:', error);
            return 0;
        }
    }
    
    calculateNameSimilarity(name1, name2) {
        if (!name1 || !name2) return 0;
        
        try {
            const normalize = (name) => name.toLowerCase()
                .replace(/[àáâãäå]/g, 'a')
                .replace(/[èéêë]/g, 'e')
                .replace(/[ìíîï]/g, 'i')
                .replace(/[òóôõö]/g, 'o')
                .replace(/[ùúûü]/g, 'u')
                .replace(/[ç]/g, 'c')
                .replace(/[^a-z\s]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            
            const norm1 = normalize(name1);
            const norm2 = normalize(name2);
            
            if (norm1 === norm2) return 100;
            
            const similarity = stringSimilarity.compareTwoStrings(norm1, norm2) * 100;
            const fuzzy = fuzzball.ratio(norm1, norm2);
            
            const bestScore = Math.max(similarity, fuzzy);
            return Math.round(bestScore);
            
        } catch (error) {
            console.error('❌ [MatchingService] Erreur calcul similarité:', error);
            return 0;
        }
    }
    
    calculateDaysDifference(date1, date2) {
        try {
            const diffTime = Math.abs(date2 - new Date(date1));
            return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        } catch (error) {
            console.error('❌ [MatchingService] Erreur calcul différence dates:', error);
            return 999;
        }
    }
}

module.exports = new MatchingService();
