const sharp = require('sharp');
const crypto = require('crypto');

/**
 * Générer un hash perceptuel d'image pour détection de doublons
 * Plus fiable qu'un simple MD5 car insensible aux petites variations
 */
async function generatePerceptualHash(imageBuffer) {
  try {
    // Préprocessing standardisé pour normaliser les images
    const processedImage = await sharp(imageBuffer)
      .resize(16, 16, { 
        fit: 'fill',
        kernel: sharp.kernel.nearest 
      })
      .greyscale()
      .normalise() // Normalise la luminosité
      .raw()
      .toBuffer();

    // Calculer la moyenne des pixels
    const pixels = Array.from(processedImage);
    const average = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    
    // Créer hash binaire basé sur la moyenne
    let binaryString = '';
    for (let i = 0; i < pixels.length; i++) {
      binaryString += pixels[i] > average ? '1' : '0';
    }
    
    // Convertir en hash hexadécimal
    const hash = crypto
      .createHash('sha256')
      .update(binaryString)
      .digest('hex');
    
    return hash;
    
  } catch (error) {
    console.error('Erreur génération hash:', error);
    // Fallback: hash simple du buffer original
    return crypto
      .createHash('md5')
      .update(imageBuffer)
      .digest('hex');
  }
}

/**
 * Préprocessing d'image pour améliorer l'analyse GPT
 */
async function preprocessForOCR(imageBuffer) {
  try {
    return await sharp(imageBuffer)
      .resize(1200, null, { 
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3 
      })
      .sharpen({ sigma: 1.0, flat: 1.0, jagged: 2.0 })
      .normalise({ lower: 1, upper: 99 })
      .jpeg({ 
        quality: 95,
        progressive: true,
        mozjpeg: true 
      })
      .toBuffer();
      
  } catch (error) {
    console.error('Erreur preprocessing:', error);
    return imageBuffer; // Retourner l'original en cas d'erreur
  }
}

/**
 * Vérifier la qualité d'une image
 */
async function checkImageQuality(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    
    const quality = {
      isValid: true,
      width: metadata.width,
      height: metadata.height,
      size: imageBuffer.length,
      format: metadata.format,
      issues: []
    };
    
    // Vérifications de qualité
    if (metadata.width < 800 || metadata.height < 600) {
      quality.issues.push('Résolution trop faible (min 800x600)');
    }
    
    if (imageBuffer.length < 200000) { // < 200KB
      quality.issues.push('Fichier trop petit (probable compression excessive)');
    }
    
    if (imageBuffer.length > 20000000) { // > 20MB
      quality.issues.push('Fichier trop volumineux (max 20MB)');
    }
    
    // Détecter les images très sombres ou très claires
    const stats = await sharp(imageBuffer).stats();
    const brightness = stats.channels[0].mean; // Moyenne des pixels
    
    if (brightness < 50) {
      quality.issues.push('Image trop sombre');
    } else if (brightness > 200) {
      quality.issues.push('Image surexposée');
    }
    
    quality.isValid = quality.issues.length === 0;
    quality.score = quality.isValid ? 1.0 : 0.5;
    
    return quality;
    
  } catch (error) {
    console.error('Erreur vérification qualité:', error);
    return {
      isValid: false,
      issues: ['Erreur lors de l\'analyse de l\'image'],
      score: 0.0
    };
  }
}

module.exports = {
  generatePerceptualHash,
  preprocessForOCR,
  checkImageQuality
};
