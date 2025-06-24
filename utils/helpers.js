const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs').promises;

/**
 * Upload simple de fichier (version locale pour dev)
 */
async function uploadFile(file, destination) {
  try {
    const uploadDir = path.join(process.cwd(), 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    
    const fileName = destination.split('/').pop();
    const filePath = path.join(uploadDir, fileName);
    
    await fs.writeFile(filePath, file.buffer);
    
      return `${process.env.BASE_URL || 'https://kolect-backend.onrender.com'}/uploads/${fileName}`;
    
  } catch (error) {
    console.error('Erreur upload fichier:', error);
    throw error;
  }
}

/**
 * Vérification qualité simplifiée (moins stricte)
 */
async function checkImageQuality(imageBuffer) {
  try {
    const quality = {
      isValid: true,
      size: imageBuffer.length,
      issues: []
    };
    
    // Critères plus permissifs pour les tests
    if (imageBuffer.length < 50000) { // 50KB au lieu de 200KB
      quality.issues.push('Fichier trop petit');
    }
    
    if (imageBuffer.length > 50000000) { // 50MB au lieu de 20MB
      quality.issues.push('Fichier trop volumineux');
    }
    
    // Pour les tests, on accepte tout sauf les fichiers vraiment trop petits
    quality.isValid = imageBuffer.length > 10000; // 10KB minimum
    quality.score = quality.isValid ? 1.0 : 0.0;
    
    return quality;
    
  } catch (error) {
    console.error('Erreur vérification qualité:', error);
    return {
      isValid: true, // Mode permissif pour les tests
      issues: [],
      score: 1.0
    };
  }
}

/**
 * Hash simple pour détection doublons
 */
function generateSimpleHash(buffer) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Analyse simulée des signatures (temporaire)
 */
async function analyzeSignatureSheet(imageUrl, initiativeName) {
  try {
    const validSignatures = Math.floor(Math.random() * 3) + 1;
    const rejectedSignatures = Math.floor(Math.random() * 2);
    
    return {
      validSignatures,
      rejectedSignatures,
      totalSignatures: validSignatures + rejectedSignatures,
      confidence: 0.85,
      detectedInitiative: initiativeName,
      notes: 'Analyse simulée - sera remplacée par GPT Vision'
    };
    
  } catch (error) {
    console.error('Erreur analyse:', error);
    return {
      validSignatures: 0,
      rejectedSignatures: 0,
      totalSignatures: 0,
      confidence: 0.0,
      detectedInitiative: initiativeName,
      notes: `Erreur analyse: ${error.message}`
    };
  }
}

async function sendEmail({ to, subject, html, attachments = [] }) {
  console.log(`📧 EMAIL SIMULÉ: ${subject} → ${to}`);
  return { messageId: 'simulated_' + Date.now() };
}

async function generateContract(user) {
  console.log(`📄 CONTRAT SIMULÉ pour ${user.first_name} ${user.last_name}`);
  return `${process.env.BASE_URL}/contracts/contract_${user.id}_${Date.now()}.pdf`;
}

async function generateSignedContract(user, signatureUrl) {
  console.log(`✍️ CONTRAT SIGNÉ SIMULÉ pour ${user.first_name} ${user.last_name}`);
  return `${process.env.BASE_URL}/contracts/signed/contract_signed_${user.id}_${Date.now()}.pdf`;
}

module.exports = {
  uploadFile,
  analyzeSignatureSheet,
  sendEmail,
  generateContract,
  generateSignedContract,
  checkImageQuality,
  generateSimpleHash
};
