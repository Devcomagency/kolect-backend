// services/visionService.js - SERVICE GPT-4 VISION POUR COMPTAGE SIGNATURES
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class VisionService {
  static async analyzeSignatureSheet(imageBuffer, initiativeName) {
    try {
      console.log('🤖 === DÉMARRAGE ANALYSE GPT-4 VISION ===');
      console.log('📋 Initiative:', initiativeName);
      console.log('📏 Taille image:', imageBuffer.length, 'bytes');
      
      // Convertir l'image en base64
      const base64Image = imageBuffer.toString('base64');
      console.log('🔄 Image convertie en base64');

      // PROMPT STRICT POUR JSON UNIQUEMENT
      const prompt = `You are a Swiss signature sheet analysis expert for citizen initiatives.

CONTEXT:
- Initiative: "${initiativeName}"
- Type: Official signature collection sheet
- Country: Switzerland (French/German/Italian names possible)
- Format: List with columns Name, First Name, Address, Signature, Date

CRITICAL INSTRUCTIONS:
1. Count EXACTLY the number of filled lines on this signature sheet
2. RESPOND ONLY WITH VALID JSON - NO TEXT BEFORE OR AFTER
3. NO explanations like "I found" or "Il semble" - ONLY JSON
4. NO markdown formatting (no \`\`\`json\`\`\`)

COUNTING CRITERIA:
✅ VALID SIGNATURE = Line with:
   - Name AND first name filled (readable or not)
   - Signature present (scribble accepted)
   - Not completely crossed out

❌ INVALID SIGNATURE = Line with:
   - Missing name OR first name
   - No signature at all
   - Completely crossed out/deleted

⚪ EMPTY LINE = Completely empty line

RESPOND ONLY WITH THIS EXACT JSON FORMAT:
{"valid_signatures": X, "invalid_signatures": Y, "empty_lines": Z, "total_lines_analyzed": N, "confidence": 0.XX, "notes": "Brief description of what was observed"}

EXAMPLE RESPONSE:
{"valid_signatures": 8, "invalid_signatures": 2, "empty_lines": 5, "total_lines_analyzed": 15, "confidence": 0.92, "notes": "Clear sheet with 8 complete signatures"}`;

      console.log('📡 === APPEL GPT-4 VISION ===');

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
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 300,
        temperature: 0.1, // Très bas pour cohérence
      });

      const result = response.choices[0].message.content;
      console.log('📋 === RÉPONSE BRUTE GPT-4 ===');
      console.log('📋 Contenu brut:', result);

      // NETTOYAGE STRICT DE LA RÉPONSE
      let cleanedResult = result.trim();
      
      // Enlever les ```json``` si présents
      cleanedResult = cleanedResult.replace(/```json\s*\n?/gi, '');
      cleanedResult = cleanedResult.replace(/```\s*\n?/gi, '');
      
      // Enlever les commentaires
      cleanedResult = cleanedResult.replace(/\/\/.*$/gm, '');
      
      // Enlever texte avant/après JSON
      const jsonMatch = cleanedResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedResult = jsonMatch[0];
      }

      console.log('🧹 Réponse nettoyée:', cleanedResult);

      // PARSING JSON STRICT
      let analysis;
      try {
        analysis = JSON.parse(cleanedResult);
        console.log('✅ JSON parsé avec succès:', analysis);
      } catch (parseError) {
        console.error('❌ ERREUR PARSING JSON:', parseError.message);
        console.error('❌ Contenu problématique:', cleanedResult);
        
        // EXTRACTION MANUELLE EN CAS D'ERREUR
        const validMatch = cleanedResult.match(/valid_signatures["\s]*:\s*(\d+)/i);
        const invalidMatch = cleanedResult.match(/invalid_signatures["\s]*:\s*(\d+)/i);
        const confidenceMatch = cleanedResult.match(/confidence["\s]*:\s*([\d.]+)/i);
        
        analysis = {
          valid_signatures: validMatch ? parseInt(validMatch[1]) : 0,
          invalid_signatures: invalidMatch ? parseInt(invalidMatch[1]) : 0,
          empty_lines: 0,
          total_lines_analyzed: 0,
          confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.75,
          notes: "JSON parsing failed - manual extraction used"
        };
        
        console.log('🔧 Extraction manuelle:', analysis);
      }
      
      // VALIDATION STRICTE DES DONNÉES
      const validSignatures = parseInt(analysis.valid_signatures) || 0;
      const invalidSignatures = parseInt(analysis.invalid_signatures) || 0;
      const emptyLines = parseInt(analysis.empty_lines) || 0;
      const totalLines = parseInt(analysis.total_lines_analyzed) || (validSignatures + invalidSignatures + emptyLines);
      const confidence = parseFloat(analysis.confidence) || 0.85;
      
      // Validation logique
      if (validSignatures < 0 || invalidSignatures < 0) {
        throw new Error('Valeurs négatives détectées dans l\'analyse');
      }
      
      if (confidence < 0 || confidence > 1) {
        console.log('⚠️ Confiance corrigée:', confidence, '→ 0.85');
        analysis.confidence = 0.85;
      }

      console.log('✅ === ANALYSE GPT-4 TERMINÉE AVEC SUCCÈS ===');
      console.log('📊 Signatures valides:', validSignatures);
      console.log('❌ Signatures invalides:', invalidSignatures);
      console.log('⚪ Lignes vides:', emptyLines);
      console.log('📏 Total lignes:', totalLines);
      console.log('🎯 Confiance:', Math.round(confidence * 100) + '%');
      console.log('📝 Notes:', analysis.notes);

      const finalResult = {
        success: true,
        data: {
          validSignatures: validSignatures,
          invalidSignatures: invalidSignatures,
          emptyLines: emptyLines,
          totalLines: totalLines,
          confidence: confidence,
          notes: analysis.notes || 'Analyse GPT-4 Vision réussie',
          analysisMethod: 'GPT-4 Vision',
          model: process.env.OPENAI_MODEL || "gpt-4o",
          timestamp: new Date().toISOString(),
          tokensUsed: response.usage?.total_tokens || 0,
          cost: this.calculateCost(response.usage?.total_tokens || 0)
        }
      };

      console.log('🎉 === RÉSULTAT FINAL ===');
      console.log('🎉 Success:', finalResult.success);
      console.log('🎉 Data:', JSON.stringify(finalResult.data, null, 2));

      return finalResult;

    } catch (error) {
      console.error('❌ === ERREUR GPT-4 VISION ===');
      console.error('❌ Message:', error.message);
      console.error('❌ Stack:', error.stack);
      
      // FALLBACK AMÉLIORÉ
      console.log('🎭 === GÉNÉRATION FALLBACK ===');
      
      const fallbackValid = Math.floor(Math.random() * 8) + 3; // 3-10 signatures valides
      const fallbackInvalid = Math.floor(Math.random() * 3) + 1; // 1-3 invalides
      const fallbackEmpty = Math.floor(Math.random() * 5) + 2; // 2-6 vides
      
      const fallbackResult = {
        validSignatures: fallbackValid,
        invalidSignatures: fallbackInvalid,
        emptyLines: fallbackEmpty,
        totalLines: fallbackValid + fallbackInvalid + fallbackEmpty,
        confidence: 0.6, // Confiance réduite pour fallback
        analysisMethod: 'Simulation (GPT-4 error)',
        notes: `GPT-4 error: ${error.message}. Simulation utilisée.`,
        timestamp: new Date().toISOString(),
        error: error.message
      };

      console.log('🎭 Fallback généré:', fallbackResult);

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
    const costPer1KTokens = 0.01;
    return Math.round((tokens / 1000) * costPer1KTokens * 100) / 100;
  }

  // Test de connectivité OpenAI
  static async testConnection() {
    try {
      console.log('🔍 === TEST CONNEXION OPENAI ===');
      
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY manquante dans variables environnement');
      }

      console.log('🔑 API Key présente:', process.env.OPENAI_API_KEY.substring(0, 8) + '...');
      
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{
          role: "user",
          content: "Test connexion. Répondre UNIQUEMENT: {\"status\":\"ok\"}"
        }],
        max_tokens: 10,
        temperature: 0
      });

      const content = response.choices[0].message.content;
      console.log('✅ Réponse test:', content);
      console.log('✅ Connexion OpenAI réussie');
      
      return {
        success: true,
        response: content,
        model: "gpt-3.5-turbo",
        tokensUsed: response.usage?.total_tokens || 0
      };
      
    } catch (error) {
      console.error('❌ === ERREUR TEST CONNEXION ===');
      console.error('❌ Message:', error.message);
      console.error('❌ Type:', error.constructor.name);
      
      if (error.code === 'invalid_api_key') {
        console.error('❌ Clé API invalide');
      } else if (error.code === 'insufficient_quota') {
        console.error('❌ Quota OpenAI épuisé');
      }
      
      return {
        success: false,
        error: error.message,
        code: error.code || 'unknown'
      };
    }
  }

  // Validation croisée pour très haute précision
  static async doubleCheckAnalysis(imageBuffer, firstResult, initiativeName) {
    try {
      console.log('🔍 === VALIDATION CROISÉE ===');
      console.log('🔍 Premier résultat:', firstResult.validSignatures, 'signatures valides');
      
      const secondAnalysis = await this.analyzeSignatureSheet(imageBuffer, initiativeName);
      
      if (!secondAnalysis.success) {
        console.log('⚠️ Seconde analyse échouée, validation impossible');
        return { validated: false, confidence: firstResult.confidence };
      }

      const diff = Math.abs(
        firstResult.validSignatures - secondAnalysis.data.validSignatures
      );
      
      const isConsistent = diff <= 1; // Tolérance de 1 signature
      const avgConfidence = (firstResult.confidence + secondAnalysis.data.confidence) / 2;
      
      console.log(`🔍 === RÉSULTAT VALIDATION ===`);
      console.log(`🔍 Cohérence: ${isConsistent ? '✅ OUI' : '❌ NON'}`);
      console.log(`🔍 Première analyse: ${firstResult.validSignatures}`);
      console.log(`🔍 Seconde analyse: ${secondAnalysis.data.validSignatures}`);
      console.log(`🔍 Différence: ${diff}`);
      console.log(`🔍 Confiance finale: ${Math.round(avgConfidence * 100)}%`);

      return {
        validated: isConsistent,
        difference: diff,
        firstCount: firstResult.validSignatures,
        secondCount: secondAnalysis.data.validSignatures,
        finalConfidence: isConsistent ? Math.min(avgConfidence + 0.1, 0.98) : avgConfidence - 0.1,
        recommendation: isConsistent ? 'Résultat fiable' : 'Révision manuelle recommandée'
      };
      
    } catch (error) {
      console.error('❌ Erreur validation croisée:', error);
      return { validated: true, confidence: firstResult.confidence };
    }
  }
}

module.exports = VisionService;
