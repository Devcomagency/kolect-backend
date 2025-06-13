const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

// === CONFIGURATION EMAIL DEVCOM AGENCY ===
// Auth avec devcomagency@gmail.com mais envoi depuis info@devcom.ch
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,      // devcomagency@gmail.com
    pass: process.env.EMAIL_PASS       // Clé 16 caractères de devcomagency@gmail.com
  }
});

// === TEST ENDPOINT ===
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Endpoint email Devcom opérationnel 📧',
    timestamp: new Date().toISOString(),
    fromEmail: 'info@devcom.ch'
  });
});

// === ENVOI CONTRAT AVEC SIGNATURE GRAPHIQUE ===
router.post('/send-contract', async (req, res) => {
  try {
    console.log('📧 === DÉBUT ENVOI EMAIL CONTRAT DEVCOM AVEC SIGNATURE ===');
    
    const { userInfo, contractData } = req.body;
    
    if (!userInfo || !userInfo.email) {
      return res.status(400).json({
        success: false,
        message: 'Informations utilisateur manquantes'
      });
    }

    console.log('📧 Envoi contrat Devcom à:', userInfo.email);
    console.log('📧 Copie à: info@devcom.ch');
    console.log('✍️ Signature incluse:', contractData.signatureImage ? 'Oui' : 'Non');
    console.log('📧 Expéditeur: info@devcom.ch (via devcomagency@gmail.com)');
    
    // Vérifier que l'email n'est pas une adresse test
    if (!userInfo.email || userInfo.email.includes('exemple.com') || userInfo.email.includes('test.com')) {
      console.log('❌ Adresse email invalide ou test:', userInfo.email);
      return res.status(400).json({
        success: false,
        message: 'Adresse email invalide. Veuillez utiliser une vraie adresse email.'
      });
    }
    
    // === CRÉATION IMAGE SIGNATURE POUR EMAIL ===
    let signatureHTML = '';
    if (contractData.signatureImage) {
      signatureHTML = `
        <div style="text-align: center; margin: 30px 0; padding: 20px; border: 2px solid #4ECDC4; border-radius: 12px; background: #f0fffe;">
          <h4 style="color: #2c3e50; margin-bottom: 15px;">✍️ Signature Électronique</h4>
          <p style="color: #7f8c8d; margin-bottom: 15px;">Signé le ${contractData.signedAt || new Date().toLocaleString('fr-FR')}</p>
          <img src="${contractData.signatureImage}" alt="Signature" style="max-width: 300px; height: auto; border: 1px solid #ddd; border-radius: 8px; background: white; padding: 10px;"/>
          <p style="color: #7f8c8d; font-size: 12px; margin-top: 10px; font-style: italic;">
            Cette signature électronique a la même valeur juridique qu'une signature manuscrite.
          </p>
        </div>
      `;
    } else {
      signatureHTML = `
        <div style="text-align: center; margin: 30px 0; padding: 20px; border: 2px dashed #4ECDC4; border-radius: 12px; background: #f0fffe;">
          <h4 style="color: #2c3e50;">✍️ Signature Électronique Validée</h4>
          <p style="color: #7f8c8d;">Signé électroniquement le ${contractData.signedAt || new Date().toLocaleString('fr-FR')}</p>
          <p style="color: #7f8c8d; font-size: 12px; font-style: italic;">
            Cette signature électronique a la même valeur juridique qu'une signature manuscrite.
          </p>
        </div>
      `;
    }
    
    // === HTML CONTRAT DEVCOM AGENCY AVEC SIGNATURE ===
    const contractHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            margin: 0; 
            padding: 40px; 
            background-color: #f8f9fa; 
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            background: white; 
            border-radius: 12px; 
            overflow: hidden; 
            box-shadow: 0 4px 20px rgba(0,0,0,0.1); 
          }
          .header { 
            background: linear-gradient(135deg, #4ECDC4, #44A08D); 
            color: white; 
            padding: 30px 20px; 
            text-align: center; 
          }
          .content { 
            padding: 30px; 
            line-height: 1.6; 
            color: #333; 
          }
          .info-box { 
            background: #f8f9fa; 
            border-radius: 8px; 
            padding: 20px; 
            margin: 20px 0; 
            border-left: 4px solid #4ECDC4; 
          }
          .footer { 
            background: #f8f9fa; 
            padding: 20px; 
            text-align: center; 
            font-size: 12px; 
            color: #666; 
          }
          .devcom-branding {
            border-top: 3px solid #4ECDC4;
            padding: 20px;
            background: #f8f9fa;
            text-align: center;
          }
          ul { padding-left: 20px; }
          li { margin-bottom: 8px; }
          .signature-section {
            margin-top: 40px;
            padding-top: 30px;
            border-top: 2px solid #4ECDC4;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🌿 KOLECT</h1>
            <h2>Contrat de Collaboration</h2>
            <p>Document officiel signé - ${new Date().toLocaleDateString('fr-FR')}</p>
          </div>
          
          <div class="content">
            <div class="info-box">
              <h3>📋 Informations Collaborateur</h3>
              <p><strong>Nom complet :</strong> ${userInfo.firstName || userInfo.prenom || 'N/A'} ${userInfo.lastName || userInfo.nom || 'N/A'}</p>
              <p><strong>Email :</strong> ${userInfo.email}</p>
              <p><strong>Téléphone :</strong> ${userInfo.phone || 'N/A'}</p>
              <p><strong>Adresse :</strong> ${userInfo.address || 'N/A'}</p>
              <p><strong>Date de signature :</strong> ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
            </div>
            
            <h3>📄 Contrat de Collaboration Kolect</h3>
            <p>Je soussigné(e) <strong>${userInfo.firstName || userInfo.prenom} ${userInfo.lastName || userInfo.nom}</strong>, certifie avoir pris connaissance de ce contrat de collaboration avec Kolect pour la collecte éco-responsable de signatures.</p>
            
            <h4>🤝 Mes Engagements :</h4>
            <ul>
              <li>Respecter les délais et objectifs fixés</li>
              <li>Fournir un travail de qualité professionnelle</li>
              <li>Maintenir la confidentialité des informations</li>
              <li>Communiquer de manière respectueuse et professionnelle</li>
              <li>Collecter les signatures de manière éthique et légale</li>
              <li>Utiliser l'application Kolect conformément aux consignes</li>
            </ul>
            
            <h4>🛡️ Mes Droits :</h4>
            <ul>
              <li>Formation et support technique fournis par Devcom Agency</li>
              <li>Rémunération selon barème convenu</li>
              <li>Protection des données personnelles</li>
              <li>Assistance en cas de difficultés terrain</li>
              <li>Support technique via info@devcom.ch</li>
            </ul>

            <!-- SECTION SIGNATURE GRAPHIQUE -->
            <div class="signature-section">
              <h3>✍️ Validation et Signature</h3>
              <p><strong>Conditions acceptées :</strong></p>
              <ul>
                <li>✅ Termes du contrat de collaboration acceptés</li>
                <li>✅ Code de conduite Kolect respecté</li>
                <li>✅ Traitement des données personnelles autorisé</li>
                <li>✅ Confidentialité des informations maintenue</li>
              </ul>
              
              ${signatureHTML}
              
              <p style="text-align: center; color: #2c3e50; font-weight: bold; margin-top: 20px;">
                Ce document constitue un contrat légalement valide entre ${userInfo.firstName || userInfo.prenom} ${userInfo.lastName || userInfo.nom} et Devcom Agency pour le projet Kolect.
              </p>
            </div>
          </div>
          
          <div class="devcom-branding">
            <h3>🚀 Devcom Agency</h3>
            <p><strong>Contact :</strong> info@devcom.ch</p>
            <p><strong>Projet :</strong> Kolect - Collecte éco-responsable</p>
            <p><strong>Référence :</strong> KOLECT-DEVCOM-${Date.now()}</p>
            <p>Développé par Devcom Agency</p>
          </div>
          
          <div class="footer">
            <p>🌿 Kolect - Collecte éco-responsable</p>
            <p>Devcom Agency - Document généré le ${new Date().toLocaleString('fr-FR')}</p>
            <p style="font-size: 10px; color: #999;">
              Ce contrat a été signé électroniquement et est juridiquement valide.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const reference = `KOLECT-DEVCOM-${Date.now()}`;
    
    // === CONFIGURATION EMAIL DEVCOM AVEC COPIE ===
    const mailOptions = {
      from: 'Devcom Agency <info@devcom.ch>',        // ← Expéditeur visible
      replyTo: 'info@devcom.ch',                     // ← Réponses vers Devcom
      to: userInfo.email,                            // ← Destinataire principal (collaborateur)
      cc: 'info@devcom.ch',                          // ← Copie à Devcom
      subject: `🌿 Contrat Kolect Signé - ${userInfo.firstName || userInfo.prenom} ${userInfo.lastName || userInfo.nom} (Devcom Agency)`,
      html: contractHTML,
      attachments: [
        {
          filename: `Contrat-Kolect-Signe-${userInfo.firstName || userInfo.prenom}-${userInfo.lastName || userInfo.nom}-${new Date().toISOString().split('T')[0]}.html`,
          content: contractHTML,
          contentType: 'text/html'
        }
      ]
    };
    
    console.log('📤 Envoi email Devcom avec signature et copie...');
    console.log('📧 From:', mailOptions.from);
    console.log('📧 To (collaborateur):', mailOptions.to);
    console.log('📧 CC (copie Devcom):', mailOptions.cc);
    console.log('📧 Subject:', mailOptions.subject);
    
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email Devcom avec signature envoyé:', result.messageId);
    
    res.json({
      success: true,
      message: 'Contrat signé envoyé par email avec succès depuis Devcom Agency',
      emailSent: true,
      reference: reference,
      messageId: result.messageId,
      fromEmail: 'info@devcom.ch',
      agency: 'Devcom Agency',
      hasSignature: !!contractData.signatureImage
    });
    
  } catch (error) {
    console.error('❌ Erreur envoi email Devcom:', error);
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi de l\'email Devcom',
      error: error.message,
      emailSent: false
    });
  }
});

module.exports = router;
