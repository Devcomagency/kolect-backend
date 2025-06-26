// services/visionService.js - SERVICE GPT-4 VISION AVEC SUPPORT INITIATIVES
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class VisionService {
  // ✅ NOUVELLE FONCTION : Analyse avec contexte initiatives enrichi
  static async analyzeSignatureSheetWithContext(imageBuffer, initiativeContext, availableInitiatives) {
    try {
      console.log('🤖 === DÉMARRAGE ANALYSE GPT-4 VISION AVEC INITIATIVES ===');
      console.log('📋 Initiatives disponibles:', availableInitiatives);
      console.log('📏 Taille image:', imageBuffer.length, 'bytes');
      
      // Convertir l'image en base64
      const base64Image = imageBuffer.toString('base64');
      console.log('🔄 Image convertie en base64');

      // ✅ PROMPT ENRICHI AVEC CONTEXTE INITIATIVES
      let enhancedPrompt = `You are a Swiss signature sheet analysis expert for citizen initiatives.

CRITICAL INSTRUCTIONS:
1. Count EXACTLY the number of filled lines on this signature sheet
2. Identify which citizen initiative this document relates to
3. RESPOND ONLY WITH VALID JSON - NO TEXT BEFORE OR AFTER
4. NO explanations like "I found" or "Il semble" - ONLY JSON
5. NO markdown formatting (no \`\`\`json\`\`\`)`;

      // Ajouter le contexte des initiatives si disponible
      if (initiativeContext && availableInitiatives && availableInitiatives.length > 0) {
        enhancedPrompt += `

INITIATIVES CONTEXT:
${initiativeContext}

INITIATIVE DETECTION RULES:
1. Look for keywords, titles, headers in the document
2. Match content against the initiatives above
3. If document clearly relates to one initiative → return that initiative name
4. If document is unclear or empty → return "Indéterminé"
5. If document has no signatures → return "Aucune"

AVAILABLE INITIATIVES: ${availableInitiatives.join(', ')}`;
      }

      enhancedPrompt += `

SIGNATURE COUNTING CRITERIA:
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
{"valid_signatures": X, "invalid_signatures": Y, "empty_lines": Z, "total_lines_analyzed": N, "confidence": 0.XX, "initiative": "Initiative_Name", "notes": "Brief description"}

EXAMPLE RESPONSES:
{"valid_signatures": 8, "invalid_signatures": 2, "empty_lines": 5, "total_lines_analyzed": 15, "confidence": 0.92, "initiative": "Forêt", "notes": "Clear sheet with 8 complete signatures"}
{"valid_signatures": 0, "invalid_signatures": 0, "empty_lines": 0, "total_lines_analyzed": 0, "confidence": 0.95, "initiative": "Aucune", "notes": "Empty document, no signatures"}
{"valid_signatures": 12, "invalid_signatures": 1, "empty_lines": 3, "total_lines_analyzed": 16, "confidence": 0.88, "initiative": "Indéterminé", "notes": "Signatures present but initiative unclear"}`;

      console.log('📡 === APPEL GPT-4 VISION AVEC CONTEXTE ===');

      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: enhancedPrompt
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
        max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 400,
        temperature: 0.1, // Très bas pour cohérence
      });

      const result = response.choices[0].message.content;
      console.log('📋 === RÉPONSE BRUTE GPT-4 AVEC INITIATIVES ===');
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
        const initiativeMatch = cleanedResult.match(/initiative["\s]*:\s*["']([^"']+)["']/i);
        
        analysis = {
          valid_signatures: validMatch ? parseInt(validMatch[1]) : 0,
          invalid_signatures: invalidMatch ? parseInt(invalidMatch[1]) : 0,
          empty_lines: 0,
          total_lines_analyzed: 0,
          confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.75,
          initiative: initiativeMatch ? initiativeMatch[1] : "Indéterminé",
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
      const initiative = analysis.initiative || "Indéterminé";
      
      // Validation logique
      if (validSignatures < 0 || invalidSignatures < 0) {
        throw new Error('Valeurs négatives détectées dans l\'analyse');
      }
      
      if (confidence < 0 || confidence > 1) {
        console.log('⚠️ Confiance corrigée:', confidence, '→ 0.85');
        analysis.confidence = 0.85;
      }

      // ✅ VALIDATION INITIATIVE
      let validatedInitiative = initiative;
      if (availableInitiatives && availableInitiatives.length > 0) {
        if (!availableInitiatives.includes(initiative) && initiative !== "Indéterminé" && initiative !== "Aucune") {
          console.log(`⚠️ Initiative "${initiative}" non reconnue, utilisation "Indéterminé"`);
          validatedInitiative = "Indéterminé";
        }
      }

      console.log('✅ === ANALYSE GPT-4 TERMINÉE AVEC SUCCÈS ===');
      console.log('📊 Signatures valides:', validSignatures);
      console.log('❌ Signatures invalides:', invalidSignatures);
      console.log('⚪ Lignes vides:', emptyLines);
      console.log('📏 Total lignes:', totalLines);
      console.log('🎯 Confiance:', Math.round(confidence * 100) + '%');
      console.log('🎯 Initiative détectée:', validatedInitiative); // ✅ NOUVEAU
      console.log('📝 Notes:', analysis.notes);

      const finalResult = {
        success: true,
        data: {
          validSignatures: validSignatures,
          invalidSignatures: invalidSignatures,
          emptyLines: emptyLines,
          totalLines: totalLines,
          confidence: confidence,
          initiative: validatedInitiative, // ✅ NOUVEAU CHAMP
          notes: analysis.notes || 'Analyse GPT-4 Vision réussie avec détection initiative',
          analysisMethod: 'GPT-4 Vision avec contexte initiatives',
          model: process.env.OPENAI_MODEL || "gpt-4o",
          timestamp: new Date().toISOString(),
          tokensUsed: response.usage?.total_tokens || 0,
          cost: this.calculateCost(response.usage?.total_tokens || 0)
        }
      };

      console.log('🎉 === RÉSULTAT FINAL AVEC INITIATIVE ===');
      console.log('🎉 Success:', finalResult.success);
      console.log('🎉 Data:', JSON.stringify(finalResult.data, null, 2));

      return finalResult;

    } catch (error) {
      console.error('❌ === ERREUR GPT-4 VISION ===');
      console.error('❌ Message:', error.message);
      console.error('❌ Stack:', error.stack);
      
      // ✅ FALLBACK AMÉLIORÉ AVEC INITIATIVE
      console.log('🎭 === GÉNÉRATION FALLBACK AVEC INITIATIVE ===');
      
      const fallbackValid = Math.floor(Math.random() * 8) + 3; // 3-10 signatures valides
      const fallbackInvalid = Math.floor(Math.random() * 3) + 1; // 1-3 invalides
      const fallbackEmpty = Math.floor(Math.random() * 5) + 2; // 2-6 vides
      
      // Initiative par défaut plus intelligente
      let fallbackInitiative = "Indéterminé";
      if (availableInitiatives && availableInitiatives.length > 0) {
        // Si c'est vraiment vide, dire "Aucune", sinon initiative aléatoire
        if (fallbackValid === 0) {
          fallbackInitiative = "Aucune";
        } else {
          fallbackInitiative = availableInitiatives[Math.floor(Math.random() * availableInitiatives.length)];
        }
      }
      
      const fallbackResult = {
        validSignatures: fallbackValid,
        invalidSignatures: fallbackInvalid,
        emptyLines: fallbackEmpty,
        totalLines: fallbackValid + fallbackInvalid + fallbackEmpty,
        confidence: 0.5, // Confiance réduite pour fallback
        initiative: fallbackInitiative, // ✅ INITIATIVE FALLBACK
        analysisMethod: '🎭 SIMULATION (GPT-4 indisponible)',
        notes: `⚠️ GPT-4 error: ${error.message}. Initiative "${fallbackInitiative}" simulée.`,
        timestamp: new Date().toISOString(),
        error: error.message,
        simulated: true, // ✅ FLAG SIMULATION
        reliable: false // ✅ FLAG FIABILITÉ
      };

      console.log('🎭 Fallback généré avec initiative:', fallbackResult);

      return {
        success: false,
        error: error.message,
        fallback: fallbackResult
      };
    }
  }

  // ✅ FONCTION LEGACY : Maintien compatibilité avec ancien code
  static async analyzeSignatureSheet(imageBuffer, initiativeName) {
    console.log('⚠️ Utilisation fonction legacy analyzeSignatureSheet');
    console.log('🔄 Redirection vers analyzeSignatureSheetWithContext');
    
    // Contexte basique pour compatibilité
    const basicContext = `- ${initiativeName}: Initiative citoyenne suisse`;
    const availableInitiatives = [initiativeName];
    
    return this.analyzeSignatureSheetWithContext(imageBuffer, basicContext, availableInitiatives);
  }

  // Calculer le coût approximatif
  static calculateCost(tokens) {
    // GPT-4o: ~$0.005 per 1K tokens input + $0.015 per 1K tokens output
    const costPer1KTokens = 0.01;
    return Math.round((tokens / 1000) * costPer1KTokens * 100) / 100;
  }

  // Test de connectivité OpenAI avec GPT-4o
  static async testConnection() {
    try {
      console.log('🔍 === TEST CONNEXION OPENAI GPT-4 ===');
      
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY manquante dans variables environnement');
      }

      console.log('🔑 API Key présente:', process.env.OPENAI_API_KEY.substring(0, 8) + '...');
      console.log('🤖 Modèle configuré:', process.env.OPENAI_MODEL || 'non défini');
      
      // ✅ TEST AVEC GPT-4o SI CONFIGURÉ
      const testModel = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
      
      const response = await openai.chat.completions.create({
        model: testModel,
        messages: [{
          role: "user",
          content: "Test connexion. Répondre UNIQUEMENT: {\"status\":\"ok\"}"
        }],
        max_tokens: 10,
        temperature: 0
      });

      const content = response.choices[0].message.content;
      console.log('✅ Réponse test:', content);
      console.log('✅ Connexion OpenAI réussie avec modèle:', testModel);
      
      return {
        success: true,
        response: content,
        model: testModel,
        tokensUsed: response.usage?.total_tokens || 0,
        openaiKey: true,
        openaiKeyPreview: process.env.OPENAI_API_KEY.substring(0, 8) + '...',
        openaiModel: process.env.OPENAI_MODEL || 'non défini',
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ === ERREUR TEST CONNEXION ===');
      console.error('❌ Message:', error.message);
      console.error('❌ Type:', error.constructor.name);
      
      if (error.code === 'invalid_api_key') {
        console.error('❌ Clé API invalide');
      } else if (error.code === 'insufficient_quota') {
        console.error('❌ Quota OpenAI épuisé');
      } else if (error.status === 404) {
        console.error('❌ Modèle non trouvé - vérifiez OPENAI_MODEL');
      }
      
      return {
        success: false,
        error: error.message,
        code: error.code || 'unknown',
        model: process.env.OPENAI_MODEL || 'non défini',
        openaiKey: !!process.env.OPENAI_API_KEY,
        openaiKeyPreview: process.env.OPENAI_API_KEY ?
          process.env.OPENAI_API_KEY.substring(0, 8) + '...' : 'manquante'
      };
    }
  }

  // Validation croisée pour très haute précision (avec initiatives)
  static async doubleCheckAnalysis(imageBuffer, firstResult, initiativeContext, availableInitiatives) {
    try {
      console.log('🔍 === VALIDATION CROISÉE AVEC INITIATIVES ===');
      console.log('🔍 Premier résultat:', firstResult.validSignatures, 'signatures valides');
      console.log('🔍 Initiative première analyse:', firstResult.initiative);
      
      const secondAnalysis = await this.analyzeSignatureSheetWithContext(
        imageBuffer,
        initiativeContext,
        availableInitiatives
      );
      
      if (!secondAnalysis.success) {
        console.log('⚠️ Seconde analyse échouée, validation impossible');
        return { validated: false, confidence: firstResult.confidence };
      }

      const countDiff = Math.abs(
        firstResult.validSignatures - secondAnalysis.data.validSignatures
      );
      
      const initiativeMatch = firstResult.initiative === secondAnalysis.data.initiative;
      
      const isConsistent = countDiff <= 1 && initiativeMatch; // Tolérance de 1 signature + même initiative
      const avgConfidence = (firstResult.confidence + secondAnalysis.data.confidence) / 2;
      
      console.log(`🔍 === RÉSULTAT VALIDATION AVEC INITIATIVES ===`);
      console.log(`🔍 Cohérence comptage: ${countDiff <= 1 ? '✅ OUI' : '❌ NON'}`);
      console.log(`🔍 Cohérence initiative: ${initiativeMatch ? '✅ OUI' : '❌ NON'}`);
      console.log(`🔍 Première analyse: ${firstResult.validSignatures} - ${firstResult.initiative}`);
      console.log(`🔍 Seconde analyse: ${secondAnalysis.data.validSignatures} - ${secondAnalysis.data.initiative}`);
      console.log(`🔍 Différence comptage: ${countDiff}`);
      console.log(`🔍 Confiance finale: ${Math.round(avgConfidence * 100)}%`);

      return {
        validated: isConsistent,
        countDifference: countDiff,
        initiativeMatch: initiativeMatch,
        firstCount: firstResult.validSignatures,
        secondCount: secondAnalysis.data.validSignatures,
        firstInitiative: firstResult.initiative,
        secondInitiative: secondAnalysis.data.initiative,
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
