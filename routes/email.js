const express = require('express');
const router = express.Router();

router.post('/send-contract', async (req, res) => {
  try {
    console.log('📧 Contrat reçu');
    const { userInfo } = req.body;
    
    res.json({
      success: true,
      message: 'Contrat reçu (email désactivé temporairement)',
      email: userInfo?.email
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
