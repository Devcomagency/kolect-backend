const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

// === CONFIGURATION EMAIL DEVCOM AGENCY ===
const transporter = nodemailer.createTransport({  // ← CORRIGÉ: createTransport (sans "r")
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,      // Votre Gmail technique
    pass: process.env.EMAIL_PASS       // Mot de passe app Gmail
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

// === ENVOI CONTRAT ENDPOINT ===
router.post('/send-contract', async (req, res) => {
  try {
    console.log('📧 === DÉBUT ENVOI EMAIL CONTRAT DEVCOM ===');
    
    const { userInfo, contractData } = req.body;
    
    if (!userInfo || !userInfo.email) {
      return res.status(400).json({
        success: false,
        message: 'Informations utilisateur manquantes'
      });
    }

    console.log('📧 Envoi contrat Devcom à:', userInfo.email);
    
    // === HTML CONTRAT DEVCOM AGENCY ===
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
          .signature-box { 
            border: 2px dashed #4ECDC4; 
            padding: 20px; 
            margin: 20px 0; 
            border-radius: 8px; 
            background: #f0fffe; 
            text-align: center; 
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
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🌿 KOLECT</h1>
            <h2>Contrat de Collaboration</h2>
            <p>Document officiel - ${new Date().toLocaleDateString('fr-FR')}</p>
          </div>
          
          <div class="content">
            <div class="info-box">
              <h3>📋 Informations Collaborateur</h3>
              <p><strong>Nom :</strong> ${userInfo.nom || userInfo.lastName || 'N/A'}</p>
              <p><strong>Prénom :</strong> ${userInfo.prenom || userInfo.firstName || 'N/A'}</p>
              <p><strong>Email :</strong> ${userInfo.email}</p>
              <p><strong>Date de signature :</strong> ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
            </div>
            
            <h3>📄 Contrat de Collaboration Kolect</h3>
            <p>Je soussigné(e) <strong>${userInfo.prenom || userInfo.firstName} ${userInfo.nom || userInfo.lastName}</strong>, certifie avoir pris connaissance de ce contrat de collaboration avec Kolect pour la collecte éco-responsable de signatures.</p>
            
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
            
            <div class="signature-box">
              <h4>✍️ Signature Électronique Validée</h4>
              <p>Ce contrat a été signé électroniquement le <strong>${new Date().toLocaleString('fr-FR')}</strong></p>
              <p><strong>Référence :</strong> KOLECT-DEVCOM-${Date.now()}</p>
              <p><em>Cette signature électronique a la même valeur juridique qu'une signature manuscrite.</em></p>
            </div>
            
            <p><strong>Ce document constitue un contrat légalement valide entre ${userInfo.prenom || userInfo.firstName} ${userInfo.nom || userInfo.lastName} et Devcom Agency pour le projet Kolect.</strong></p>
          </div>
          
          <div class="devcom-branding">
            <h3>🚀 Devcom Agency</h3>
            <p><strong>Contact :</strong> info@devcom.ch</p>
            <p><strong>Projet :</strong> Kolect - Collecte éco-responsable</p>
            <p>Développé par Devcom Agency</p>
          </div>
          
          <div class="footer">
            <p>🌿 Kolect - Collecte éco-responsable</p>
            <p>Devcom Agency - Document généré le ${new Date().toLocaleString('fr-FR')}</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const reference = `KOLECT-DEVCOM-${Date.now()}`;
    
    // === CONFIGURATION EMAIL DEVCOM ===
    const mailOptions = {
      from: 'Devcom Agency <info@devcom.ch>',        // ← VOTRE EMAIL VISIBLE
      replyTo: 'info@devcom.ch',                     // ← Réponses vers vous
      to: userInfo.email,                            // Destinataire
      subject: `🌿 Contrat Kolect - ${userInfo.prenom || userInfo.firstName} ${userInfo.nom || userInfo.lastName} (Devcom Agency)`,
      html: contractHTML,
      attachments: [
        {
          filename: `Contrat-Kolect-${userInfo.prenom || userInfo.firstName}-${userInfo.nom || userInfo.lastName}.html`,
          content: contractHTML,
          contentType: 'text/html'
        }
      ]
    };
    
    console.log('📤 Envoi email Devcom avec nodemailer...');
    console.log('📧 From:', mailOptions.from);
    console.log('📧 To:', mailOptions.to);
    
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email Devcom envoyé:', result.messageId);
    
    res.json({
      success: true,
      message: 'Contrat envoyé par email avec succès depuis Devcom Agency',
      emailSent: true,
      reference: reference,
      messageId: result.messageId,
      fromEmail: 'info@devcom.ch',
      agency: 'Devcom Agency'
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
