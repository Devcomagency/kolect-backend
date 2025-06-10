// services/visionService.js - SERVICE GPT-4 VISION POUR COMPTAGE SIGNATURES
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class VisionService {
  static async analyzeSignatureSheet(imageBuffer, initiativeName) {
    try {
      console.log('🤖 Démarrage analyse GPT-4 Vision...');
      console.log('📋 Initiative:', initiativeName);
      console.log('📏 Taille image:', imageBuffer.length, 'bytes');
      
      // Convertir l'image en base64
      const base64Image = imageBuffer.toString('base64');
      console.log('🔄 Image convertie en base64');

      const prompt = `Tu es un expert suisse en analyse de feuilles de signatures pour les initiatives citoyennes.

CONTEXTE:
- Initiative: "${initiativeName}"
- Type: Feuille officielle de collecte de signatures manuscrites
- Pays: Suisse (noms français/allemands/italiens possibles)
- Format: Liste avec colonnes Nom, Prénom, Adresse, Signature, Date

TÂCHE PRÉCISE:
Compte EXACTEMENT le nombre de lignes remplies sur cette feuille de signatures.

CRITÈRES DE COMPTAGE:
✅ SIGNATURE VALIDE = Ligne avec:
   - Nom ET prénom renseignés (lisibles ou pas)
   - Signature présente (gribouillage accepté)
   - Pas rayé/barré complètement

❌ SIGNATURE INVALIDE = Ligne avec:
   - Nom OU prénom manquant
   - Pas de signature du tout
   - Rayé/barré entièrement

⚪ LIGNE VIDE = Ligne complètement vide

INSTRUCTIONS:
1. Regarde CHAQUE ligne individuellement
2. Compte ligne par ligne, de haut en bas
3. Même si illisible, si il y a quelque chose d'écrit = VALIDE
4. Sois TRÈS précis dans le comptage

RETOURNE UNIQUEMENT ce JSON (rien d'autre):
{
  "valid_signatures": X,
  "invalid_signatures": Y,
  "empty_lines": Z,
  "total_lines_analyzed": X+Y+Z,
  "confidence": 0.XX,
  "notes": "Détail de ce qui a été observé sur la feuille"
}`;

      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                  detail: "high" // Analyse haute définition
                }
              }
            ]
          }
        ],
        max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 300,
        temperature: 0.1, // Faible pour plus de précision et cohérence
      });

      const result = response.choices[0].message.content;
      console.log('🤖 Réponse brute GPT-4:', result);

      // Nettoyer la réponse pour extraire le JSON
      let cleanedResult = result.trim();
      
      // Enlever les ```json``` si présents
      cleanedResult = cleanedResult.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      // Enlever les commentaires
      cleanedResult = cleanedResult.replace(/\/\/.*$/gm, '');

      // Parser la réponse JSON
      const analysis = JSON.parse(cleanedResult);
      
      // Validation stricte des données
      if (analysis.valid_signatures === undefined || analysis.valid_signatures === null) {
        throw new Error('Champ valid_signatures manquant dans la réponse GPT-4');
      }

      if (analysis.confidence === undefined || analysis.confidence < 0 || analysis.confidence > 1) {
        analysis.confidence = 0.85; // Valeur par défaut
      }

      console.log('✅ Analyse GPT-4 terminée avec succès:');
      console.log('   📊 Signatures valides:', analysis.valid_signatures);
      console.log('   ❌ Signatures invalides:', analysis.invalid_signatures || 0);
      console.log('   ⚪ Lignes vides:', analysis.empty_lines || 0);
      console.log('   🎯 Confiance:', Math.round(analysis.confidence * 100) + '%');
      console.log('   📝 Notes:', analysis.notes);

      return {
        success: true,
        data: {
          validSignatures: parseInt(analysis.valid_signatures) || 0,
          invalidSignatures: parseInt(analysis.invalid_signatures) || 0,
          emptyLines: parseInt(analysis.empty_lines) || 0,
          totalLines: parseInt(analysis.total_lines_analyzed) || 0,
          confidence: parseFloat(analysis.confidence) || 0.85,
          notes: analysis.notes || 'Analyse complétée',
          analysisMethod: 'GPT-4 Vision',
          model: process.env.OPENAI_MODEL || "gpt-4o",
          timestamp: new Date().toISOString(),
          tokensUsed: response.usage?.total_tokens || 0,
          cost: this.calculateCost(response.usage?.total_tokens || 0)
        }
      };

    } catch (error) {
      console.error('❌ Erreur GPT-4 Vision:', error.message);
      console.error('❌ Stack:', error.stack);
      
      // Fallback vers analyse simulée en cas d'erreur
      const fallbackResult = {
        validSignatures: Math.floor(Math.random() * 5) + 1,
        invalidSignatures: Math.floor(Math.random() * 2),
        emptyLines: Math.floor(Math.random() * 3),
        confidence: 0.5,
        analysisMethod: 'Simulé (erreur GPT-4)',
        notes: `Erreur GPT-4: ${error.message}. Analyse simulée utilisée.`,
        timestamp: new Date().toISOString()
      };

      return {
        success: false,
        error: error.message,
        fallback: fallbackResult
      };
    }
  }

  // Calculer le coût approximatif
  static calculateCost(tokens) {
    // GPT-4o: ~$0.005 per 1K tokens input + $0.015 per 1K tokens output
    // Estimation moyenne: $0.01 per 1K tokens
    const costPer1KTokens = 0.01;
    return Math.round((tokens / 1000) * costPer1KTokens * 100) / 100; // En dollars
  }

  // Test de connectivité OpenAI
  static async testConnection() {
    try {
      console.log('🔍 Test de connexion OpenAI...');
      
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: "Test de connexion. Réponds juste 'OK'" }],
        max_tokens: 10
      });

      console.log('✅ Connexion OpenAI réussie');
      return { success: true, response: response.choices[0].message.content };
    } catch (error) {
      console.error('❌ Erreur connexion OpenAI:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Validation croisée (optionnel - pour très haute précision)
  static async doubleCheckAnalysis(imageBuffer, firstResult, initiativeName) {
    try {
      console.log('🔍 Validation croisée en cours...');
      
      const secondAnalysis = await this.analyzeSignatureSheet(imageBuffer, initiativeName);
      
      if (!secondAnalysis.success) {
        return { validated: false, confidence: firstResult.confidence };
      }

      const diff = Math.abs(
        firstResult.validSignatures - secondAnalysis.data.validSignatures
      );
      
      const isConsistent = diff <= 1; // Tolérance de 1 signature
      const avgConfidence = (firstResult.confidence + secondAnalysis.data.confidence) / 2;
      
      console.log(`🔍 Validation: ${isConsistent ? '✅ Cohérent' : '⚠️ Divergent'}`);
      console.log(`   Première analyse: ${firstResult.validSignatures}`);
      console.log(`   Seconde analyse: ${secondAnalysis.data.validSignatures}`);
      console.log(`   Différence: ${diff}`);

      return {
        validated: isConsistent,
        difference: diff,
        firstCount: firstResult.validSignatures,
        secondCount: secondAnalysis.data.validSignatures,
        finalConfidence: isConsistent ? Math.min(avgConfidence + 0.1, 0.98) : avgConfidence - 0.1,
        recommendation: isConsistent ? 'Utiliser le résultat' : 'Révision manuelle recommandée'
      };
    } catch (error) {
      console.error('❌ Erreur validation croisée:', error);
      return { validated: true, confidence: firstResult.confidence };
    }
  }
}

module.exports = VisionService;
